# Chapter 19 — Semantic Agent Runtime: State, Automation, and Integrations

## 19.1 Why this is a runtime, not a colored process list

An operating system can tell us that a process exists, consumes CPU, sleeps, or
has exited. Those facts do not answer the questions a person coordinating coding
agents actually asks:

- Is the agent making progress or waiting for me?
- Does it need command approval, authentication, or more input?
- Did the last turn finish?
- What kind of work is happening now?
- Which terminal owns that work?

A process marked “sleeping” may be waiting for a model response, waiting for the
user, or completely idle. CPU and process status are therefore the wrong semantic
layer.

cmux-linux adds a small **semantic agent runtime**. Agents or their integrations
publish structured lifecycle observations. The application validates those
observations, maintains current state, exposes control operations, and renders a
provider-neutral view.

The central design rule is:

> Providers describe events; cmux-linux owns the normalized state model and its
> relationship to workspaces and terminals.

## 19.2 Requirements and non-goals

The implemented runtime must:

1. Represent working, blocked, done, idle, and unknown consistently.
2. Distinguish stable semantic state from descriptive activity.
3. Associate each record with a real workspace and terminal surface.
4. Reject malformed or contradictory external reports.
5. Handle duplicate, stale, missing-cleanup, and out-of-order situations safely.
6. Show urgent agents first and support exact terminal navigation.
7. Let scripts list, focus, clear, or wait for agents.
8. Integrate with Codex, Claude Code, OpenCode, and custom reporters without
   embedding provider-specific schemas in React state.
9. Preserve existing provider configuration and fail harmlessly outside the app.

It is not intended to:

- infer agent meaning from CPU usage;
- scrape terminal prose as its primary data source;
- persist historical agent claims across application restarts;
- authenticate mutually untrusted users on a shared machine;
- reproduce every lifecycle nuance exposed by every provider.

These boundaries keep the first protocol small enough to reason about.

## 19.3 Technology and architecture choices

### Reuse the Unix socket

The existing newline-delimited JSON socket already connects terminal processes to
Electron main. Reusing it gives lifecycle reporting:

- automatic pane targeting through injected environment variables;
- one runtime validation boundary;
- a CLI usable by hooks, people, and scripts;
- no new daemon, port, database, or network permission;
- the existing main-to-renderer IPC path.

A watched directory was considered. Files are useful for durable snapshots, but
they make event ordering, atomic replacement, stale cleanup, and request/reply
operations such as `wait-agent` awkward. A socket matches both events and control
commands.

### Keep canonical UI state in the renderer reducer

The layout tree already lives in React state. Only the renderer can cheaply prove
that a `surfaceId` belongs to a current pane and can select that pane and tab using
the existing pure reducers. Agent records therefore live beside layout state.

Main keeps a read-only mirror for socket queries. It does not become a second
writer. The direction is:

```text
external event → main validates → renderer reduces → renderer mirrors snapshot → main queries
```

This avoids two canonical stores, at the cost of a small IPC mirror update when
agent state changes.

### Use a discriminated semantic model

One free-form `status: string` would be easy to display but impossible to automate
reliably. A script cannot know whether “searching,” “busy,” and “researching” all
mean working. Literal unions make the stable layer explicit while optional detail
fields preserve useful presentation.

### Use provider extension points, not terminal scraping

Codex and Claude Code expose command lifecycle hooks. OpenCode exposes plugin
events. Those sources know when tools, permissions, sessions, and turns change.
Terminal output is only a decorated projection and may contain redraws, spinners,
ANSI codes, localization, or no relevant text at all.

### Keep adapters dependency-free

The shipped CLI is plain CommonJS, and the provider installers use Node's built-in
filesystem/path modules. The OpenCode plugin uses the Bun runtime already supplied
by OpenCode. No provider SDK becomes an application dependency.

That reduces package and release risk, though it means adapter mappings must be
maintained when provider event schemas evolve.

## 19.4 The layer diagram

