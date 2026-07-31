# 32 — Adaptive Event-Driven Observation

Desktop applications often need to observe state that has no perfect event
source. Linux can expose a terminal's foreground process and cwd through
`/proc`, and Git exposes the current branch through `HEAD`, but neither gives
Shepherd one reliable subscription covering process replacement, shell cwd,
worktrees, `git init`, deletion, and permission races.

A fixed poll is simple and self-healing:

```text
every interval → observe → derive → compare → publish if changed
```

Its weakness is proportional background work. A 750 ms check runs 80 times per
minute whether the user switched branches or went to lunch. Suppressing an
unchanged outgoing message does not remove the observation cost.

This chapter develops the hybrid used by Shepherd: events accelerate a
bounded recovery poll, quiet and hidden states back off, and exact renderer
deadlines replace periodic checks where the future transition is already known.

## 1. Begin with freshness contracts

Timer optimization is unsafe when “faster” and “eventually” are undefined.
Shepherd states the product bounds first:

| Observer           | Active | Quiet visible | Hidden | Activity window |
| ------------------ | -----: | ------------: | -----: | --------------: |
| Agent processes    |    1 s |           5 s |   15 s |             4 s |
| Workspace metadata | 750 ms |           3 s |   15 s |             5 s |

Window restoration and authoritative target changes run immediately. Automatic
agent activity becomes idle after three seconds and is observed within one
additional active interval. Non-Git locations are re-probed after at least five
seconds.

These are latency budgets, not universal constants. They connect each timer to
a user-visible guarantee and give tests an exact boundary.

## 2. Combine hints with recovery

An event is a useful hint, but not necessarily the source of truth.

Terminal registration, input, output, and removal tell agent discovery that a
foreground process may have changed. Registration, input, removal, and active
surface selection tell workspace metadata that the relevant interactive shell
may have moved.

The event does not carry the answer. It requests a new observation:

```text
content-free activity hint
  → adaptive scheduler
  → bounded /proc and Git observation
  → derive agent or metadata
  → compare with cached state
  → publish only a change
```

The fallback remains essential. Processes can exit without another PTY byte,
filesystem notifications can race, `/proc` entries can disappear between reads,
and an external command can change Git state without terminal input. Slow
polling makes the system self-healing after a missed hint.

## 3. Acceleration must not become a scan storm

Calling an expensive scan for every output event simply replaces timer overhead
with event overhead. A build can emit thousands of chunks per second.

Shepherd distinguishes two requests:

- `trigger()` enters or extends an activity burst. The first event after quiet
  runs immediately; sustained events are capped by the active interval.
- `triggerNow()` represents an authoritative change that deserves immediate
  reconciliation, such as a new active surface, rich report authority, or
  restored window.

The scheduler remembers `lastRunAt`. During a burst, the next ordinary trigger
cannot run before:

```text
lastRunAt + activeInterval
```

This is not debounce. Debounce repeatedly moves a deadline and can starve a
continuous stream. The scheduler never postpones an earlier task. It is closer
to an event-triggered leading edge followed by bounded throttling and a quiet
fallback.

## 4. Serialize asynchronous observation

Workspace reconciliation can spawn bounded Git probes. Starting another scan
before the first completes creates avoidable load and, more importantly, lets
old results race newer ownership.

The shared loop permits one `run()` at a time. An urgent request received while
running sets one boolean rerun:

```text
run pending + one or many urgent triggers
  → finish current run
  → execute one immediate catch-up
```

Ordinary sustained activity already inside a burst does not create that rerun.
This coalesces an unbounded number of signals into at most one piece of pending
work.

Serialization is only the first defense. Workspace metadata also rechecks that
the workspace still targets the same surface after an awaited Git probe. A
non-overlapping scheduler prevents concurrency; an ownership check prevents a
late but individually valid result from reaching the wrong consumer.

## 5. Model visibility as scheduler input

A hidden terminal still needs eventual cleanup and branch recovery, but it does
not need visible-state latency. The main process derives application visibility
from live `BrowserWindow` instances:

