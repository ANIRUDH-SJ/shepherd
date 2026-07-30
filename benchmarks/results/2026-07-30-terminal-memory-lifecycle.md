# Terminal Memory and Lifecycle Results

## Result

The lifecycle work passes its resource-safety acceptance criteria. With one
terminal open, the complete Electron tree used about 325 MiB PSS. Each additional
live terminal added roughly 4.7–5.0 MiB PSS and one shell process. Closing
workspaces returned the candidate to exactly one PTY, one owner, one inspection
ring, zero queued output bytes, zero paused PTYs, and seven measured processes at
every checked recovery point.

This is a **pressure-qualified pilot**, not a hardware ranking. About 48% of RAM
was available, but 74.9% of the 4 GiB swap device was already in use. All measured
application processes had 0 KiB SwapPss during the runs.

## Subjects and method

- Baseline runtime: `5b89aacea306d0ac053495e0267f2c095b0df1cc`
- Candidate runtime: `7d083b838c8b330410021555b0b5d53db6669559`
- Final harness: `0ebc9f5` (the role-attributed long run used `3062b29`)
- Final reviewed smoke: `eeadbdd383ce574664d5e1817ff991673404663b`
- Production unpacked builds, `--no-sandbox`, Xvfb 1280×800×24
- Private XDG profile, Unix socket, logs, and Bash shell per subject
- Three alternating fresh runs per subject, three samples at 1/2/4/8 terminals
- 1.2 s level settle, ten 8→1 recovery cycles with 0.9 s settle
- One additional matched 30-cycle run with 1.2 s recovery settles
- `/proc/<pid>/smaps_rollup` PSS; summed RSS was retained only as a counter-metric

The harness stores no terminal content. Process composition retains sanitized
roles only. Chromium helpers whose role flag is unavailable are combined as
`electron:helper`.

## Scaling

Median of the three fresh-run medians, KiB PSS:

| Live terminals | Baseline | Candidate | Candidate delta |
| -------------: | -------: | --------: | --------------: |
|              1 |  324,597 |   324,921 |   +324 (+0.10%) |
|              2 |  330,078 |   331,913 | +1,835 (+0.56%) |
|              4 |  341,283 |   343,133 | +1,850 (+0.54%) |
|              8 |  357,633 |   360,276 | +2,643 (+0.74%) |

The median 1→8 slope was 4,719 KiB per added terminal for baseline and 4,970 KiB
for candidate. The longer paired run reversed that small difference: 5,033 KiB
baseline versus 4,829 KiB candidate. Under current host pressure this variation
is measurement noise, not evidence of a memory improvement or regression.

Process counts were deterministic: six Electron processes plus 1/2/4/8 shells,
for totals of 7/8/10/14.

The final reviewed revision adds a cross-renderer creation/replacement rejection
and hardens lifecycle acceptance and owned-process cleanup after the long
comparison. A rebuilt production smoke at that revision repeated the 1/2/4/8
process counts, completed three 8→1 cycles with no failures, and returned the
managed resource counts exactly at all four checkpoints. The conditional
authorization guard does not run in the accepted-owner measurement path, so the
longer matched run remains the statistical memory comparison.

## Repeated close behavior

Across the three candidate runs, all 33 one-terminal recovery snapshots were
exact. The longer run added 31 more exact snapshots, including its cold
observation: **64/64** checked candidate recovery points had one terminal, one
owner, one inspection ring, zero queued bytes, and zero paused PTYs.

PSS returned to the current high-water plateau rather than the cold-start value.
The long matched run showed the same shape in both builds:

|    Recovery point | Baseline PSS | Candidate PSS |  Delta |
| ----------------: | -----------: | ------------: | -----: |
| Cold one terminal |      325,391 |       326,194 |   +803 |
|          Cycle 10 |      371,544 |       374,812 | +3,268 |
|          Cycle 20 |      371,547 |       376,075 | +4,528 |
|          Cycle 25 |      392,277 |       394,711 | +2,434 |
|          Cycle 30 |      390,605 |       389,026 | −1,579 |

The retained Bash stayed flat near 3.2 MiB. Electron main rose by about 4 MiB;
the combined five renderer/GPU/utility/zygote helpers accounted for the remaining
allocator high-water pages. Both builds jumped near cycle 25 and then declined,
which rejects a candidate-only monotonic retention explanation.

## Conclusion and limits

The feature prevents stale-renderer control and releases renderer-owned PTYs
without increasing live-resource counts. It does not claim to make Electron's
cold fixed cost smaller. A clean-swap host should rerun the default five-run
harness before publishing absolute memory numbers. Future work may add
renderer-heap instrumentation to separate live JavaScript objects from Chromium
allocator reservations; this report deliberately does not infer that distinction
from PSS alone.
