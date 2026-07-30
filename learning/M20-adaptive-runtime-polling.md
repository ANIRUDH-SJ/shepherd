# M20 — Adaptive Runtime Polling

## 1. The goal

Automatic agent discovery, workspace metadata, agent expiry, and elapsed labels
were already correct, but four independent fixed timers kept waking while the
app was quiet. Unchanged-state suppression avoided redundant IPC, not the
underlying `/proc` reads, Git `HEAD` reads, reducer dispatches, or React updates.

This milestone keeps bounded recovery polling while using terminal activity and
window visibility to choose how often it runs. Quiet operation becomes cheaper,
active terminals stay responsive, and missed events still self-heal.

## 2. Files changed

```text
src/main/
├── adaptivePolling.ts
├── adaptivePolling.test.ts
├── agentDiscovery.ts
├── deferredBackgroundServices.ts
├── index.ts
├── terminalInspection.ts
└── workspaceMetadata.ts
src/renderer/src/
├── App.tsx
├── agentTiming.ts
├── agentTiming.test.ts
└── components/AgentList.tsx
```

Existing tests for discovery, metadata, terminal inspection, and deferred
services now cover their timing contracts. `package.json` includes the two new
test files in `npm test`.

## 3. `AdaptivePollingLoop` is the shared state machine

`src/main/adaptivePolling.ts` owns one non-overlapping async loop. Its policy is
configured with four durations:

- `activeIntervalMs`: fast cadence after relevant activity;
- `idleIntervalMs`: quiet visible fallback;
- `hiddenIntervalMs`: minimized or hidden fallback; and
- `activeForMs`: how long activity keeps the fast cadence.

`start()` schedules one recovery scan. `trigger()` wakes immediately only when
entering an activity burst; repeated events are capped by the active interval.
`triggerNow()` is reserved for authoritative changes such as a new active
surface, a rich agent report, or window restoration.

The loop records the scheduled deadline and never replaces an earlier task with
a later one. While `run()` is pending, another urgent request becomes one
coalesced rerun instead of overlapping work. `stop()` cancels the timer, rejects
new triggers, and prevents late async completion from rescheduling.

Injected `now()` and `schedule()` functions let
`adaptivePolling.test.ts` advance a manual clock. The tests cover active and
quiet cadence, sustained-trigger capping, hidden backoff, restoration during an
in-flight scan, error containment, and idempotent cleanup.

## 4. Terminal inspection publishes content-free activity

`terminalInspection.ts` already receives terminal registration, input, output,
and removal at the correct ownership boundary. It now exposes
`subscribeTerminalInspectionActivity()`.

Each event contains only:

```ts
{
  ;(surfaceId, kind, timestamp)
}
```

It never includes terminal text, prompts, commands, argv, paths, or environment
values. Listener exceptions are caught so scheduling cannot break PTY capture.
Removing or clearing terminals emits lifecycle activity, and every runtime keeps
the returned unsubscribe function for shutdown.

## 5. Agent discovery adapts without losing authority

`startAutomaticAgentDiscovery()` uses:

| State          | Cadence |
| -------------- | ------: |
| Activity burst |     1 s |
| Quiet visible  |     5 s |
| Hidden         |    15 s |

The burst lasts four seconds. The first PTY event after quiet requests an
immediate scan; sustained output cannot exceed the one-second scan cadence. This
still catches the existing three-second `working` to `idle` boundary within one
second after activity.

`AutomaticAgentDiscovery.updateAgents()` now hashes only non-automatic agent
authority. A new or removed rich provider report requests an immediate scan so
it can replace or reveal the coarse automatic record. Automatic records mirrored
back from the renderer do not recursively accelerate discovery.

## 6. Workspace metadata ignores output-only churn

`startWorkspaceMetadataDiscovery()` uses a 750 ms active cadence for five
seconds, a three-second quiet fallback, and a 15-second hidden fallback.

Active-surface changes request an immediate scan. Registration, input, and
removal accelerate the loop, but ordinary output does not: output is common and
does not change the parent interactive shell's cwd. The existing cache still
reads Git `HEAD` cheaply, re-probes non-Git directories after five seconds, and
rejects late results when the target surface changed.

`WorkspaceMetadataDiscovery.updateWorkspaces()` returns whether the target map
actually changed. This prevents renderer workspace mirrors from turning every
state update into urgent metadata work.

## 7. Visibility crosses the deferred-service boundary

`index.ts` considers the background services visible when any live
`BrowserWindow` is visible and not minimized. Show, hide, minimize, restore, and
close events synchronize that state.

The services initially receive `false` because the window starts hidden until
`ready-to-show`. `DeferredBackgroundServices` stores the newest visibility even
before discovery starts, replays it to each delayed service, and then forwards
later changes. Restoring requests an immediate recovery scan; hiding switches to
the 15-second fallback.

## 8. Renderer timers become demand-driven

`nextAgentLifecycleDeadline()` finds the earliest pending `staleAt` or
`expiresAt`. `App.tsx` schedules one timeout for that exact primitive deadline
instead of dispatching `expireAgents` every second. The reducer update computes
the next deadline or removes the timer entirely.

`AgentList` now starts its ten-second elapsed-label interval only when agents
exist and `document.hidden` is false. A visibility change stops the interval or
refreshes the timestamp immediately. Depending on the primitive deadline and
`agents.length` keeps React effects stable when unrelated state changes.

## 9. Verification and measured effect

Deterministic tests exercise every timing, visibility, authority, async, and
cleanup boundary. An isolated production Electron smoke test showed:

1. Home/no-Git updating to a temporary repository on `cd`;
2. `main` updating to `feat/adaptive-live` after `git switch`;
3. a Kimi process appearing as working; and
4. the record disappearing after process exit.

The quiet no-agent schedule falls from 206 configured callbacks per minute to
32, an 84.47% reduction. In the matched production benchmark, median idle CPU
fell from 7.8% to 7.2%; the candidate won 17 paired rounds, tied three, and lost
none. Startup, memory, and parser throughput remained neutral. See
`benchmarks/results/2026-07-30-adaptive-runtime-polling.md` for the end-of-run
pressure qualification.

## 10. Checkpoint

You should now be able to explain:

1. why event acceleration still needs bounded fallback polling;
2. why `trigger()` and `triggerNow()` have different authority;
3. how the loop prevents both async overlap and activity-driven scan storms;
4. why terminal output matters to agent discovery but not workspace metadata;
5. how visibility is preserved before deferred services exist; and
6. why exact lifecycle deadlines are better than a permanent renderer interval.
