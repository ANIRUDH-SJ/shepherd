# Usage Telemetry Feature Plan

## Goal

Show trustworthy per-workspace AI token usage without guessing from terminal text. Agents report usage through the existing `cmux` socket API; cmux-linux records the source and accuracy, aggregates the session, and presents a compact sidebar summary.

## Product Rules

- Never label inferred values as exact.
- Keep the protocol provider-neutral: Claude Code, Codex, and custom clients use the same shape.
- Treat cost as optional because subscription plans, caching, and provider pricing differ.
- Reject malformed or negative counters at the socket boundary.
- Keep usage ephemeral for v1; session restore continues to persist layout only.
- Prefer a quiet summary over a badge after every terminal line or guessed message boundary.

## Data Shape

Each report contains non-negative `inputTokens` and `outputTokens`, plus optional `cachedTokens`, `costUsd`, `model`, and `provider`. `accuracy` is `exact` or `estimated`. The renderer stores cumulative totals and the latest report for each workspace.

## Implementation Checklist

### Goal 1 — Contract and aggregation

- [ ] Define shared usage report, totals, accuracy, and socket-command types.
- [ ] Add pure normalization and aggregation helpers.
- [ ] Cover valid, partial, estimated, and invalid reports with headless tests.

### Goal 2 — Socket and CLI ingestion

- [ ] Add `report-usage` to socket capabilities and dispatch.
- [ ] Validate all external values before forwarding them to the renderer.
- [ ] Add `cmux report-usage` flags and help examples.
- [ ] Add CLI/parser or socket-boundary regression tests where practical.

### Goal 3 — Application state

- [ ] Extend each workspace with usage totals and the latest report.
- [ ] Accumulate reports without mutating reducer state.
- [ ] Ensure restored sessions start with empty usage telemetry.
- [ ] Add reducer tests for exact, estimated, and multi-report totals.

### Goal 4 — User interface

- [ ] Show compact token totals in each workspace row.
- [ ] Expose input/output/cache, model/provider, cost, accuracy, and latest-report details accessibly.
- [ ] Keep missing usage visually silent and preserve narrow-sidebar behavior.

### Goal 5 — Verification

- [ ] Run tests, lint, typecheck, and production build.
- [ ] Exercise `cmux report-usage` against a live or controlled socket.
- [ ] Review the final diff for unrelated generated output.

### Goal 6 — Post-code documentation

- [ ] After implementation, add `learning/M6-usage-telemetry.md` explaining the exact code written, file by file and message flow by message flow.
- [ ] After implementation, add a textbook chapter explaining token accounting, provenance, validation, aggregation, provider adapters, UI tradeoffs, and worked examples.
- [ ] Add the new chapter to `textbook/00-INDEX.md` and update roadmap/learning indexes.
- [ ] Keep the learning log implementation-specific; keep the textbook conceptual and reusable.

## Planned Commit Series

1. `docs: plan usage telemetry`
2. `shared: define usage telemetry contract`
3. `socket: accept usage reports`
4. `cli: add usage reporting command`
5. `renderer: aggregate workspace usage`
6. `ui: show workspace token usage`
7. `test: cover usage telemetry flow` if cross-layer coverage is clearer separately
8. `docs: explain usage telemetry implementation`
9. `docs: add token telemetry textbook chapter`

## Explicitly Deferred

- Scraping terminal output to estimate hidden API context.
- Provider pricing tables or automatic dollar calculations.
- Per-message boundaries and history panels.
- Persisting usage across application restarts.
- Provider-specific Claude Code or Codex adapters.
