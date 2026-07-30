# Terminal Memory and Lifecycle Plan

## Status and scope

Status: complete. Delivered and reviewed in PR #43.

This feature is phase 5 of `PERFORMANCE_ENHANCEMENT_PLAN.md`. It measures the
fixed Electron cost separately from per-terminal growth, makes retention bounds
explicit, and closes terminal ownership gaps that can retain PTYs or let stale
renderer messages affect replacement terminals.

Branch: `perf/terminal-memory-lifecycle`
Baseline: `5b89aacea306d0ac053495e0267f2c095b0df1cc`

## Baseline inventory

Each mounted terminal owns:

- one xterm `Terminal`, `FitAddon`, optional `WebglAddon`, and 1,000-line default
  scrollback;
- one `ResizeObserver`, two window listeners, xterm input subscription, two
  preload IPC subscriptions, and an optional startup animation frame;
- one node-pty process, data/exit subscriptions, bounded output batcher, and
  creator `WebContents` reference;
- a 256 KiB terminal-inspection capture ring and an 8 KiB maximum incomplete OSC
  tail.

Normal React unmount disconnects and disposes these resources. Main also
disposes on natural exit, explicit terminal disposal, replacement, and app
shutdown.

## Lifecycle contracts

- Only the renderer that created a terminal may input, resize, acknowledge, or
  dispose it.
- A stale renderer cleanup message must not kill a replacement terminal with
  the same surface ID.
- Destroyed or crashed renderer ownership must release every associated PTY,
  subscription, batch, inspection capture, and ownership record.
- Natural exit, explicit close, replacement, renderer loss, and app shutdown
  must remain safe when repeated or raced.
- Terminal count, owner count, retained inspection bytes, and queued output
  diagnostics must contain no terminal text, commands, paths, argv, environment
  values, or process content.

## Retention contracts

- Set xterm scrollback explicitly rather than depending on a library default.
- Keep useful history at 1,000 lines unless measurements justify a user-facing
  setting; do not reduce it merely to lower one benchmark.
- Preserve the 256 KiB inspection ring, 8 KiB OSC tail, and bounded acknowledged
  output flow.
- Every per-terminal buffer must have a documented maximum or a lifecycle reason
  it cannot accumulate.

## Measurement design

Use fresh unpacked production builds and isolated X11/session/socket paths.
Record:

1. settled process-tree PSS/RSS at 1, 2, 4, and 8 live terminals;
2. incremental PSS per added terminal;
3. main/renderer/GPU/helper/shell process composition;
4. retained resource counts before and after close;
5. repeated open/close cycles returning toward the one-terminal baseline; and
6. swap PSS, host pressure, failures, exact commits, and sample variability.

The harness must use bounded waits, marker-owned cleanup, private state
directories, machine-readable JSON, and no terminal-content capture. A
redirected non-terminal control remains part of the later cumulative suite.

## Delivered commit sequence

1. `docs: plan terminal memory lifecycle`
2. `terminal: model renderer terminal ownership`
3. `terminal: release resources when renderers disappear`
4. `renderer: make terminal scrollback bounds explicit`
5. `terminal: report bounded lifecycle resources`
6. `benchmarks: add terminal lifecycle measurements`
7. focused benchmark-safety and process-composition commits
8. `benchmarks: record terminal lifecycle comparison`
9. `terminal: reject cross-renderer replacement`
10. `docs: explain terminal memory lifecycle`

## Delivery checklist

- [x] Add a deterministic owner/terminal registry with idempotent removal.
- [x] Bind creation/replacement, input, resize, acknowledgement, and disposal to
      creator ownership.
- [x] Clean every owned terminal on renderer destruction or renderer-process
      failure.
- [x] Preserve replacement and natural-exit ordering.
- [x] Make xterm scrollback and other retained limits explicit.
- [x] Add regression coverage for cross-owner messages, stale cleanup,
      replacement, owner loss, repeated cleanup, and listener release.
- [x] Add a safe 1/2/4/8-terminal and open/close measurement workflow.
- [x] Measure the exact pre-feature merge and settled candidate.
- [x] Verify real terminal creation, prompt output, and close in production
      Electron; verify replacement and stale cleanup ordering deterministically.
- [x] Add the code walkthrough to `learning/`.
- [x] Add architecture, alternatives, security, and tradeoffs to `textbook/`.
- [x] Update the performance plan, roadmap, feature matrix, glossary, benchmark
      index, and learning/textbook indexes.
- [x] Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, and
      `git diff --check`.
- [x] Open and review a dedicated PR.

## Guardrails

- Never expose Electron process objects or terminal contents as diagnostics.
- Never use summed RSS alone to claim multi-process memory.
- Never signal processes that the measurement run cannot prove it owns.
- Never rely on renderer cleanup as the only PTY cleanup path.
- Never add one `WebContents` failure listener per terminal.
- Never allow cleanup of one owner to touch another owner's terminal.
- Preserve existing sessions, user data, shell cwd, terminal ordering, and
  scrollback behavior.

## Acceptance

Memory growth from one to eight terminals must be measured and explainable.
After repeated close cycles, terminal/resource counts must return exactly to
baseline and settled process PSS must not show monotonic application-owned
growth. Renderer loss must release its PTYs without affecting other owners.
Every buffer and listener introduced or retained by a terminal must have a
documented bound and cleanup owner.
