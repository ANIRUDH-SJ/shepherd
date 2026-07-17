# M7 — Semantic Agent Runtime: What We Actually Built

> This is the implementation diary for agent lifecycle state, automation, and the
> sidebar agent list. For the general design principles, architecture, trust
> boundaries, and tradeoffs, read
> `../textbook/19-semantic-agent-runtime.md`.

## 1. The goal

The workspace subtitle and notification system could already say that something
needed attention, but it could not answer four precise questions:

1. Which agent produced the state?
2. Is the agent working, blocked, finished, or merely idle?
3. What is it doing, or what is it blocked on?
4. Which exact terminal should receive focus when the user clicks it?

M7 adds a provider-neutral runtime model and makes it visible and controllable.
The result is a dedicated Agents section that can show states such as:

```text
Claude Code  waiting approval
Codex        searching web
OpenCode     done
```

These labels are not scraped from terminal text. They come from validated
lifecycle reports sent through the existing Unix socket.

## 2. The complete data flow

```text
provider lifecycle event
  → installed command hook or managed OpenCode plugin
  → bin/agent-events.js maps provider vocabulary to the cmux contract
  → cmux agent-report sends newline-delimited JSON over the Unix socket
  → src/main/socket.ts resolves the workspace and validates the report
  → App.tsx receives the socket command through the preload bridge
  → appReducer binds the report to a real workspace/pane/surface
  → Sidebar → AgentList renders semantic state and detail
  → clicking a row selects and focuses that exact xterm.js terminal
```

The reverse control direction is available too:

```text
cmux list-agents
cmux focus-agent <agent-id>
cmux wait-agent <agent-id> --state blocked,done
cmux agent-clear <agent-id> --source <reporter-source>
```

## 3. `src/shared/agent.ts` — one provider-neutral contract

The shared module separates durable state from display detail.

### Semantic state

`AgentState` is deliberately small:

```ts
;'working' | 'blocked' | 'done' | 'idle' | 'unknown'
```

These values are stable enough for automation. A script can wait for `done`
without caring whether the agent was reading, editing, or searching before it
finished.

### Working detail

`AgentActivity` is only valid while `state === 'working'`:

```ts
;'thinking' | 'reading' | 'editing' | 'running-command' | 'testing' | 'web-search' | 'waiting'
```

The sidebar turns those machine values into human labels such as “reading files”
and “searching web.”

### Block detail

`AgentBlockReason` is only valid while `state === 'blocked'`:

```ts
;'approval' | 'user-input' | 'authentication' | 'tool-error' | 'external'
```

This distinction decides whether the workspace should demand attention.
`agentNeedsAttention()` treats an external wait as non-actionable; the other
blocked reasons mean the user can probably unblock the agent.

### Identity and provenance

An `AgentReport` carries:

- `agentId`: stable identity for upsert, focus, clear, and wait operations.
- `provider`: `codex`, `claude`, `opencode`, or `custom`.
- `source`: the reporter authority, such as `codex:hooks`.
- `sessionId`: optional provider-native provenance.
- `workspaceId` and `surfaceId`: the terminal ownership coordinates.
- `revision`: an optional producer sequence number.
- `updatedAt`, optional `staleAt`, and optional `expiresAt`: local lifecycle
  timing with separate loss-of-confidence and removal boundaries.

When the caller omits `agentId`, validation derives it from
`source + surfaceId`. That keeps one hook reporter in one terminal stable across
many events.

`AgentRecord` adds `paneId`. The reporter does not supply that field; the renderer
derives it from the real layout tree after proving that the reported surface
exists.

## 4. Runtime validation in `normalizeAgentReport()`

Socket JSON is untrusted at runtime even though the application is written in
TypeScript. `normalizeAgentReport()` therefore checks and normalizes every field
before React sees it.

It:

- accepts only known providers, states, activities, and block reasons;
- requires a real workspace id, surface id, and safe source id;
- rejects activity on a non-working state;
- rejects block reasons on a non-blocked state;
- removes control characters and collapses display whitespace;
- limits labels and messages to bounded lengths;
- accepts only non-negative integer revisions;
- limits stale and expiry windows to one millisecond through 24 hours;
- requires `staleAfterMs` to be earlier than `ttlMs` when both are supplied;
- replaces producer time with the local ingestion time.

The local timestamp gives reports one clock inside the application. A remote or
misconfigured hook cannot place a record arbitrarily far into the future.

## 5. `src/renderer/src/state/appReducer.ts` — lifecycle ownership

`AppState` now owns a flat `agents: AgentRecord[]` collection. The records refer
back to the existing workspace layout by ids; they do not duplicate the layout
tree.

### Reporting and upsert

The `reportAgent` helper first finds the workspace, then calls
`findPaneBySurfaceId()` to prove that the terminal exists. Invalid ownership is a
no-op.

If the agent already exists, its `source`, `workspaceId`, and `surfaceId` cannot
change. This prevents an update from silently moving an existing identity to a
different reporter or terminal.

Sequenced reports with `revision <= previous.revision` are ignored. Unsequenced
reports remain supported; the reducer assigns the next local revision so simple
hooks do not need their own counter.

### Unread and attention

A blocked or done transition marks an inactive workspace unread. Actionable
blocked records also make it flash for attention. Selecting that workspace or
focusing its agent acknowledges both markers.

Attention is derived again after report, clear, expiry, selection, focus, close,
or layout changes. It therefore cannot remain stuck after the record responsible
for it disappears.

### Cleanup

Freshness and retention are intentionally different. When `staleAt` passes, the
record remains discoverable but changes to `unknown`; activity and block reason
are cleared, and workspace attention is derived again. `updatedAt` stays at the
last real observation so the UI shows how old the source report is. The producer
revision is also preserved so a subsequent sequenced report can resume at its
next number. When `expiresAt` passes, the record is removed.

The reducer removes agents when:

- an authorized `agent-clear` arrives;
- their `expiresAt` time passes;
- their terminal process exits, even if the surface remains open;
- their workspace closes;
- their terminal surface disappears after a pane/tab change;
- a restored session is loaded.

Lifecycle state is intentionally ephemeral. The saved session still contains
layout and cwd, not claims about processes that may no longer exist.

## 6. Protocol, query, socket, and wait modules — external control

The socket advertises nine agent methods.

| Method           | Purpose                                                          |
| ---------------- | ---------------------------------------------------------------- |
| `agent-report`   | validate and apply one lifecycle observation                     |
| `agent-clear`    | remove a record, optionally proving the reporter source          |
| `list-agents`    | filter, bound, and summarize current records                     |
| `agent-snapshot` | return a versioned workspace/agent snapshot for reconnecting     |
| `focus-agent`    | ask the renderer to select an agent's exact terminal             |
| `inspect-agent`  | return bounded terminal, cwd, and foreground-process context     |
| `wait-agent`     | wait until an agent reaches one of the requested semantic states |
| `agent-schema`   | return the machine-readable versioned wire contract              |
| `agent-capabilities` | discover semantic, feature, limit, and adapter support       |

Main keeps a read-only mirror of renderer workspace names, the active workspace,
and current agents. This mirror lets external commands resolve targets and answer
queries without making the socket protocol depend on renderer callbacks.

`normalizeAgentQuery()` validates comma-separated or array filters for provider,
state, activity, and block reason. It also supports exact source, session, and
surface filters, a strict `updatedAfter` ingestion-time cursor, and a result limit
from 1 through 1,000. The default is 200, preventing an accidental unbounded
reply. Different filter dimensions combine with AND; values inside one dimension
combine with OR.

`queryAgents()` sorts matches newest-first, applies the result limit, and returns
`matched` plus `truncated` so callers can distinguish “one match” from “one of
many returned.” Its summary counts all matches by semantic state and provider and
counts actionable blocks, even when only the newest subset is returned.