```text
┌──────────────────────────────── PROVIDERS ────────────────────────────────┐
│ Codex command hooks   Claude Code hooks   OpenCode plugin   custom script │
└───────────────┬──────────────────┬──────────────┬──────────────┬──────────┘
                └──────────────────┴──────────────┴──────────────┘
                                      │
                             provider event mapping
                                      │
                         cmux agent-report / agent-clear
                                      │ newline-delimited JSON
                                      ▼
┌──────────────────────── ELECTRON MAIN ────────────────────────────────────┐
│ Unix socket → workspace resolution → runtime validation → IPC apply       │
│                                      └→ read-only mirror for list/wait    │
└──────────────────────────────────────┬────────────────────────────────────┘
                                       │ restricted preload bridge
                                       ▼
┌──────────────────────── REACT RENDERER ───────────────────────────────────┐
│ App.tsx → pure appReducer → AgentRecord[] + workspace alert rollups       │
│                              │                                            │
│                              ├→ Sidebar / AgentList                       │
│                              ├→ exact workspace/pane/surface selection    │
│                              └→ mirror current records back to main       │
└───────────────────────────────────────────────────────────────────────────┘
```

Notice the three different boundaries:

- **Provider boundary:** provider event names become cmux semantics.
- **Process boundary:** untrusted JSON becomes a normalized report in main.
- **Layout boundary:** a claimed surface becomes a verified pane association in
  the renderer.

Each boundary removes ambiguity that the next layer should not need to understand.

## 19.5 State design: semantic state versus detail

The state machine has five values:

```text
working  blocked  done  idle  unknown
```

They are intentionally broad.

### `working`

The agent is actively advancing its current turn. Optional `activity` refines the
display:

```text
thinking, reading, editing, running-command, testing, web-search, waiting
```

`waiting` here means part of active work, such as waiting for a tool response. It
does not necessarily require the user.

### `blocked`

The agent cannot continue its current path. Optional `blockReason` explains why:

```text
approval, user-input, authentication, tool-error, external
```

Most blocked reasons are actionable and trigger attention. `external` is the
exception: a remote build or service can block progress without requiring the
user to act immediately.

### `done`

The turn or unit of work completed. It is useful as an automation terminal state
and marks an inactive workspace unread, but it does not flash as an error.

### `idle`

The provider session exists but no turn is active. Idle is not the same as done:
done communicates a recent completion; idle describes a resting session.

### `unknown`

An integration knows an agent record exists but cannot safely classify its
current state. Unknown is preferable to manufacturing certainty.

Activities are only legal for working records, and block reasons are only legal
for blocked records. This prevents contradictions such as:

```json
{ "state": "done", "activity": "web-search" }
```

## 19.6 Identity, provenance, and ownership

An agent record combines several identifiers because they solve different
problems.

| Field         | Meaning                                                      |
| ------------- | ------------------------------------------------------------ |
| `agentId`     | stable identity used to upsert, list, focus, clear, and wait |
| `provider`    | normalized producer family                                   |
| `source`      | reporter authority, such as `codex:hooks`                    |
| `sessionId`   | optional provider-native trace information                   |
| `workspaceId` | sidebar/work context                                         |
| `surfaceId`   | exact terminal tab that owns the agent                       |
| `paneId`      | layout association derived by the renderer                   |

If no explicit id is supplied, main derives:

```text
agentId = source + ":" + surfaceId
```

This makes repeated events from one reporter in one terminal update one record.
An adapter that runs multiple concurrent agents in the same surface should supply
distinct ids.

Identity is not allowed to drift. Once an `agentId` exists, the reducer rejects
an update that changes its source, workspace, or surface. A moving agent must be
cleared and reported under the correct ownership instead of silently teleporting
through state.

The provider does not get to choose `paneId`. The renderer searches the current
layout tree for `surfaceId` and derives the pane. This matters because a string
that looks like a terminal id is not proof that the terminal exists.

## 19.7 Protocol and validation at the process boundary

A manual report looks like:

