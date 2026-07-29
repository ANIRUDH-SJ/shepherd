# Terminal Output Batching Comparison — 2026-07-29

> **Decision: retain the bounded output batcher.** Against the exact pre-feature
> production build, it reduced median parser-confirmed output time by 17.71% and
> increased median parser throughput by 21.48%. Startup, idle CPU, and process
> memory remained effectively unchanged.

Run completed: 2026-07-29 18:57:34 UTC (2026-07-30 00:27:34 IST). The harness
classified the run as `publishable`. Recorded failures: 0.

## Compared builds

| Subject         | Commit                                     | Source                                                                     |
| --------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| Before batching | `4ab9221fa33dfeef826686641c5dfd09e24a1834` | Detached production build from the merge immediately before this feature   |
| After batching  | `cb9dbe5ba1f9a326212929d0b95d692089fc138e` | Clean production build containing the four implementation and test commits |

Both subjects used unpacked `npm run dist:dir` artifacts built with the same
dependency installation and native-module ABI.

## Results

Lower is better except for throughput. MAD is the median absolute deviation.
Each summary contains 20 measured samples after five warm-ups.

| Metric                    | Before median | Before p95 | Before MAD | After median | After p95 | After MAD | Median change |
| ------------------------- | ------------: | ---------: | ---------: | -----------: | --------: | --------: | ------------: |
| Startup (ms)              |         559.0 |      582.8 |       10.1 |        560.4 |     591.5 |      11.5 |        +0.25% |
| PSS (MiB)                 |        140.21 |     155.12 |       1.96 |       140.69 |    155.75 |      3.56 |        +0.34% |
| RSS (MiB)                 |        663.73 |     667.06 |       1.87 |       663.85 |    665.68 |      1.30 |        +0.02% |
| Idle CPU (%)              |          7.00 |       8.00 |       1.00 |         7.00 |      8.00 |      1.00 |         0.00% |
| Parser round trip (ms)    |        390.92 |     462.11 |      15.65 |       321.69 |    343.56 |     12.71 |   **-17.71%** |
| Parser throughput (MiB/s) |         20.47 |      21.98 |       0.81 |        24.87 |     26.07 |      0.98 |   **+21.48%** |

The candidate completed faster in every one of the 20 matched measured rounds.
Its paired parser-time improvement ranged from 8.9% to 35.3%, with a 16.5%
median paired improvement. Its p95 parser time improved by 25.66%. The startup
and resource differences are too small and inconsistent to call improvements or
regressions.

## Methodology

- Five warm-ups and 20 measured rounds per subject
- Deterministically shuffled subject order with seed `0x6d2b79f5`
- 8,388,652-byte ANSI fixture, SHA-256
  `2bcc7bd9ddf0b6604a6ff18330259d6b546b376a12a227d8cd223d770f9f25bf`
- Two-second settling period and one-second idle-CPU sample
- Process spawn to controlling-TTY worker readiness for startup
- Process-tree PSS/RSS from Linux `/proc`
- Device Status Report response as proof that xterm parsed the final probe
- Isolated X11 display `:99`, private sockets, sessions, and XDG directories
- 12th Gen Intel Core i5-12450H, 15.35 GiB RAM, Node v22.20.0

Both subjects used seven measured processes and reported zero sampled swap PSS.
The live acceptance run separately proved ANSI color, split Unicode, OSC
notifications, post-load input, a 50,000-line burst, and a no-newline exit tail.

## Pressure qualification

The run began inside the harness's publication gate: 48.50% memory was available
and 40.46% of swap was used. After all 50 launches, only 17.75% of memory was
available and swap use had reached 97.15%. Memory recovered after the subjects
and isolated display stopped, but the harness currently determines
classification only from pre-run pressure.

The randomized order, zero failures, zero per-subject swap PSS, and 20/20 paired
wins make this sufficient evidence for accepting this isolated feature. The
cumulative performance rerun should repeat the comparison on a freshly settled
host. This report does not claim rendered-frame throughput, input-to-photon
latency, or superiority over another terminal.

## Raw-result identity

The complete JSON remains local at
`/tmp/cmux-output-batching-before-after.json`. It is not committed because it
contains machine-specific absolute paths and detailed host inventory.

Raw JSON SHA-256:
`3a4e109a51ef5277399ed549885beae224806d9e60551a7cf213ba69506f97e3`.