`agent-snapshot` uses the same query path and adds schema version, generation
time, active workspace id, and workspace identities. It is a current reconnect
snapshot, not persisted history.

`src/shared/agentProtocol.ts` publishes a JSON Schema Draft 2020-12 document for
all nine methods. It describes newline-delimited socket envelopes, canonical
params and results, enum values, conditional state/detail rules, record and
summary shapes, and numeric bounds. Numeric inputs include both integers and
digit strings because the plain CLI really sends flag values as strings.

`agentProtocolCapabilities()` reports what this application build supports:
method names, semantics, lifecycle/query/inspection/wait limits, feature flags, and shipped
adapter behavior. An optional provider narrows the adapter list. It deliberately
does not claim that a hook is installed in the user's home directory; build
support and local installation state are different facts.

`src/shared/agentLimits.ts` is the single source for lifecycle, query, inspection,
and wait bounds. Validation and discovery import those constants, preventing the
schema from advertising numbers that runtime code no longer accepts.

`src/main/terminalInspection.ts` owns a separate live-terminal projection. Each
PTY gets a 256 KiB byte ring registered at spawn, refreshed on `onData`, updated
on resize, and removed on exit/dispose. `inspect-agent` first resolves a current
agent record, then uses its verified surface id to read that capture. This avoids
letting a caller invent an unrelated surface target.

Inspection converts raw terminal bytes to diagnostic plain text by removing
ANSI/OSC sequences, carriage-return redraws, control bytes, and bidi controls.
The reply has independent line and byte limits (50/16 KiB by default, 500/64 KiB
maximum) plus a truncation flag. On Linux it reads `/proc` for the foreground
process-group leader and cwd, exposing only PID and process name—not command-line
arguments that may contain secrets. Other platforms safely return no foreground
identity and retain the initial cwd.

`normalizeAgentWait()` requires a stable agent id, one or more semantic states,
and a timeout between 1 ms and 300 seconds. `waitForAgent()` polls the in-memory
mirror at intervals of at most 50 ms and returns either the matching record or a
bounded timeout error. Activities such as `web-search` are rejected because an
automation wait should use the stable semantic layer.

`agent-clear` checks the optional source against the stored record. This protects
against accidental cross-adapter cleanup. It is not authentication against
another local process that can access the Unix socket; that stronger boundary is
documented as future hardening.

## 7. `bin/cmux.js` — the human and adapter interface

The CLI adds:

```bash
cmux agent-report --provider codex --state working \
  --activity web-search --message "researching docs"

cmux list-agents --provider codex,claude --state blocked,done --limit 50
cmux agent-snapshot --updated-after 1784271000000
cmux agent-schema
cmux agent-capabilities codex
cmux inspect-agent codex:hooks:term-1 --lines 25 --max-bytes 4096
cmux focus-agent codex:hooks:term-1
cmux wait-agent codex:hooks:term-1 --state blocked,done --timeout-ms 30000
cmux agent-clear codex:hooks:term-1 --source codex:hooks
```

Inside a pane, the existing environment injection supplies
`CMUX_WORKSPACE_ID`, `CMUX_SURFACE_ID`, and `CMUX_SOCKET_PATH`. The CLI also
defaults `source` to `cli:<provider>` for manual reports.

`agent-hook` is an internal adapter entry point. It reads one JSON event from
stdin, maps it, and forwards the resulting socket command. Hook failures are
quiet: if the app has closed or the socket is unavailable, an agent's own work
must continue normally.

## 8. `bin/agent-events.js` — translating provider events

`mapAgentEvent()` is the shared translation layer for command-hook providers.
It maps lifecycle events as follows:

