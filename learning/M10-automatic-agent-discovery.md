# M10 — Automatic agent discovery

## The goal

An agent running in a cmux-linux terminal should appear in the Agents sidebar
without asking the user to install a hook, edit a provider config, or run
`cmux agent-report`.

M7 already gave us a rich semantic agent protocol. Its provider integrations are
still useful because they can report exact states such as `blocked`, `done`, and
`web-search`. M10 adds the missing zero-setup baseline: Linux process discovery
automatically supplies presence plus `working`/`idle`, and a richer lifecycle
report takes precedence when one is available.

The result is a layered design:

```text
terminal process exists
  -> automatic process report (always available for recognizable agents)
  -> optional provider lifecycle report replaces it on the same surface
  -> one agent row, never two competing rows
```

## What changed

| File                                        | Responsibility                                               |
| ------------------------------------------- | ------------------------------------------------------------ |
| `src/main/agentDiscovery.ts`                | Classify process trees and reconcile automatic reports       |
| `src/main/agentDiscovery.test.ts`           | Test providers, generic fallback, precedence, and cleanup    |
| `src/main/terminalInspection.ts`            | Read safe process ancestry and PTY activity timestamps       |
| `src/main/terminalInspection.test.ts`       | Test the discovery-facing terminal context                   |
| `src/main/pty.ts`                           | Record terminal input as activity                            |
| `src/main/index.ts`                         | Start and stop the scanner, then mirror renderer agent state |
| `src/shared/agentProtocol.ts`               | Advertise automatic discovery and safe command identity      |
| `src/renderer/src/components/AgentList.tsx` | Describe the empty state as detection, not reporting         |

## 1. The PTY registry became the discovery boundary

Every terminal already registers a `surfaceId`, `workspaceId`, and shell PID in
`terminalInspection.ts`. M10 extends the same in-memory record with:

```ts
lastInputAt: number
lastOutputAt: number
```

`pty.ts` records input just before writing it to the child process. PTY output is
timestamped when it enters the existing bounded inspection capture. Discovery
uses the newer timestamp as `lastActivityAt`; it does not parse terminal prose to
guess what the agent said.

`listTerminalProcessContexts()` turns each registered terminal into this safe
shape:

```ts
interface TerminalProcessContext {
  surfaceId: string
  workspaceId?: string
  shellPid: number
  processes: ForegroundProcess[]
  lastActivityAt: number
}
```

This keeps discovery attached to a real cmux-linux terminal. We do not scan all
of `/proc` and then guess which workspace owns an unrelated process.

## 2. Why process ancestry matters

The Linux terminal foreground process is not always the agent itself. An agent
may temporarily run `bash`, `git`, a test runner, or another tool. Looking only at
the foreground PID would make the sidebar row disappear during every tool call.

`linuxProcessContext()` starts at the terminal foreground process group and
walks parent PIDs until it reaches the registered shell, with two hard bounds:

- at most 16 processes;
- no revisiting a PID.

The ordered list is foreground-first. Classification can therefore find Codex
behind a child `bash` without looking outside that terminal's process tree.

## 3. Safe command identity

Runtime wrappers often hide the useful name:

```text
node .../claude-code/cli.js
python .../kimi_cli/__main__.py
bun .../opencode
```

`processCommand()` reads `/proc/<pid>/comm`, `/proc/<pid>/exe`, and the process
argument vector, but retains only a sanitized executable or script basename.
Arguments, prompts, repository content, and environment variables are never put
in an agent record.

Known wrappers such as Node, Python, Bun, npm, pnpm, Yarn, and `uv` are skipped so
the classifier sees the wrapped command. Generic entry points such as `cli.js`
and `__main__.py` use their parent-directory name when that is more meaningful.

All `/proc` reads tolerate races. A process can exit between any two reads, so a
failed lookup becomes an empty identity instead of crashing Electron main.

## 4. Provider classification

`classifyAgentProcesses()` tests each safe command and process name against a
provider-neutral rule table. The built-in aliases cover:

- Codex, Claude Code, OpenCode, and Kimi;
- Aider, Goose, Amp, Gemini CLI, Qwen Code, and Copilot;
- Cursor Agent, Crush, Cody, Plandex, and Mentat.

The existing protocol has first-class provider values for Codex, Claude, and
OpenCode. Other tools use `provider: 'custom'` while keeping their real display
name. This avoids a protocol migration every time a new CLI appears.

A delimiter-aware fallback accepts executable names such as
`my-review-agent`. It deliberately rejects partial words such as `agentless`, and
ordinary processes such as shells and editors do not match.

Adding a well-known tool later is one rule-table entry, not a new integration
installer.

## 5. State without terminal-text scraping

Automatic discovery can prove that a process is present and observe recent PTY
traffic. It cannot honestly infer every provider's private lifecycle state.

The zero-setup state rule is intentionally small:

```ts
now - lastActivityAt <= 3_000 ? 'working' : 'idle'
```

Recent keyboard input or terminal output means `working`; three quiet seconds
means `idle`. Exact states such as approval waits, web search, completion, or an
error require a structured lifecycle event. Those events remain automatic when
the provider exposes supported hooks or plugins, but they are enrichment rather
than a requirement for the agent to be listed.

## 6. Reconciliation and authority

`AutomaticAgentDiscovery` scans once per second. Its automatic identity is stable
for a surface:

```text
<provider>:auto:<surfaceId>
```

Reports carry `source: "process:auto"`. The reconciler caches a signature made
from the workspace, identity, PID, safe command, and state, so unchanged scans do
not churn React state or live subscriptions.

Before publishing an automatic report, the scanner checks the renderer's latest
agent mirror. If that surface has any non-automatic report, it clears only the
`process:auto` record and defers to the richer source. If the richer record later
goes away while the process still exists, the next scan restores the automatic
baseline.

This authority rule prevents duplicate rows and prevents a coarse activity
heuristic from overwriting `blocked` or `done`.

## 7. Cleanup

An automatic record is cleared when:

- the recognized process leaves the terminal ancestry;
- the terminal surface disappears;
- the workspace binding is unavailable;
- a richer report claims the surface; or
- Electron begins shutdown.

The clear command includes the automatic source. The reducer therefore cannot
accidentally delete a newer record owned by another reporter.

## 8. Startup and shutdown wiring

`index.ts` now starts the socket server and automatic discovery with the same
renderer command bridge. Workspace sync messages continue to update the socket
mirror and now also give discovery the current agent records used for precedence.

During `before-quit`, discovery stops before terminals and the socket are torn
down. That cancels the interval and clears its transient reports.

## 9. Verification

The automated tests cover:

- direct and runtime-wrapped Codex, Claude Code, OpenCode, Kimi, and Aider;
- a child tool in front of its parent agent;
- a safely named custom agent;
- non-agent and partial-word false positives;
- `working` to `idle` transitions;
- unchanged-scan deduplication;
- richer-source precedence and automatic rediscovery;
- terminal-removal cleanup; and
- the protocol capability flag.

The live smoke test used an isolated app socket and launched a harmless process
whose argument-zero was `kimi`. `cmux list-agents` showed a Kimi record from
`process:auto` without setup. Sending Ctrl-C removed it on the next scan.

## Intentional limits

- This implementation uses Linux `/proc`, which matches this project's target.
- A completely arbitrary executable with no recognizable or agent-like name
  cannot be identified safely. Treating every long-running process as an agent
  would fill the sidebar with shells, editors, servers, and build tools.
- Process discovery reports presence and activity. Provider lifecycle signals
  remain the authoritative source for semantic details.
- Discovery is scoped to terminals owned by cmux-linux, so every detected row has
  an exact workspace and surface to focus.

## Checkpoint

1. Why does discovery walk parent PIDs instead of reading only the foreground PID?
2. Why are argument basenames retained but full argument strings discarded?
3. What prevents an automatic `idle` update from replacing a hook's `blocked` state?
4. Which events remove a `process:auto` record?
5. Why is `working`/`idle` a safer automatic baseline than guessing `done`?
