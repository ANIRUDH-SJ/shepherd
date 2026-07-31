# 28 — Measuring terminal performance without fooling yourself

“Fast” is not one property. A terminal can open quickly but use more memory,
parse output quickly but present frames late, or remain smooth with eight panes
while consuming more idle CPU. A useful benchmark names each question, controls
the work around it, and preserves enough evidence for another person to repeat
the experiment.

## 1. Start with separate hypotheses

Terminal performance has several independent dimensions:

| Dimension            | Question                                                    |
| -------------------- | ----------------------------------------------------------- |
| Startup              | How long until a usable child process owns a TTY?           |
| Idle resources       | What memory and CPU remain after the window settles?        |
| Parser throughput    | How quickly does the emulator consume terminal bytes?       |
| Presentation         | When do the pixels for those bytes reach a displayed frame? |
| Input latency        | How long from synthetic input to a changed frame?           |
| Interaction          | Does scrolling or resizing miss frames or spike CPU?        |
| Scalability          | How do 1, 2, 4, and 8 live terminals change the above?      |
| Application overhead | What does cmux-specific agent discovery add independently?  |

One combined score hides causality and lets weighting choose the winner. Report
the dimensions separately. A user can then decide whether startup, memory, or
heavy-output behavior matters for their workflow.

Vendor-authored benchmark results can suggest workloads or expose an optimization,
but they are not interchangeable with measurements from this harness. Different
hardware, versions, defaults, endpoints, and omitted failures are confounders.
Treat an external chart as a claim to reproduce, preserve its methodology link,
and never blend its numbers into locally captured summaries.

## 2. Benchmark production, not development

Development mode includes hot reload, source maps, debug checks, Vite servers,
and different caching. It can also spawn processes a packaged user never runs.
Before measuring:

1. run the repository quality gate;
2. build the production binary or package;
3. verify native modules such as node-pty inside that package;
4. record the artifact checksum and source commit; and
5. smoke-test one real input/output round trip.

An AppImage has two startup questions. The first launch may include mount or
extraction work; the already-unpacked binary measures application startup without
that packaging cost. Keep those results separate rather than attributing both to
the terminal engine.

## 3. Use identical work inside every terminal

Comparing “shell prompt visible” by watching a window title is unreliable because
shell configuration, plugins, and prompt commands vary. A benchmark-owned child
should perform the same small protocol everywhere:

```text
launcher starts terminal
  -> terminal creates PTY
  -> identical worker starts on controlling TTY
  -> worker preloads fixture
  -> worker writes readiness timestamp out of band
```

The out-of-band channel must not share stdout with the measured terminal stream.
A private file works locally and avoids asking the terminal renderer to parse its
own control records. Exclusive creation prevents an old or duplicate record from
being accepted.

The fixture is built before timing, sized in bytes rather than characters, and
hashed. ASCII, Unicode, and ANSI workloads answer different questions:

- ASCII exercises ordinary glyph and line handling;
- Unicode adds variable-width encoding, combining marks, emoji, and wide glyphs;
- ANSI adds parser state changes such as SGR colors.

Matching byte counts does not make these workloads equivalent, which is why the
fixture kind belongs in the result.

## 4. Define the end condition honestly

Writing 8 MiB to stdout measures how quickly the producer can hand bytes to the
kernel, not how quickly the terminal consumes them. A terminal may buffer the
data and render much later.

A parser-oriented test can append a Device Status Report query:

```text
worker -> fixture bytes -> ESC [ 5 n
terminal parser -> ESC [ 0 n -> worker input
```

The response proves the parser reached the final query. It includes PTY transfer,
parsing, and response delivery. It does not prove that the compositor displayed
the final frame. Name the metric `parser round trip`, not “render speed.”

A presentation benchmark needs another observer: capture or presentation timing
that detects a final visual sentinel after frame queues settle. That observer and
its capture overhead must be measured independently. Hardware input-to-photon
latency additionally needs a camera or photodiode; software event-to-present time
is a narrower proxy.

## 5. Count the whole process model

Modern terminals do not all have the same topology:

```text
Electron terminal: launcher -> browser/main -> renderer -> GPU/utility
native terminal:   launcher -> terminal process -> helper threads/processes
server terminal:   client --handoff--> pre-existing terminal server -> PTY child
```

Measuring one PID penalizes or rewards architecture by accident. Follow the
launched process tree and use a unique environment marker to reconnect a worker
after a server handoff. If a detached server should count, follow only an exact,
documented process-name allowlist from the marked child. Never walk arbitrary
ancestors up to the desktop session.

Linux exposes memory in `/proc/<pid>/smaps_rollup`:

- **RSS** counts every resident page in every process, so shared pages are
  repeatedly counted;
- **PSS** divides shared pages among the processes mapping them;
- **private memory** belongs only to that process;
- **SwapPss** shows proportional swapped memory.

PSS is normally the fairest headline memory metric for a multi-process
application. Keep RSS and private memory too, because they help diagnose why PSS
changed.

