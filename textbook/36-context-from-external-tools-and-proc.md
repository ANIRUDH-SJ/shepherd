# 36 — Reliable Context from External Tools and `/proc`

Workspace context often comes from sources with very different trust and timing
properties. A GitHub CLI call is a fallible network-backed subprocess. Linux
socket ownership is a changing graph assembled from several pseudo-files. A good
desktop application must turn both into small, truthful, optional UI state.

This chapter explains the design used for pull-request and listening-port
metadata: capability detection, bounded parsing, process ownership, cache
invalidation, asynchronous identity, failure policy, presentation, and testing.

## 1. Start with user questions, not data sources

The UI needs to answer:

```text
Does this branch have a pull request, and what state is it in?
Which localhost servers belong to work started from this terminal?
```

Those are narrower than “show GitHub” and “show every port.” The narrower model
avoids account panels, global network lists, and false associations.

The values are ephemeral observations:

- a PR can open, become a draft, merge, or close without a local file changing;
- a listener can appear or disappear in milliseconds;
- the active terminal can change while an observation is in flight; and
- either capability can be unavailable without making the terminal unusable.

That leads to three rules: optional values render only when proven, every scan is
bounded, and the result must still belong to the selected terminal when it lands.

## 2. Model absence explicitly

The shared contract separates missing data from malformed data:

```ts
type WorkspacePullRequestState = 'open' | 'draft' | 'merged' | 'closed'

interface WorkspacePullRequest {
  number: number
  state: WorkspacePullRequestState
  url: string
}

interface WorkspaceMetadata {
  surfaceId: string
  cwd: string
  projectName: string
  gitRoot: string | null
  gitBranch: string | null
  pullRequest: WorkspacePullRequest | null
  ports: number[]
}
```

`null` means no usable PR observation. An empty array means no owned listening
port observation. Neither claims why: there may be no PR, no remote, no login, no
CLI, or a temporary failure. Passive context should not force account setup.

At the process boundary, validation still treats the object as `unknown`.
Accepted PR URLs use GitHub HTTPS origins, states come from a closed vocabulary,
and ports must be strictly ascending unique integers from 1 through 65535. The
16-port maximum is both a memory bound and a UI contract.

## 3. External tools are optional capabilities

Calling `gh` is attractive because it reuses the user's configured host,
authentication, enterprise behavior, and branch association. Direct REST calls
would require Shepherd to own tokens, host selection, API versions, redirects,
and credential storage.

The subprocess is still an untrusted boundary. Safe invocation uses an argument
array rather than a shell command:

```text
executable: gh
arguments:  pr view --json number,state,isDraft,url
cwd:        repository root
prompting:  disabled
timeout:    2 seconds
output:     at most 16 KiB
```

No branch, path, or output is interpolated into a shell. The JSON parser checks
the complete shape after `JSON.parse`; a TypeScript cast alone would validate
nothing. Draft is derived only from an open PR whose `isDraft` flag is true.

Failures collapse to absence during passive observation. If a future explicit
“Connect GitHub” action is added, that interaction can diagnose missing binaries
or authentication. Keeping those policies separate avoids surprising modal
errors during ordinary terminal work.

## 4. Cache according to semantic identity

A fixed timer alone is insufficient. Some changes should refresh immediately:

```text
PR identity = canonical Git root + NUL separator + branch name
```

The separator prevents ambiguous concatenation. Changing either component makes
the old PR irrelevant and triggers a probe. An unchanged identity reuses the
observation for 30 seconds. Detached HEAD and non-repository context have no PR
identity and skip `gh` entirely.

This is semantic cache invalidation: refresh on the event that changes meaning,
then keep a bounded recovery interval for external changes. It avoids spawning a
network-aware CLI on the 750 ms active metadata cadence.

## 5. Linux socket tables identify sockets, not applications

`/proc/net/tcp` and `/proc/net/tcp6` expose rows containing local address,
connection state, and socket inode. A state of hexadecimal `0A` means `LISTEN`.
The local port is also hexadecimal:

```text
0100007F:0BB8 ... 0A ... 111
           ^                 local port 3000; socket inode 111
```

This table alone cannot tell which workspace owns port 3000. Global display would
misattribute databases, browsers, other Shepherd windows, and unrelated developer
tools.

Linux exposes the missing link through file descriptors:

```text
/proc/<pid>/fd/<n> -> socket:[111]
```

Matching the inode connects a listening row to a process. Connecting that process
to a PTY shell requires ancestry.

## 6. Process ancestry is the ownership boundary

The shell PID recorded when the PTY starts is the stable root:

```text
Electron
  -> PTY shell (ownership root)
       -> npm
            -> dev server (owns listener inode)
```

`/proc/<pid>/stat` supplies each process's parent PID. A bounded closure finds the
shell's descendants. Only descriptor inodes held by that set can match listening
sockets.