| Provider event                      | Semantic report                                |
| ----------------------------------- | ---------------------------------------------- |
| `SessionStart`                      | `idle`                                         |
| `UserPromptSubmit`                  | `working / thinking`                           |
| `PreToolUse`                        | `working` plus inferred activity               |
| `PermissionRequest`                 | `blocked / approval`                           |
| `Notification`                      | `blocked / approval` or `blocked / user-input` |
| `PostToolUse`                       | `working / thinking`                           |
| compact/subagent lifecycle          | `working / thinking` plus safe detail          |
| `PostToolUseFailure`, `StopFailure` | `blocked / tool-error`                         |
| `Stop`                              | `done`                                         |
| `SessionEnd`                        | clear the surface-owned record                 |
| unsupported lifecycle event         | `unknown` plus the event name only             |

Tool-name mapping recognizes web/search, read/find, edit/write, command, and test
activity. It is intentionally a small heuristic at the adapter boundary. The
core state model never depends on provider tool names.

Codex does not document a monotonic numeric hook sequence, so its adapter does
not invent one. It preserves a numeric `revision`/`sequence` if a producer
supplies it and adds state-sensitive freshness and TTL policy. Working and idle
reports become `unknown` after 30 minutes and expire after two hours. Approval
blocks become `unknown` after 12 hours and expire after 24 hours. Done and unknown
records expire after 30 minutes without an intermediate transition. This avoids
presenting silence as current truth while preserving a bounded diagnostic record.

## 9. Provider setup and configuration safety

`cmux integrations setup` installs one provider or all three:

```bash
cmux integrations setup codex
cmux integrations setup claude
cmux integrations setup opencode
cmux integrations setup all
```

The default paths are:

| Provider    | Installed file                             |
| ----------- | ------------------------------------------ |
| Codex       | `~/.codex/hooks.json`                      |
| Claude Code | `~/.claude/settings.json`                  |
| OpenCode    | `~/.config/opencode/plugins/cmux-agent.js` |

The JSON installers read the existing object, preserve unrelated settings and
hooks, append only missing cmux groups, and atomically rename a temporary file.
Running setup twice is idempotent and avoids a second rewrite.

The generated command starts with `command -v cmux ...`. Global configuration is
therefore harmless when the agent launches outside cmux-linux.

Codex requires the user to review and trust newly installed hooks through
`/hooks`; the setup command prints that reminder. The OpenCode adapter is a
generated managed plugin. Its marker lets setup update its own file while
refusing to overwrite a file it does not own.

`cmux hooks setup` remains as a compatibility alias for Claude Code setup.

## 10. OpenCode's direct plugin adapter

OpenCode exposes a JavaScript plugin event API rather than the same command-hook
shape. `bin/integrations/opencode.js` writes a small managed plugin that reports:

- tool execution as working plus inferred activity;
- permission requests as blocked on approval;
- permission replies as working;
- created sessions as idle;
- idle sessions as done;
- session errors as blocked on a tool error;
- busy/retry status as working;
- deleted sessions as clear.

It launches `cmux` with `Bun.spawn`, ignores stdout/stderr, and catches failures.
Like the command hooks, it first checks for pane identity so it does nothing
outside cmux-linux. The long-lived plugin emits monotonic revisions seeded from
`Date.now()`, so a plugin reload starts above revisions from its previous run.

## 11. `AgentList.tsx`, `agentView.ts`, and CSS — presentation

Presentation logic stays outside the reducer:

- `agentStatusLabel()` converts machine values into concise text.
- `sortAgentsForSidebar()` orders blocked, working, done, idle, then unknown;
  within a state, the newest record appears first.
- `agentAriaLabel()` combines name, state, detail, workspace, and message for
  assistive technology.
- `formatAgentElapsed()` turns local ingestion time into stable `now`, seconds,
  minutes, hours, or days labels.
- `agentRollupLabel()` counts each workspace by urgency and shows the two most
  important state groups, folding additional agents into a compact `+N`.

`AgentList` renders real buttons, not clickable divs. Each row contains a state
dot, provider display name, semantic/detail label, elapsed time, workspace name,
and optional message. A ten-second display timer refreshes only the age labels;
it does not infer lifecycle state. CSS gives each state a distinct color; working
pulses unless the user prefers reduced motion. A sidebar container query hides
the visual age at narrow widths while the title and accessible label retain it.