```text
visible = any window is visible and not minimized
```

Hide or minimize replaces the next schedule with the 15-second recovery
interval. Activity while hidden does not accelerate work. Restore requests an
immediate scan, so the visible UI catches up before waiting for another
fallback.

Startup needs special care. Electron creates the window with `show: false`, and
background observers start only after the first terminal is ready. The deferred
service owner therefore stores the latest visibility before either observer
exists and replays it as each service starts. Visibility is state, not a
one-time notification.

For multiple windows, the policy is application-wide. Work remains at visible
cadence while any window can show it. A future per-window observer could use
finer ownership, but global state is simpler and matches the current singleton
renderer data model.

## 6. Route events according to meaning

Not every activity kind should accelerate every observer.

Agent discovery uses input and output because recent PTY traffic drives its
coarse `working` or `idle` state, and foreground agent processes often appear
around that traffic.

Workspace metadata ignores output-only activity. An interactive shell's cwd
normally changes because it processed user input or because the active terminal
changed. A compiler's output can be extremely noisy without changing the parent
shell cwd. Ignoring that signal removes hot-path churn without reading or
classifying terminal prose.

This is semantic filtering at the event-type boundary:

| Event        | Agent scan | Metadata scan |
| ------------ | ---------- | ------------- |
| registration | accelerate | accelerate    |
| input        | accelerate | accelerate    |
| output       | accelerate | ignore        |
| removal      | accelerate | accelerate    |
| target swap  | n/a        | immediate     |

## 7. Keep activity data content-free

Scheduling needs to know that activity happened, not what the terminal said.
The internal activity contract contains:

```ts
interface TerminalInspectionActivity {
  surfaceId: string
  kind: 'registered' | 'input' | 'output' | 'removed'
  timestamp: number
}
```

There is no text, command, prompt, argument, cwd, or environment value. This
reduces retention and prevents a performance mechanism from quietly becoming a
terminal-content analysis system.

Subscriber exceptions are contained at publication. Scheduling observers are
secondary to PTY inspection and must never break input or output. Stop
unsubscribes listeners, cancels the current timer, rejects future requests, and
prevents a late async completion from scheduling again.

## 8. Use deadlines when the future is known

Polling is unnecessary for renderer state whose transition timestamp is already
stored. Agent records can carry `staleAt` and `expiresAt`.

The renderer computes the earliest pending boundary:

```text
minimum(valid staleAt, expiresAt across all agents)
```

It schedules one timeout for that deadline. When it fires, the reducer marks or
removes records, React derives the next deadline, and the effect installs at
most one replacement. With no pending boundary, no lifecycle timer exists.

Two details matter:

1. an already-unknown record excludes its stale deadline so it does not create a
   zero-delay loop; and
2. the callback passes at least the scheduled deadline to the reducer, guarding
   against a host timer firing fractionally early.

Elapsed labels differ: their display changes repeatedly but has no state-machine
authority. A ten-second interval is acceptable only while agents exist and the
document is visible. Visibility restoration refreshes immediately.

React effect dependencies use the primitive deadline and `agents.length`.
Depending on a freshly allocated object or full derived array would recreate
timers for unrelated state changes.

## 9. Preserve authority and deduplication

Automatic process discovery is a coarse fallback. A structured provider report
has richer lifecycle authority and must replace it promptly.

The runtime derives a stable signature only from non-automatic records. A real
authority change requests an immediate scan, which clears or reveals the coarse
record. Automatic records mirrored from renderer state do not trigger another
urgent scan. This avoids a feedback loop:

```text
automatic scan → renderer mirror → automatic scan → ...
```

Workspace target mirroring has the same principle. Comparing the previous and
next `workspaceId → activeSurfaceId` map lets only an ownership change request
immediate work. Other renderer updates remain ordinary cached state.

## 10. Deterministic testing

Real time makes scheduler tests slow and flaky. `AdaptivePollingLoop` accepts:

- `now()`, a controllable clock; and
- `schedule(task, delay)`, a manual task queue returning a cancel function.

