# 22 — Automatic process discovery

Semantic agent integrations answer a valuable question: “what is this agent
doing?” Before they can answer it, though, the application has to answer a more
basic question reliably: “is an agent running in this terminal at all?”

This chapter explains the zero-configuration discovery layer in cmux-linux: why
it belongs in Electron main, how a PTY maps to a Linux process tree, how we
extract identity without retaining prompts, how multiple state authorities
coexist, and where automatic inference must stop.

## 1. Requirements

The discovery design has seven requirements:

1. **No setup for presence.** Starting a recognizable agent in a cmux-linux
   terminal is enough to create a sidebar row.
2. **Exact ownership.** Every row must point to the correct workspace and terminal
   surface.
3. **Tool-call continuity.** The row must survive while the agent launches a child
   shell, test runner, or other tool.
4. **Low false-positive rate.** A shell, editor, server, or ordinary command must
   not become an “agent.”
5. **Privacy by construction.** Prompts, command arguments, environment variables,
   and terminal prose must not become discovery metadata.
6. **Structured data wins.** A coarse heuristic must never overwrite a more
   authoritative lifecycle event.
7. **Bounded cost.** Scanning must have fixed time, depth, and memory boundaries.

These requirements point to process inspection, not terminal-text recognition.

## 2. The alternatives and why we did not choose them

### 2.1 Require every provider to report itself

A socket report or provider hook gives excellent semantic detail. It is also an
integration contract: every provider must expose a lifecycle surface, and the
user or application may need to install configuration. Providers change at
different speeds and do not all expose equivalent events.

We keep structured reporters for enrichment, but they cannot be the only way an
agent becomes visible.

### 2.2 Parse the terminal screen

Looking for banners such as a provider logo seems universal, but it is fragile:

- themes, versions, localization, and terminal width change text;
- scrollback may include an old agent invocation;
- prompts and repository content could accidentally match;
- parsing output creates a privacy and maintenance burden; and
- a tool call replaces the visible screen even though the agent still exists.

The existing OSC parser handles explicit terminal notification control sequences.
That is different from scraping human-readable prose and remains separate.

### 2.3 Scan every process on the machine

A global `/proc` scan can find agents launched anywhere, but it cannot safely map
an external process to a cmux-linux workspace and surface. Guessing by cwd is
ambiguous when several panes share a repository.

cmux-linux instead starts from each PTY it owns. That gives exact UI ownership
before inspecting a process.

### 2.4 Read provider configuration globally

Changing dotfiles creates ownership, trust, portability, and rollback problems.
It can also conflict with a user's existing hooks. The automatic baseline makes
no configuration changes. Existing provider adapters remain explicit,
idempotent, and useful for richer states.

## 3. The architecture

The full flow crosses the established Electron boundaries:

```text
RENDERER                         MAIN
----------------------------    -------------------------------------
workspace + surface state  ──►  PTY registry
                                 | workspaceId, surfaceId, shellPid
                                 v
                              /proc inspection
                                 | foreground + bounded parent chain
                                 v
                              classifier
                                 | provider, display name, safe command
                                 v
                              reconciler
                                 | source precedence + cleanup
                                 v
Agents sidebar             ◄──  renderer socket-command bridge
```

The renderer remains responsible for application state and UI binding. Electron
main owns process inspection because the sandboxed renderer must not have direct
filesystem or process access.

The preload API does not grow. Discovery is an internal main-process service and
reuses the existing `SocketApply` command path to publish validated agent reports.

## 4. From a PTY to a process tree

### 4.1 What node-pty gives us

When `src/main/pty.ts` creates a terminal, node-pty returns the PID of the shell
attached to the pseudo-terminal. The app registers that PID alongside:

- the terminal `surfaceId`;
- its owning `workspaceId`;
- the initial cwd and terminal dimensions; and
- a bounded output capture used by agent inspection.

This shell PID is our ownership anchor.

### 4.2 Linux `/proc/<pid>/stat`

Linux exposes process metadata through virtual files under `/proc`. The `stat`
record contains, among other fields:

- parent PID (`ppid`);
- process group ID (`pgrp`); and
- foreground process group ID for the controlling terminal (`tpgid`).

The foreground process group tells us which command currently owns terminal
input. If a user starts an agent from the shell, the foreground group normally
belongs to that agent or to a tool it launched.

`/proc/<pid>/stat` begins with a parenthesized process name that may contain
spaces, so splitting the whole line on spaces is unsafe. The parser first finds
the last `)` and only then indexes the remaining fields.

### 4.3 The ancestry walk

Consider this process tree:

```text
zsh (registered shell PID)
└── codex
    └── bash
        └── npm test       <- terminal foreground process
```

