# 🐛 bug-fixes/ — post-mortems

A log of every real bug we've hit building cmux-linux, with a **deep post-mortem**
for each: the symptom, how we tracked it down, the root cause, the fix, and how we
stop it coming back. Includes bugs from **setup**, bugs **you found while using it**,
and bugs **I found while testing**.

This is learning material — distinct from `../learning/` (which explains *what each
milestone built*). Here we explain *what went wrong and how we reasoned about it*,
because debugging is the skill that actually matters.

## Index

| # | Bug | Milestone | How it surfaced |
|---|---|---|---|
| 01 | vite 8 vs electron-vite peer conflict | M0 | `npm install` failed |
| 02 | TypeScript `baseUrl` deprecated | M0 | `npm run build` failed |
| 03 | Terminal numbers jump 1 → 3 → 5 | M2 | user report |
| 04 | CLI socket test hangs forever | M3 | my own testing |
| 05 | Workspace/terminal numbers skip after close | M3 | user report |
| 06 | First terminal not typeable on launch | M3 | user report |

## The pattern to notice

Half of these trace back to **one idea**: React StrictMode double-invokes things in
dev to expose impurity (03, 06). Learning to *recognize the ×2 / double-mount
signature* is worth more than any single fix here. See `03` and `06`.