```bash
cmux agent-report \
  --provider codex \
  --state working \
  --activity web-search \
  --message "checking API behavior" \
  --source codex:hooks \
  --ttl-ms 60000
```

Inside a pane, the CLI adds its injected workspace and surface ids. It sends:

```json
{
  "id": 1,
  "method": "agent-report",
  "params": {
    "provider": "codex",
    "state": "working",
    "activity": "web-search",
    "message": "checking API behavior",
    "source": "codex:hooks",
    "ttlMs": "60000",
    "workspace": "ws-1",
    "surfaceId": "term-1"
  }
}
```

Main first resolves the workspace name/id using its renderer mirror. Then
`normalizeAgentReport()` enforces:

- enumerated provider, state, activity, and reason values;
- non-empty bounded ids;
- a restricted source alphabet;
- state/detail compatibility;
- non-negative integer sequence numbers;
- TTL from 1 ms to 24 hours;
- bounded display strings with control characters removed;
- local ingestion time.

Normalization is more than rejecting bad input. It also prevents terminal escape
characters or multiline labels from reaching the sidebar, supplies provider
display names, parses numeric CLI strings, and creates stable defaults.

After validation, main sends a structured `SocketApply` through the restricted
preload bridge. The renderer never parses provider input directly.

## 19.8 Ordering, revisions, and expiry

Lifecycle events can arrive late. A slow tool callback might report working after
a newer completion report. Optional monotonic `revision` values let a producer
state its ordering:

```text
stored revision = 8
incoming revision = 7  → reject
incoming revision = 8  → reject
incoming revision = 9  → accept
```

Simple hooks often do not maintain a sequence counter. They remain valid. For an
unsequenced report, the reducer assigns `previous revision + 1`. This preserves a
useful local ordering without pretending it can identify network reordering the
producer did not describe.

TTL addresses a different failure: missing cleanup. Main converts `ttlMs` into an
absolute `expiresAt` based on ingestion time. `App.tsx` dispatches an expiry action
once per second. The pure reducer removes elapsed records and recalculates
workspace attention.

TTL is optional because provider hooks can have explicit stop/session-end events.
A custom integration that cannot guarantee cleanup should use it.

## 19.9 Unread versus attention

The UI preserves two related but distinct signals:

- **Unread:** something important changed while the workspace was inactive.
- **Attention:** the agent is currently blocked on an actionable reason.

Transitions to blocked or done set the agent unread marker for an inactive
workspace. Only actionable blocked records contribute agent attention.

Attention is derived from current agent records rather than toggled blindly. The
reducer recomputes it after updates, cleanup, expiry, navigation, and layout
changes. This prevents a classic state bug: a red alert remaining after its
underlying blocked record is gone.

Selecting or focusing the workspace acknowledges both markers. The agent record
stays visible; acknowledgement changes notification state, not lifecycle truth.

## 19.10 Presentation, ordering, and accessibility

The sidebar is a coordination surface, so ordering favors actionability:

```text
blocked → working → done → idle → unknown
```

Within a state, newer reports come first; `agentId` is the deterministic final
tie-breaker. Sorting occurs in a pure view helper and never mutates reducer state.

Machine detail becomes concise text:

```text
web-search       → searching web
approval         → waiting approval
user-input       → waiting input
authentication   → authentication needed
```

Each row is a native button with a focus-visible outline. Its accessible label
contains provider name, semantic state, detail, workspace, and optional message.
Working dots pulse, but a reduced-motion media query disables animation.

When the sidebar is collapsed, the expand button's accessible label includes the
total and blocked-agent counts. Important state does not become completely hidden.

## 19.11 Focusing the exact terminal

Focusing is a state transition followed by an imperative DOM action.

First, the reducer:

1. finds the agent;
2. verifies its workspace and surface still exist;
3. selects the workspace;
4. uses `workspaceReducer` to select the pane;
5. selects the surface within that pane;
6. acknowledges unread/attention markers.

Then the UI dispatches a `cmux:focus-surface` browser event on the next animation
frame. The matching `TerminalHost` refits xterm.js and calls `term.focus()`.