If we inspect only `npm`, Codex disappears during its tool call. Instead, the
scanner records the foreground identity and repeatedly follows `ppid` until it
reaches the registered shell:

```text
npm -> bash -> codex -> zsh
```

The classifier reads this foreground-first list. The first recognized agent wins.

The walk is bounded to 16 entries and keeps a visited-PID set. These bounds guard
against corrupt data, races, and accidental cycles while covering realistic
terminal process trees.

## 5. Safe identity extraction

Process names are not always enough. A JavaScript CLI may appear as `node`; a
Python CLI may appear as `python3`. Linux gives us three useful identity sources:

| Source                | Example              | Use                              |
| --------------------- | -------------------- | -------------------------------- |
| `/proc/<pid>/comm`    | `node`               | Kernel process name and fallback |
| `/proc/<pid>/exe`     | `/usr/bin/node`      | Real executable basename         |
| `/proc/<pid>/cmdline` | `node\0.../cli.js\0` | Wrapped command identity         |

The raw command line is sensitive because arguments may contain a user prompt,
file content, tokens, or a private path. The implementation never returns the raw
vector. It derives one token under strict rules:

1. use only a basename;
2. remove common script suffixes such as `.js`, `.mjs`, and `.py`;
3. accept only letters, numbers, and a small punctuation allowlist;
4. cap the token at 80 characters; and
5. discard all remaining arguments.

If the first token is a known runner (`node`, `python`, `bun`, `npm`, `npx`,
`pnpm`, `yarn`, `uv`, or similar), inspection considers only the first few
following tokens and skips runner words and flags. A generic filename such as
`cli.js` or `__main__.py` can use its parent directory basename.

That converts these runtime-specific shapes into stable identities:

```text
node /opt/.../claude-code/cli.js   -> claude-code
python .../kimi_cli/__main__.py    -> kimi_cli
bun .../opencode                   -> opencode
```

The classifier normalizes underscore to hyphen, so `kimi_cli` matches `kimi-cli`.

### Race tolerance

`/proc` is a live view. A process may exit after reading `stat` but before reading
`comm` or `cmdline`. Every lookup therefore has a failure path. Missing identity
means “not detected in this scan,” not an application error.

## 6. Classification strategy

Classification combines a curated alias table and a conservative generic rule.

### 6.1 Known aliases

The alias table gives stable display names to widely used terminal agents. It
also absorbs packaging differences such as `codex-cli`, `claude-code`, or
`kimi-cli`.

The semantic protocol currently has dedicated provider enums for Codex, Claude,
and OpenCode. Other tools use the `custom` provider bucket with a precise display
name such as “Kimi” or “Aider.” The UI still tells the user which tool is running,
while the wire contract remains backward-compatible.

Alias matching accepts exact names and common delimited packaging prefixes or
suffixes. It does not use an unrestricted substring search; `agentless` must not
become “Agent.”

### 6.2 Generic fallback

New CLIs appear faster than releases of this application. A generic fallback
recognizes delimiter-separated words such as `agent`, `assistant`, or `copilot`:

```text
my-review-agent -> My Review Agent
agentless       -> no match
```

This fallback is intentionally narrower than “all long-running commands.” A CLI
with an arbitrary unrelated executable name cannot be identified truthfully
without provider data. Avoiding false rows is more useful than claiming impossible
universal knowledge.

### 6.3 One agent per terminal surface

The current model selects the first recognized process in the foreground-to-shell
chain. That matches the common case: one interactive agent owns one terminal and
temporarily launches children. Multiple independent agents should run in separate
surfaces, which also gives each one a focus target and readable terminal.

## 7. Inferring activity, not intent

The PTY registry timestamps two observable events:

- bytes the user or automation sends to the terminal;
- bytes the PTY emits to the application.

The newest timestamp becomes `lastActivityAt`. The scanner maps it to:

```text
activity within 3 seconds -> working
otherwise                 -> idle
```

Why not infer more?

- Quiet output might mean thinking, waiting for approval, waiting for the network,
  or simply idle.
- A printed word such as “done” might belong to source code or test output.
- Process exit does not distinguish success from failure without another contract.

So process discovery describes evidence: present and recently active. Semantic
states such as `blocked`, `done`, activities such as `web-search`, and reasons
such as `approval` belong to structured provider lifecycle events.

## 8. State authority and reconciliation

There can be multiple observations of the same terminal:

| Source               | Information quality            | Example                 |
| -------------------- | ------------------------------ | ----------------------- |
| `process:auto`       | Presence + recent PTY activity | `working`, `idle`       |
| provider hook/plugin | Explicit lifecycle event       | `blocked` for approval  |
| custom reporter      | Explicit application contract  | project-specific states |

