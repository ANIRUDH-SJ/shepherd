# M6 — Usage Telemetry: What We Actually Built

> This is the implementation diary for agent-reported token usage. For the general
> ideas—token accounting, provenance, trust boundaries, aggregation, and adapter
> design—read `../textbook/18-usage-telemetry.md`.

## 1. The goal

We wanted each workspace row to answer a quiet but useful question: **how many
tokens has this agent session reported using?** The first design idea was to infer
usage after every visible response. We deliberately did not do that. cmux-linux
sees terminal bytes, not the provider's complete API request, hidden context,
cache accounting, or billing record.

The implemented rule is therefore:

> An agent reports usage explicitly; cmux-linux validates, aggregates, and displays
> it. It never invents missing numbers.

## 2. The complete data flow

```text
agent or script
  → cmux report-usage --input-tokens 1200 --output-tokens 300 --accuracy exact
  → bin/cmux converts kebab-case flags to camelCase JSON
  → /tmp/cmux-linux.sock receives { method: "report-usage", params: ... }
  → src/main/socket.ts validates and timestamps the report
  → main pushes a socket:command IPC event
  → App.tsx dispatches reportUsage
  → appReducer immutably updates one workspace
  → Sidebar renders a compact total and detailed tooltip
```

## 3. `src/shared/usage.ts` — the contract and pure logic

This shared module is imported by both Electron sides. It defines four important
shapes:

- `UsageReport`: one provider or agent observation.
- `UsageTotals`: cumulative numeric totals.
- `WorkspaceUsage`: totals plus the latest report.
- `UsageAccuracy`: the literal union `'exact' | 'estimated'`.

`inputTokens` and `outputTokens` are required non-negative integers.
`cachedTokens` defaults to zero. Cost, model, and provider are optional because
not every integration has them.

`normalizeUsageReport()` is the runtime boundary. TypeScript cannot validate JSON,
so this function accepts `Record<string, unknown>`, converts numeric CLI strings,
rejects invalid values, trims labels, and applies the ingestion timestamp.

Accuracy has no default. A caller must consciously label the report:

```text
--accuracy exact
--accuracy estimated
```

`accumulateUsage()` returns a new totals object. It never mutates reducer state.
Once any report is estimated, `hasEstimated` remains true so the cumulative UI
cannot later appear fully exact.

## 4. `src/main/socket.ts` — the trust boundary

`report-usage` is advertised by `capabilities`. Its handler validates before
resolving the workspace and before sending anything to React. Invalid input gets
a normal socket error response, for example:

```text
cmux: error: outputTokens must be a non-negative integer
```

The main process replaces any caller timestamp with `Date.now()`. This gives every
report a consistent local ordering clock and prevents nonsensical remote dates.

The forwarded IPC params contain the normalized report only:

```ts
apply({ method: 'report-usage', workspaceId, params: { report } })
```

## 5. `bin/cmux` — the reporting interface

The existing CLI parser now converts all kebab-case flag names to camelCase:

```text
--input-tokens  → inputTokens
--cached-tokens → cachedTokens
--cost-usd      → costUsd
```

That keeps shell spelling conventional without leaking shell-style names into the
TypeScript protocol. `CMUX_WORKSPACE_ID` still targets the current pane's workspace
automatically; `--workspace` can override it.

Full example:

```bash
cmux report-usage \
  --input-tokens 1200 \
  --output-tokens 300 \
  --cached-tokens 800 \
  --cost-usd 0.042 \
  --accuracy exact \
  --provider openai \
  --model example-model
```

cmux-linux accepts reported cost but does not calculate it.

## 6. Reducer state and session behavior

Every `Workspace` now has `usage`. The `reportUsage` action updates only the
target workspace through the existing `mapWorkspace()` helper.

Usage is intentionally ephemeral. `makeWorkspace()` starts empty, and
`sanitizeRestored()` discards telemetry from any saved snapshot. Session
persistence remains layout-only, so yesterday's usage cannot be mistaken for a
new process's live session.

## 7. Sidebar presentation

`usageView.ts` keeps formatting outside React:

- `formatTokenCount(1250)` returns `1.3k`.
- `usageSummary()` returns nothing before the first report.
- Estimated totals receive a `~` prefix.
- Optional reported cost appears only when non-zero.
- `usageDetails()` builds the full accessible explanation.

The sidebar may show:

```text
~1.5k tok · $0.04
```

Hovering exposes input, output, cache, report count, exact/estimated state, cost,
and latest provider/model. The compact value uses tabular numerals and does not
steal width from the workspace status line.

## 8. Tests added

`src/shared/usage.test.ts` covers normalization, rejection, defaults, aggregation,
cost, caching, and sticky estimated state.

`src/renderer/src/appReducer.test.ts` covers per-workspace accumulation and reset
on restore. `usageView.test.ts` covers compact formatting and detail provenance.

`bin/cmux.test.js` is a cross-layer integration test. It opens a temporary Unix
socket, launches the real CLI, captures its JSON, replies successfully, and checks
flag mapping plus automatic workspace targeting.

## 9. Intentionally deferred

- Automatic Claude Code and Codex adapters.
- Per-message history or message-boundary detection.
- Provider-maintained pricing tables.
- Usage persistence across launches.
- Terminal-output scraping or hidden-context guesses.

## Checkpoint

1. Why can't visible terminal characters produce an exact API token count?
2. Why is `accuracy` required rather than defaulted?
3. Why does estimated state remain sticky in cumulative totals?
4. Which process validates socket JSON, and why there?
5. Why is usage omitted from restored session state?