Why not call `focus()` immediately? React may not yet have made the workspace and
surface visible. Deferring one frame lets the declarative selection render before
the imperative terminal API runs.

The external `focus-agent` socket command reuses the same reducer action. There is
one navigation implementation for mouse and automation.

## 19.12 Query and automation methods

The socket adds:

```text
agent-report  agent-clear  list-agents  focus-agent  wait-agent
```

`list-agents` can filter by workspace. `focus-agent` rejects missing identities
before routing to React. `agent-clear` can require the stored reporter source.

`wait-agent` accepts one or more semantic states and a timeout:

```bash
cmux wait-agent codex:hooks:term-1 \
  --state blocked,done \
  --timeout-ms 30000
```

The current implementation polls main's in-memory mirror no more often than every
50 ms. Polling was chosen because it is small, bounded, and adequate for local
human-scale lifecycle transitions. The wait rejects display activities such as
`web-search`; callers must depend on stable semantics.

An event subscription registry would reduce wakeups and latency variance, but it
would require connection cancellation, waiter cleanup, and race-safe notification
logic. It is a reasonable future change if wait volume grows.

## 19.13 Adapter architecture

Provider schemas stop at `bin/`:

```text
provider JSON/event → adapter mapper → provider-neutral CLI request
```

The application contract never includes provider event names such as
`PermissionRequest` or `session.idle`.

### Command-hook mapping

`bin/agent-events.js` converts common lifecycle events:

| Event               | Result                             |
| ------------------- | ---------------------------------- |
| `SessionStart`      | idle                               |
| `UserPromptSubmit`  | working / thinking                 |
| `PreToolUse`        | working plus tool-derived activity |
| `PermissionRequest` | blocked / approval                 |
| `Notification`      | blocked / approval or user-input   |
| `PostToolUse`       | working / thinking                 |
| failure event       | blocked / tool-error               |
| `Stop`              | done                               |
| `SessionEnd`        | clear                              |

Tool-name inference is intentionally lossy and presentational. A name containing
web/search/fetch becomes web-search; read/find becomes reading; edit/write becomes
editing; test commands become testing; shell tools become running-command; the
fallback is thinking.

### Codex

The installer adds supported lifecycle commands to `~/.codex/hooks.json` and
preserves other groups. Codex requires explicit review/trust of new hooks through
`/hooks`, so setup reminds the user instead of assuming authority.

### Claude Code

The installer adds lifecycle commands to `~/.claude/settings.json`, including
notification, failure, stop, and session-end coverage. The older
`cmux hooks setup` command remains a compatibility alias for this integration.

### OpenCode

OpenCode plugins receive tool, permission, session, and status events. The
generated plugin uses `Bun.spawn` to call the same CLI contract. A marker declares
the file managed by cmux-linux; setup updates only a marked file and refuses to
overwrite an unrelated plugin.

### Custom reporters

Any process inside a pane can call `cmux agent-report --provider custom`. It gets
the same validation, rendering, focus, clear, TTL, and wait behavior as built-in
adapters.

## 19.14 Configuration-writing strategy

Provider setup is a local operation and does not open the app socket. For JSON
configuration, it:

1. parses the existing file or starts with an empty object if absent;
2. fails closed on invalid JSON or a non-object root;
3. preserves all unrelated keys and existing hook groups;
4. detects its exact command before appending;
5. writes only when content changes;
6. writes a temporary file in the same directory and atomically renames it.

The installed command is guarded:

```sh
command -v cmux >/dev/null 2>&1 && cmux agent-hook <provider>
```

The CLI itself also checks `CMUX_SOCKET_PATH` and `CMUX_SURFACE_ID`. Therefore a
global hook is a no-op when the provider runs outside a cmux-linux terminal.

Idempotence is operational safety, not merely convenience. Setup commands are
often rerun during upgrades. Duplicate hooks would emit duplicate lifecycle
events and could make attention flicker.

## 19.15 Failure handling and operational behavior

Lifecycle reporting is observational; it must not break the agent being observed.