All dimensions have explicit limits:

- at most 4,096 process or socket-table entries;
- at most 512 owned processes;
- at most 1,024 descriptors per process; and
- at most 16 final ports.

The bounds cap worst-case work even on a busy host or under adversarial process
behavior. Individual reads can fail because `/proc` is a live view; those races
produce partial context, not fatal errors.

## 7. Inherited descriptors are a subtle false-positive

Ownership by descriptor is necessary but not always sufficient. A parent can
open a listener and pass the descriptor through `fork`/`exec`. In Electron
development, the Chromium debugging socket may be held by Electron, inherited by
the PTY shell, and inherited again by a Node server child. A naive descendant scan
then reports the debug port as if the child created it.

The correction is to snapshot the shell's socket inodes and remove them from the
candidate listener table before matching descendant descriptors:

```text
candidate listeners
  - sockets already held by PTY shell
  = listeners newly owned below the shell
```

The shell PID itself is also excluded from reporting. Interactive commands that
open servers normally execute as children; foreground and background servers both
remain descendants. This policy trades away the extremely unusual case of a shell
implementation opening a listener itself in order to reject a real inherited-FD
false positive.

## 8. Scheduling and asynchronous ownership

Port discovery reads files synchronously for a coherent, simple bounded scan, but
is placed on a later event-loop turn and cached for five seconds. Terminal output
does not reschedule it. The metadata service already adapts between active, quiet,
and hidden cadences; the inner cache prevents those ticks from repeating expensive
work.

Every asynchronous result is checked against the current target surface before it
is cached or emitted:

```text
capture workspace -> surface A
await gh and /proc probes
if current target is no longer surface A: discard
```

The renderer repeats the ownership check before applying metadata. This defense in
depth prevents a slow PR response for an old tab from overwriting a newly focused
tab.

## 9. Presentation is lossy by design, accessibility is not

The sidebar has less horizontal space than the data. The visual formatter shows
at most two ports and summarizes the remainder:

```text
PR #52 draft · :3000 :4173 +2
```

The title and accessible label retain every port and the full PR state. Missing
parts leave no separators or placeholders. Long branch text yields space to the
runtime context; at the narrow breakpoint it can be hidden because the same branch
remains in the terminal context strip.

This is a general interface pattern: derive a compact lossy label and a complete
semantic description from the same validated source. Do not store both in state,
or they can drift.

## 10. Failure handling and security

The feature's failure matrix is deliberately quiet:

| Condition                            | Result                      |
| ------------------------------------ | --------------------------- |
| no repository or detached HEAD       | skip PR command             |
| missing `gh`, no remote, no login/PR | `pullRequest: null`         |
| malformed, oversized, or unsafe JSON | discard PR response         |
| non-Linux platform                   | `ports: []`                 |
| process exits during `/proc` scan    | ignore failed entry         |
| unrelated process owns same port     | exclude without inode match |
| old surface finishes after selection | discard entire stale result |
| excessive processes/FDS/ports        | stop at documented bounds   |

No terminal output is parsed, no shell is invoked, no credential is copied into
renderer state, and the renderer receives only a bounded URL/status/number plus
integer ports. The URL is retained for future explicit interaction but is not
automatically opened.

## 11. Testing strategy

Pure parsers and set operations cover the difficult cases deterministically:

- all PR states, draft precedence, malformed and oversized JSON;
- command failure as the common missing/no-remote/unauthenticated outcome;
- TCP state and hexadecimal port parsing;
- ancestry closure and traversal limits;
- unrelated ownership, port reuse, inherited descriptors, sorting, and caps;
- shared runtime validation and equality;
- PR context invalidation, port expiry, and hot-path cache reuse;
- active-surface race rejection and renderer stale-state clearing; and
- hidden, one-port, PR-only, multi-port, narrow-label, and full-description UI.

Live verification should use a real branch PR and real descendant servers. It is
especially valuable here because inherited descriptors are hard to anticipate in
fixtures. The production screenshot should show the bounded value in its true
sidebar geometry, not a mock card.

## 12. Alternatives and extension points

Alternatives rejected for this milestone:

- **GitHub REST from main:** introduces token storage and host/API policy.
- **`ss -tlnp`:** depends on another executable and can require privileges for
  ownership details; `/proc` provides the kernel primitives directly.
- **global port scan:** simple but assigns unrelated services to workspaces.
- **parse terminal output:** prompts and server logs are prose, incomplete, and
  spoofable.
- **persist observations:** restores stale external state after relaunch.
- **continuous subprocess polling:** wastes resources while terminals are idle.

The bounded port array becomes the trusted discovery input for a later explicit
localhost preview. That feature must still revalidate the selected port and apply
navigation policy at open time; metadata discovery is evidence for presentation,
not authority to browse arbitrary URLs.
