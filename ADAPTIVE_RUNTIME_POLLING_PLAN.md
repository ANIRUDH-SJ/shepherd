# Adaptive Runtime Polling Plan

## Status and scope

Status: implementation and documentation complete; PR delivery in progress.

This feature is phase 4 of `PERFORMANCE_ENHANCEMENT_PLAN.md`. It reduces
steady-state timer wakeups without removing the bounded fallback scans that make
automatic agent discovery and live workspace metadata self-healing.

Branch: `perf/adaptive-runtime-polling`
Baseline: `240fb9e70c7e0855c02a20d330af85fb646dcf07`

## Current baseline

- Automatic process discovery scans every 1,000 ms.
- Workspace cwd and Git metadata scan every 750 ms.
- The renderer dispatches agent expiry every 1,000 ms, even with no agents.
- Sidebar elapsed labels repaint every 10 seconds, even when empty or hidden.

The process and metadata scanners already suppress unchanged outgoing messages,
but they still read `/proc` and Git `HEAD` on every interval.

## Freshness contracts

### Automatic agents

- The first terminal registration, input, output, or removal after quiet
  requests an immediate scan; sustained activity is coalesced to the active
  cadence.
- After activity, scan every 1 second for 4 seconds.
- Quiet visible terminals retain a 5-second fallback scan.
- Hidden or minimized windows retain a 15-second fallback scan.
- Restoring a window requests an immediate scan.
- The 3-second `working` to `idle` threshold remains accurate within 1 second
  after observed activity.

### Workspace metadata

- Active-surface changes request an immediate scan. The first terminal input,
  registration, or removal after quiet runs immediately; sustained activity is
  coalesced to the active cadence.
- After a target change or input, scan every 750 ms for 5 seconds.
- Quiet visible workspaces retain a 3-second fallback scan.
- Hidden or minimized windows retain a 15-second fallback scan.
- Restoring a window requests an immediate scan.
- Non-Git directories still re-probe after at least 5 seconds.

### Renderer lifecycle

- Agent stale/expiry transitions use the next exact `staleAt` or `expiresAt`
  deadline instead of a permanent 1-second interval.
- No lifecycle timer runs when no agent has a pending deadline.
- Elapsed-label refreshes run only while agents exist and the document is
  visible; visibility restoration refreshes immediately.

## Delivery checklist

- [x] Add a deterministic adaptive polling state machine with async-overlap
      protection, coalesced triggers, visibility backoff, and idempotent stop.
- [x] Publish content-free terminal activity signals without retaining terminal
      text, commands, arguments, or environment values.
- [x] Move automatic agent discovery to the adaptive schedule.
- [x] Move workspace metadata discovery to the adaptive schedule.
- [x] Forward main-window visibility to both background runtimes.
- [x] Replace renderer expiry polling with deadline scheduling.
- [x] Pause empty or hidden sidebar elapsed-label refreshes.
- [x] Preserve unchanged-state suppression and bounded fallback recovery.
- [x] Add unit and integration regression coverage for every timing contract.
- [x] Compare steady-state wakeups and production idle CPU against the exact
      pre-feature merge.
- [x] Verify agent appearance/removal plus cwd and branch updates in live
      Electron.
- [x] Add the code walkthrough to `learning/`.
- [x] Add architecture, alternatives, security, and tradeoffs to `textbook/`.
- [x] Update `PERFORMANCE_ENHANCEMENT_PLAN.md`, `ROADMAP.md`, `FEATURES.md`, and
      relevant indexes after behavior settles.
- [ ] Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, and
      `git diff --check`.
- [ ] Open and review a dedicated PR.

## Guardrails

- Never rely only on filesystem watchers or terminal output events.
- Never inspect terminal prose to infer scheduling importance.
- Never postpone rich structured agent reports or socket commands.
- Never run overlapping async metadata scans.
- Subscriber, scheduler, `/proc`, Git, and visibility failures must remain
  contained.
- Stop must cancel timers, unsubscribe activity listeners, and prevent late async
  work from rescheduling.

## Acceptance

Quiet visible operation must perform fewer recurring scans and renderer
dispatches than the fixed-interval baseline. Agent and metadata behavior must
stay within the contracts above, with no lost lifecycle transition, stale branch
after restore, or leaked timer/listener. Production measurements must state their
endpoint and host-pressure limitations.