Tests can inspect the exact next delay and invoke tasks without sleeping.
Important contracts include:

- initial recovery, quiet fallback, and first-event wake;
- no faster-than-active scanning under repeated triggers;
- no overlapping async work;
- one coalesced urgent rerun;
- hidden backoff and immediate restoration;
- restoration while an async scan is still pending;
- exception containment;
- cancellation and late-completion safety; and
- idempotent start and stop.

Integration-style tests then attach the scheduler to agent discovery, metadata,
terminal activity, and deferred visibility. A live Electron smoke test verifies
real `/proc`, PTY, Git, IPC, reducer, and sidebar behavior.

## 11. Measure wakeups and CPU separately

A configured callback count is deterministic and explains the mechanism, but it
is not an OS wakeup count. Browsers can coalesce timers, callbacks have different
costs, and a `/proc` ancestry scan costs more than a trivial label update.

For a quiet visible window with no agents:

| Observer                 | Fixed/min | Adaptive/min |
| ------------------------ | --------: | -----------: |
| Agent discovery          |        60 |           12 |
| Workspace metadata       |        80 |           20 |
| Agent lifecycle reducer  |        60 |            0 |
| Empty elapsed-label tick |         6 |            0 |
| **Total**                |   **206** |       **32** |

The 84.47% callback reduction states exactly what the implementation guarantees.
A matched production measurement then checks whether it affects whole-process
CPU. After an eight-second settle and over a five-second CPU window, median idle
CPU fell from 7.8% to 7.2%. The candidate was lower in 17 paired rounds, tied
three, and never higher.

Startup, PSS, RSS, and parser throughput remained neutral counter-metrics. The
run ended under high memory and swap pressure, so it supports this isolated
decision but should be repeated in the cumulative performance rerun. A timer
optimization does not prove rendered latency or reduce Electron's fixed memory.

## 12. Alternatives and tradeoffs

### Keep fixed intervals

Fixed polling is easy to reason about, but it pays the active freshness cost
forever. It also scatters independent recurring timers across main and renderer.

### Remove polling and trust events

This minimizes quiet work but loses self-healing. PTY traffic does not describe
every process exit, external branch change, `git init`, deletion, or transient
observation failure.

### Use filesystem watchers for Git

Watching `HEAD` can reduce reads, but worktrees, ref indirection, atomic file
replacement, watch limits, deletion, and network filesystems complicate
correctness. A cheap cached `HEAD` read with bounded fallback is portable and
easy to recover.

### Observe every PTY event immediately

This gives low latency but turns high-volume output into a process-scan storm.
The active-interval cap is the essential complement to event hints.

### Put all observers on one global timer

One wakeup sounds attractive, but agent discovery and metadata have different
signals, costs, and freshness contracts. A reusable state machine shares policy
without forcing unrelated work onto the same cadence.

### Pause everything while hidden

This saves the most work but can retain dead agents and stale ownership
indefinitely. A 15-second fallback gives bounded recovery, and restore still
catches up immediately.

## 13. Extension points

The current boundary supports further work without changing observer semantics:

- expose content-free diagnostic counters for runs, triggers, and coalescing;
- measure 1, 2, 4, and 8 terminals to isolate ancestry-scan scaling;
- derive foreground-PID change notifications if node-pty exposes a reliable
  platform hook;
- compare cached reads with carefully bounded Git file watching;
- use per-window visibility if state ownership becomes multi-window;
- replace the elapsed interval with minute-boundary deadlines if profiling
  justifies the added complexity; and
- repeat cumulative CPU measurements on a freshly settled host.

Any adaptive extension must retain an upper latency bound, a fallback recovery
path, content-free signals, non-overlap, and deterministic tests.

## Checkpoint

1. Why is an activity event a hint rather than the source of truth?
2. How does a leading-edge trigger plus active cadence differ from debounce?
3. Why must async serialization and late-result ownership checks both exist?
4. Which signals should workspace metadata ignore, and why?
5. When should a UI use one exact deadline instead of polling?
6. What does the callback-count result prove that the CPU result does not?