- Invalid hook stdin is ignored.
- Unknown hook events are ignored.
- Hooks outside a cmux pane exit successfully.
- A missing socket or closed app is ignored by hook-mode CLI calls.
- The OpenCode plugin catches spawn failures and discards output.
- Invalid user-invoked CLI requests still return useful errors.
- Invalid provider configuration is not overwritten.
- An unmanaged OpenCode plugin is never replaced.
- A wait has a strict maximum timeout and returns a normal error.

This is a deliberate split: manual commands are diagnostic and should reveal
errors; background observation hooks should be fail-open for the provider's main
workflow.

## 19.16 Security and trust boundaries

There are four relevant trust decisions.

### External JSON is data, not TypeScript

Main validates every field. Length limits and control-character normalization
reduce UI injection and log/terminal confusion. Enumerated values prevent unknown
CSS state classes from becoming protocol semantics.

### Reporter source is ownership metadata, not strong authentication

The reducer prevents an existing identity from changing source, and clear can
check the stored source. This blocks accidental collisions between well-behaved
adapters.

The Unix socket currently has no cryptographic authentication. Another local
process with access to the socket can claim a source. A multi-user threat model
would require restrictive socket permissions, peer credential checks, or an
application-issued capability token.

### Provider configuration requires care

Setup preserves existing JSON and refuses unmanaged plugin replacement. Codex
hook trust remains an explicit user action. Future hardening could preserve exact
file modes and ownership metadata during atomic replacement.

### The renderer stays isolated

Provider adapters never receive Electron or DOM access. External events enter
through the Unix socket, cross a narrow typed IPC payload, and reach pure reducer
logic. The preload bridge does not expose filesystem or socket primitives to the
web page.

## 19.17 Persistence and lifecycle scope

Agent records describe live external processes. Restoring yesterday's `blocked`
record would be actively misleading: the terminal process is respawned, the agent
may not be running, and the permission request may no longer exist.

The session snapshot therefore excludes:

- current agent records;
- agent unread markers;
- agent attention markers;
- expiry timers.

Layout and cwd still restore. New provider events repopulate current truth.

A future history feature should use an append-only event model with explicit
session ids and retention, separate from the live `AgentRecord[]` projection.
Historical observability and current coordination are different products.

## 19.18 Testing strategy

The test design follows the boundaries in the architecture.

### Pure contract tests

Exercise valid/invalid enums, string normalization, derived ids, revision parsing,
TTL bounds, and attention classification without Electron.

### Reducer consistency tests

Prove surface binding, stale revision rejection, focus of workspace/pane/surface,
acknowledgement, expiry, pane/workspace cleanup, and empty restoration.

### View tests

Verify labels, urgency ordering, and accessible text as pure functions. CSS is
then checked in a real disposable Electron window.

### Socket and wait tests

Use a temporary Unix socket and controlled mirror to prove resolution,
validation, query results, source mismatch behavior, focus routing, satisfied
waits, and bounded timeouts.

### CLI process tests

Spawn the real CLI against a controlled socket. This catches argument parsing,
environment defaults, JSON framing, and hook stdin mapping that unit tests alone
would miss.

### Installer filesystem tests

Use temporary directories to prove existing settings survive, every supported
event is installed, a second run is unchanged, and unmanaged plugins are
protected.

Finally, lint, TypeScript checking, a production bundle, a disposable visual run,
and an isolated all-provider setup smoke test cover integration behavior outside
the pure modules.

## 19.19 Alternatives and tradeoffs

