# M18 — Deferred background startup

## The goal

Shepherd used to construct automatic agent discovery and live Git/workspace
metadata before creating its first `BrowserWindow`. Their initial scans run on
timers, but those timers could expire while React, xterm, node-pty, and the first
shell prompt were still competing for the same main-process event loop and host
resources.

M18 keeps terminal-critical services early and starts the two observers only
after the focused xterm and PTY are usable. It does not remove either feature or
replace readiness with a fixed delay.

## What changed

| File                                           | Responsibility                                       |
| ---------------------------------------------- | ---------------------------------------------------- |
| `src/main/deferredBackgroundServices.ts`       | One-shot coordinator, state replay, and cleanup      |
| `src/main/deferredBackgroundServices.test.ts`  | Scheduling, synchronization, failure, and stop tests |
| `src/shared/ipc.ts`                            | Payload-free first-terminal-ready IPC contract       |
| `src/preload/index.ts`                         | Renderer bridge with process-local deduplication     |
| `src/renderer/src/components/TerminalHost.tsx` | Readiness signal after PTY creation and a frame      |
| `src/main/index.ts`                            | Critical/deferred split and runtime construction     |
| `src/main/runtimePerformance.ts`               | Separate terminal-ready and background-ready phases  |
| `src/shared/runtimePerformance.ts`             | Fixed names for the new diagnostic milestones        |

## 1. Define the critical path

Main still registers PTY IPC, the Unix socket, workspace mirroring, and session
load/save handlers before loading the renderer. The renderer needs those
boundaries to restore state, create a real shell, and remain automatable during
startup.

Only these observers move:

- `startAutomaticAgentDiscovery()`, whose first `/proc` scan begins after its
  one-second interval;
- `startWorkspaceMetadataDiscovery()`, whose first cwd/Git reconciliation begins
  after its 750 ms interval.

Moving their construction means those initial timers begin after terminal
readiness instead of after Electron readiness.

## 2. Report real readiness

`TerminalHost` already opens xterm, fits it, selects WebGL or fallback, subscribes
to output, and invokes `terminal.create()`. For the initially focused terminal,
M18 waits for that invocation to resolve. Main has therefore returned from
`node-pty` creation. The renderer then waits one animation frame and calls:

```ts
window.api.startup.firstTerminalReady()
```

This boundary means the terminal widget exists, has dimensions, owns a live PTY,
and has received a paint opportunity. It does not claim that the user's shell
has printed a prompt. Diagnostic `startup-ready` still measures first output
consumed by xterm followed by a frame.

The effect tracks disposal and cancels a pending frame when its terminal
unmounts. A failed PTY creation does not report readiness. Preload sends the IPC
at most once per renderer process, and the main coordinator is independently
idempotent.

## 3. Coordinate without losing state

`DeferredBackgroundServices` has four states:

```text
waiting -> starting -> started
    \                    |
     +-------> stopped <-+
```

Before readiness, `update(sync)` retains the latest `WorkspacesSync`. This is
important because React may mirror workspaces before either observer exists.
When agent discovery starts, it receives the newest agents. Metadata starts one
turn later and receives the newest workspaces at that moment. Later syncs flow
directly to both live runtimes.

The coordinator therefore delays computation, not truth. It does not queue every
historical snapshot, which would waste memory and replay stale state.

## 4. Spread startup across turns

`firstTerminalReady()` schedules agent discovery with `setImmediate()`. After
that factory returns, the coordinator schedules workspace metadata with another
`setImmediate()`. No arbitrary millisecond constant is involved. Each stage
yields to already queued I/O and rendering work, while the observers' existing
bounded scan intervals remain unchanged.

The scheduler is injectable in tests. The regression test uses a manual queue to
prove:

1. duplicate readiness reports schedule only one start;
2. neither service starts in the readiness turn;
3. the services start on separate turns;
4. the newest pre-start snapshot is replayed;
5. live updates reach both runtimes;
6. shutdown cancels pending work and stops each runtime once; and
7. one failed factory does not prevent the independent service from starting.

Observer callbacks and error reporters are contained so diagnostics cannot
discard a runtime that already started.

## 5. Keep both performance boundaries

The runtime trace now adds `first-terminal-ready`,
`agent-discovery-started`, `workspace-metadata-started`, and
`background-services-started`. The recorder timestamps `startup-ready` as soon
as first PTY output has passed through xterm and a frame. It emits the completed
summary only after the background services are active, so one JSON record
contains both boundaries without redefining terminal readiness.

## 6. Live proof

An isolated production preview used Xvfb, a private socket, and a private session
file. The trace recorded first-terminal readiness at 778.733 ms, agent discovery
at 779.838 ms, metadata discovery at 780.709 ms, and first-output
`startup-ready` at 1094.692 ms. This is one software-rendering smoke observation,
not a before/after benchmark claim.

The socket answered, the window was visible, and changing cwd updated the sidebar
to `Shepherd` and `perf/defer-background-services`. A temporary Kimi-named
foreground process appeared automatically as `working` and disappeared after
exit. That proves deferral preserved both observer contracts.

## What remains

The next performance PR should measure and implement bounded PTY output batching.
A controlled multi-round run is still required before claiming a startup gain.

## Checkpoint

1. Why is a successful PTY creation plus a renderer frame a better trigger than
   a fixed timeout?
2. Why does the coordinator keep only the latest workspace mirror?
3. What is the difference between `first-terminal-ready` and `startup-ready`?
4. Why are the two service factories scheduled on separate turns?
5. What happens if shutdown begins between those turns?