Every workspace row also renders a compact summary such as
`2 blocked · 3 working`. This lets the workspace list remain useful when the
dedicated Agents section is below the fold.

When the sidebar is collapsed, its accessible label still reports the agent
count and blocked count.

## 12. Exact terminal focus

Clicking an agent has two coordinated effects:

1. `focusAgent` selects the owning workspace, pane, and surface in reducer state.
2. On the next animation frame, `cmux:focus-surface` is dispatched with the
   surface id.

`TerminalHost` listens for that event, refits the terminal, and calls
`term.focus()`. The animation-frame boundary gives React time to reveal the
selected workspace and tab before xterm receives focus.

The same reducer action is used by the socket `focus-agent` method, so UI clicks
and automation share one navigation rule.

## 13. Tests added

The feature adds coverage at every meaningful boundary:

- `src/shared/agent.test.ts`: normalization, defaults, sanitization, invalid
  combinations, stale/TTL ordering, sequencing inputs, and attention semantics.
- `src/shared/agentQuery.test.ts`: enum/exact filters, cursor and limit bounds,
  newest-first selection, truncation metadata, and summaries.
- `src/shared/agentProtocol.test.ts`: schema version, method/enum/ownership fields,
  CLI numeric shapes, feature discovery, and provider filtering.
- `src/renderer/src/state/appReducer.test.ts`: binding, stale-event rejection,
  unread/attention, exact focus, stale-to-unknown transition, expiry,
  terminal-exit cleanup, pane cleanup, workspace cleanup, and restore behavior.
- `src/renderer/src/agentView.test.ts`: labels, urgency ordering, elapsed-time
  buckets, workspace rollups, and accessibility text.
- `src/main/agentWait.test.ts`: wait validation, state transitions, and timeout.
- `src/main/terminalInspection.test.ts`: option bounds, ANSI removal, line/byte
  tails, capture-ring truncation, process metadata, resize, and cleanup.
- `src/main/socket.test.ts`: report validation, routing, filtered list, reconnect
  snapshot, bounded inspection, focus, wait, source protection, and clear.
- `bin/agent-events.test.js`: provider-event/tool mappings, safe fallback,
  producer revision handling, and Codex expiry policy.
- `bin/integrations.test.js`: config preservation, all installed events,
  idempotence, OpenCode sequencing, managed-plugin ownership, and
  unknown-provider rejection.
- `bin/cmux.test.js`: real CLI requests, flag mapping, pane targeting, and a
  Codex permission event becoming `blocked / approval`.

The completed stack was also checked with `npm test`, `npm run lint`,
`npm run typecheck`, `npm run build`, a disposable Electron/Xvfb visual run, and
an isolated install smoke test for all three provider integrations.

## 14. Intentionally deferred

- Authenticated multi-user access to the local Unix socket.
- Event-driven wait subscriptions instead of bounded 50 ms polling.
- Durable agent history across application launches.
- Automatic freshness defaults when a provider supplies neither cleanup nor
  stale/TTL policy.
- Multiple simultaneous sessions from the same reporter in one surface unless
  the integration supplies distinct `agentId` values.
- Editable color/order preferences for the Agents section.
- A provider SDK package; current integrations use documented lifecycle hooks or
  plugin APIs and the shipped CLI.

## Checkpoint

1. Why are `working` and `web-search` represented in different fields?
2. Why does main validate a report before forwarding it to React?
3. How does the reducer stop one agent identity from moving to another terminal?
4. What does `revision` protect against, and how do unsequenced hooks still work?
5. Why does a stale transition preserve both `updatedAt` and `revision`?
6. Why is lifecycle state omitted from the saved session?
7. What happens between clicking an agent row and xterm receiving keyboard focus?
8. Why do global provider hooks silently do nothing outside a cmux-linux pane?
9. Why does a limited query summarize all matches instead of only returned rows?
10. Why must capability discovery distinguish build support from local install state?
11. Why does inspection resolve an agent id instead of accepting any surface id?