CPU is also a delta, not a snapshot. Read user and system ticks before and after
a fixed idle interval, divide by the kernel clock-tick rate and elapsed seconds,
then sum the measured set. More than 100% is valid when multiple threads/processes
use more than one logical CPU.

## 6. Measurement ownership is not kill authority

A shared server creates a critical distinction:

```text
measured set = benchmark process tree + approved shared server
cleanup set  = marker-verified benchmark launch tree + benchmark worker
```

The broader measured set answers “what processes make this terminal window
work?” Reusing it for cleanup can terminate other windows owned by the same
server. Protected server commands must never receive cleanup signals, even if
they happen to inherit the benchmark marker.

Before signaling a PID, re-read current process identity and marker data. PIDs are
reused; an old number is not durable proof of ownership. Prefer leaking a failed
benchmark child that also watches a private stop file over killing a process that
cannot be re-verified. Ask with `SIGTERM`, wait a bounded grace interval, and use
`SIGKILL` only on the still-verified cleanup set.

This safety boundary is part of benchmark correctness, not an operational detail.
A benchmark that disrupts unrelated terminals cannot be trusted or routinely
repeated.

## 7. Control the host and classify bad runs

Performance numbers are observations of a system, not constants of an app.
Record at least:

- source commit and subject versions/sources;
- kernel, CPU, memory, GPU, driver, display server, compositor, and resolution;
- refresh rate, font, geometry, shell, and terminal configuration;
- load average, available memory, swap use, and power/CPU policy.

Heavy swap use can make startup depend on whichever pages the kernel evicted.
Low memory can add reclaim work. A harness should reject these conditions before
launch rather than hide them in a footnote. An explicit override is useful while
debugging, but the output must be permanently labelled `pilot`.

A shared terminal server may retain the user's profile even when its launch
client receives private XDG directories. That case is an installed-desktop
baseline, not a fully isolated font/config comparison. Record the limitation or
run it in a genuinely isolated desktop/session; do not claim configuration parity.

## 8. Repetition, order, and summaries

First-run caches and dynamic compilation differ from steady state. Use warmups,
then retain at least twenty measured samples for a serious local comparison.
Randomize subject order per round so thermal drift, background jobs, or cache
warming do not always favor the same terminal. A deterministic seed makes the
order auditable.

Useful summaries are:

- **median** for the typical sample;
- **p95** for the slow tail;
- **MAD** (median absolute deviation) for robust spread;
- minimum/maximum for range; and
- mean for compatibility with other reports.

Twenty samples do not make p95 magically precise—the nearest-rank p95 is almost
the maximum at that size. Always publish raw values and failure counts. Never
drop a failed subject/sample silently; missing data is itself a result.

## 9. Security and validation

A local benchmark config is still executable authority. Treat it as untrusted
input:

- require absolute executable paths;
- call executables with argv and no shell interpolation;
- bound strings, arrays, environment entries, samples, fixture size, and timeouts;
- allow only known placeholders;
- minimize inherited environment;
- write control files with restrictive permissions;
- restrict outputs to an intentional result root and reject symlink escapes; and
- write JSON to a new temporary file, then publish it with an exclusive hard link
  so an existing result cannot be replaced.

The benchmark worker should retain only fixture data and its random run id. It
does not need terminal prompts, user commands, general environment variables, or
network access.

## 10. Why not use only existing tools?

`hyperfine` is excellent for command wall time, but it cannot know when a GUI
terminal's child owns a controlling TTY, cannot follow a D-Bus handoff, and does
not provide parser completion. `time` has the same boundary problem.

`perf`, compositor traces, and frame profilers are valuable for diagnosing a
suite after its workload is trustworthy. They are not the workload protocol.
`xdotool` can automate keys, scrolling, and resize on X11, but Wayland requires a
different input/capture route and the automation latency must not be mistaken for
application latency.

A handwritten shell script is quick, but safe process identity, JSON validation,
statistics, atomic output, and unit tests become awkward. TypeScript reuses the
project toolchain and makes result/config shapes reviewable. The cost is more
harness code and Node startup outside the timed child; neither Node nor its
transpiler should remain in the measured terminal set.

## 11. Extending the foundation

The next suites should reuse subject validation, environment capture, randomized
rounds, pressure gates, ownership, and raw result conventions:

1. distinguish unpacked application startup from AppImage mount/startup;
2. add a visual sentinel and presentation observer;
3. automate identical scroll and resize sequences with frame/CPU capture;
4. create equivalent 1/2/4/8-terminal layouts;
5. compare Shepherd agent discovery enabled and disabled at each terminal count;
6. run a redirected CPU workload as a terminal-independent control; and
7. repeat with hardware GPU, software rendering, and GPU-unavailable fallback.

Each extension should add fields or a new result schema deliberately. A parser
proxy must never be silently renamed into rendered throughput after the fact.

## Checkpoint

1. Why can no single “terminal speed” score be technically neutral?
2. What additional observer turns parser completion into presentation timing?
3. Why does PSS suit Electron better than a sum of RSS values?
4. When may a shared server count toward measurement but not cleanup?
5. Which host conditions should downgrade or reject a result?
6. What would you change to compare GPU and software-rendered modes fairly?