| Choice                          | Benefit                       | Cost / reason not selected                                                 |
| ------------------------------- | ----------------------------- | -------------------------------------------------------------------------- |
| Parse terminal text             | requires no provider setup    | fragile, localized, decorated, and semantically incomplete                 |
| Inspect OS process state        | universal                     | cannot distinguish approval, input, web search, or done turns              |
| Watch state files               | durable and inspectable       | awkward event ordering, cleanup, focus requests, and waits                 |
| Put canonical state in main     | socket queries become direct  | duplicates layout ownership or requires main to understand renderer layout |
| Free-form status strings        | easy to add labels            | unreliable automation and inconsistent urgency semantics                   |
| Provider-specific React records | preserves all provider detail | spreads schema churn through core state and UI                             |
| Persist live records            | survives restart              | displays stale claims about dead processes                                 |
| Event-driven waiter registry    | efficient at scale            | more race, cancellation, and cleanup complexity for little current gain    |
| Overwrite integration files     | simplest installer            | destroys user configuration and breaks trust                               |
| Fail hook calls loudly          | easier adapter diagnosis      | provider work could fail because the observer/app is unavailable           |

The chosen design optimizes for stable semantics, safe local operation, and small
reviewable boundaries rather than maximal provider detail.

## 19.20 Extension points

The architecture leaves clear places for future work:

- Add a provider by writing an adapter that emits the existing contract.
- Add a new semantic state only through the shared enum, validator, wait parser,
  reducer policy, labels, colors, tests, and protocol documentation together.
- Add richer detail without changing automation by extending activities/reasons.
- Replace polling waits with subscriptions behind the same socket method.
- Add event ids for deduplication across retrying producers.
- Add a `startedAt` or bounded transition history for duration metrics.
- Issue per-pane capability tokens if the local security model strengthens.
- Group multiple agents by workspace/provider in the view without changing
  record ownership.
- Add provider-version fixtures to detect lifecycle schema drift.
- Build a history/analytics store as a separate projection, leaving live state
  ephemeral.

## 19.21 End-to-end worked examples

### An approval request

```text
1. Codex emits PermissionRequest with session and tool metadata.
2. The installed hook pipes JSON to `cmux agent-hook codex`.
3. `mapAgentEvent` returns blocked / approval and "Approve <tool>".
4. The CLI supplies workspace and surface ids from its pane environment.
5. Main resolves the workspace, validates the report, and stamps local time.
6. React binds the surface to its pane and upserts the record.
7. An inactive workspace becomes unread and flashes for attention.
8. AgentList orders the blocked record first and says "waiting approval".
9. Clicking it selects the exact terminal and focuses xterm.js.
```

### A web search followed by completion

```text
1. A pre-tool event names a web/search tool.
2. The adapter emits working / web-search.
3. The sidebar says "searching web" with a pulsing working dot.
4. The provider emits Stop.
5. The same derived agent id is updated to done.
6. The working animation stops; an inactive workspace gets an unread marker.
7. `cmux wait-agent <id> --state done` returns the current record.
```

### A provider outside cmux-linux

```text
1. The provider launches in an ordinary terminal.
2. Its global hook checks whether `cmux` exists.
3. If it does, `agent-hook` checks pane identity variables.
4. With no cmux surface/socket identity, it exits successfully without reporting.
5. The provider continues unaffected.
```

## Sources and further reading

- Codex lifecycle hooks: https://learn.chatgpt.com/docs/hooks
- Claude Code hooks: https://code.claude.com/docs/en/hooks
- OpenCode plugins and events: https://opencode.ai/docs/plugins/
- Node.js Unix-domain sockets (`node:net`): https://nodejs.org/api/net.html
- Electron context isolation: https://www.electronjs.org/docs/latest/tutorial/context-isolation
- WAI-ARIA button guidance: https://www.w3.org/WAI/ARIA/apg/patterns/button/

## Checkpoint

1. Why can a sleeping OS process still represent a working agent?
2. Which state/detail combinations are legal, and why enforce that in main?
3. Why does the renderer derive `paneId` instead of trusting the reporter?
4. What guarantee does `revision` provide, and what does it not provide for an
   unsequenced hook?
5. Why is `source` useful even though it is not local-user authentication?
6. What is gained and lost by keeping canonical agent state in the renderer?
7. Why should background hooks fail open while manual CLI commands report errors?
8. When would event-driven waits become preferable to 50 ms polling?
9. Why are live records excluded from persistence?
10. Where would you add a new provider without leaking its schema into React?