The rule is simple: any non-automatic record on a surface is richer and wins.

The scanner receives the renderer's latest agent mirror on every workspace sync.
For each terminal it:

1. checks for a non-automatic record on the same `surfaceId`;
2. clears its own record if a richer source exists;
3. otherwise classifies the process ancestry;
4. emits a validated report only when its signature changed; and
5. clears records for terminals or recognized processes that disappeared.

Automatic IDs are stable:

```text
<provider>:auto:<surfaceId>
```

The report source is `process:auto`. Clear operations include both ID and source,
which is a compare-and-delete guard: a stale cleanup cannot delete another
source's current record.

If the richer report expires or clears while the process continues, process
discovery becomes eligible again on the next scan. The sidebar therefore retains
a zero-setup fallback without showing duplicate authorities.

## 9. Timing and resource bounds

The scanner runs in Electron main once per second. Its work is bounded by:

```text
number of cmux-linux terminal surfaces
  x at most 16 process identities
  x a small fixed set of /proc reads
```

It does not scan the whole process table, retain command lines, or emit unchanged
reports. The cached signature contains only workspace, agent ID, display name,
PID, safe command token, and derived state.

The three-second active window is deliberately larger than the one-second scan
interval. A single activity observation therefore survives more than one tick
and avoids a one-tick `working` flash.

These constants live next to the discovery service so their relationship is
visible and testable.

## 10. Lifecycle and failure semantics

### Startup

Electron main registers PTY IPC, starts the Unix socket server, and starts the
automatic scanner. A terminal only becomes discoverable after it registers its
surface, workspace, and shell PID.

### Normal operation

Renderer workspace sync updates two consumers:

- the socket mirror, used to resolve and query application objects;
- discovery's agent mirror, used to enforce source precedence.

### Terminal exit or close

The PTY inspection entry is removed. On the next scan, its automatic agent is
cleared. If the same surface remains but no recognized process exists, cleanup is
the same.

### Application shutdown

The service cancels its interval and clears transient automatic records before
the terminals and socket server are torn down.

### Unsupported platform

The process-context function returns no live Linux identity when `/proc` is not
available. That degrades to no automatic discovery rather than weakening the
renderer sandbox or inventing a platform command. A future port should implement
the same narrow `TerminalProcessContext` boundary with native platform APIs.

## 11. Testing the architecture

Good tests separate policy from the live operating system.

`classifyAgentProcesses()` accepts plain process records, so provider and generic
classification are deterministic unit tests. `AutomaticAgentDiscovery.scan()`
accepts terminal contexts and a clock, so tests can drive:

- `working` to `idle` transitions;
- no-op scans;
- source replacement;
- rediscovery; and
- terminal disappearance.

`listTerminalProcessContexts()` accepts an injected process-context reader. Its
tests verify workspace binding, activity timestamps, and safe ancestry without
depending on a particular CI process tree.

A live smoke test remains valuable because it crosses node-pty, Linux `/proc`,
Electron IPC, the reducer, and the Unix-socket query path. The test launches a
harmless process with a Kimi identity, observes it through `list-agents`, stops
it, and verifies cleanup.

## 12. Extending discovery safely

### Add a known CLI

Add aliases, provider bucket, and display name to the rule table, then add cases
for its direct executable and common runtime wrapper. Do not add prompt patterns.

### Add a platform backend

Implement the same output contract:

```ts
interface TerminalProcessContext {
  surfaceId: string
  workspaceId?: string
  shellPid: number
  processes: ForegroundProcess[]
  lastActivityAt: number
}
```

Keep ownership anchored to the app's terminal and keep process ancestry bounded.

### Add richer semantics

Use a documented structured event source and publish through the existing agent
protocol. Do not make the process classifier guess. The precedence rule will
automatically replace the baseline record while the rich source is alive.

## 13. Design lessons

The important architectural lesson is progressive enhancement:

```text
process evidence     -> zero-setup visibility
structured lifecycle -> exact semantic state
shared reducer       -> one UI and automation model
```

The lower layer is broad but modest in what it claims. The upper layer is exact
but provider-specific. Combining them gives a reliable user experience without
making either layer pretend to know more than it does.

## Checkpoint

1. Why is the registered shell PID a better starting point than a global process scan?
2. How does parent ancestry keep an agent visible while it runs a tool?
3. Which parts of `cmdline` are retained, and which are discarded?
4. Why does a provider lifecycle report outrank `process:auto`?
5. What can recent PTY activity prove, and what can it not prove?
6. What fixed bounds control scanner cost?
7. How would you add another operating-system backend without changing the renderer?
