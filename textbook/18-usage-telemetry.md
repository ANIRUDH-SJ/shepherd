# Chapter 18 — Usage Telemetry: Tokens, Cost, and Trustworthy Measurements

## 18.1 The feature is not a counter; it is an observability system

“Show how many tokens this answer used” sounds like a formatting task. Put a
counter beside an agent response and add the values together. The hard part is
not the arithmetic. The hard part is knowing **what was measured, who measured
it, and whether the number means what the UI claims it means**.

Shepherd owns terminals and workspaces. It does not own the model request made
by Claude Code, Codex, or another agent. A terminal shows a projection of the
agent's activity, not its complete request envelope. This makes token usage an
observability problem:

```text
system being observed       → agent/provider API request
measurement producer        → provider response or agent adapter
transport                   → Shepherd CLI + Unix socket
collector                   → Electron main process
aggregation                 → React reducer state
presentation                → workspace sidebar
```

Good telemetry preserves meaning across every arrow.

## 18.2 What a token count actually includes

A model request can contain much more than the visible prompt:

- System and developer instructions.
- The conversation transcript.
- Tool definitions and JSON schemas.
- File contents and command output.
- Images or other multimodal inputs.
- Provider-managed summaries or cached prefixes.
- The model's generated output.

The terminal may render only the user's sentence and the final answer. Counting
those characters misses most of the request. Even a perfect tokenizer cannot
recover bytes it never saw.

This gives us an important engineering rule:

> The component closest to the API response is the best measurement producer.

Many provider responses contain usage metadata. An adapter can read those
fields and report them. When an integration only has a local approximation, it
must label the measurement as estimated.

## 18.3 Exact, estimated, and unavailable

Telemetry should distinguish three states:

1. **Exact** — copied from authoritative usage metadata for that request.
2. **Estimated** — calculated from incomplete information or a local tokenizer.
3. **Unavailable** — no defensible measurement exists.

Do not turn unavailable into zero. Zero means the measured operation used no
tokens; unavailable means it was not measured. Those facts lead to different
product decisions.

Shepherd makes callers choose `exact` or `estimated`. If they cannot choose
honestly, they should not send a report. The UI uses `~` for cumulative totals
that contain any estimate:

```text
18.2k tok    all reports exact
~18.2k tok   at least one report estimated
```

Notice that estimated state is **sticky**. Adding an exact measurement after an
estimated one does not make the earlier uncertainty disappear.

## 18.4 A provider-neutral event

A telemetry collector should not encode one provider's response object as its
internal model. Providers name fields differently and evolve independently.
Normalize at the adapter boundary:

```ts
interface UsageReport {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  costUsd?: number
  model?: string
  provider?: string
  accuracy: 'exact' | 'estimated'
  timestamp: number
}
```

Required fields represent the smallest useful common contract. Optional fields
carry provenance and billing information when the producer genuinely has them.

This is an **event**, not a current-state snapshot. If three requests finish,
the producer sends three reports. The collector adds each event once.

That raises a future distributed-systems question: what if a producer retries
and sends the same report twice? The current MVP assumes at-most-once local
delivery. A production protocol could add an `eventId` and keep a bounded set of
recent IDs for deduplication.

## 18.5 Cached tokens are not a third independent pile

Provider terminology differs, but cached tokens commonly describe a portion of
the input served through a cache. They are useful for billing and performance,
yet adding them to input and output may double-count logical tokens.

Shepherd therefore displays total tokens as:

```text
display total = inputTokens + outputTokens
```

It tracks cached tokens separately in details. This lets the UI say:

```text
12,000 input
 2,000 output
 8,000 cached
```

without claiming the session used 22,000 independent tokens.

The exact interpretation still belongs to the provider adapter. Its job is to
map provider semantics into the documented common contract.

## 18.6 Why cost is accepted but not calculated

It is tempting to ship a table like this:

```ts
cost = inputTokens * inputRate + outputTokens * outputRate
```

Real billing complicates the formula:

- Model prices change over time.
- Cached input may have a different rate.
- Batch or priority tiers may differ.
- Subscriptions may not expose per-request dollar cost.
- Enterprise contracts can use private pricing.
- Some reported token categories may be non-billable.

A stale pricing table produces precise-looking misinformation. The MVP accepts
`costUsd` only when the producer reports or calculates it with better knowledge.
The UI calls it **reported cost**, not “your bill.”

If Shepherd later calculates estimates, the result should include a pricing
source and version:

```ts
interface CostEstimate {
  usd: number
  priceSource: string
  priceEffectiveAt: string
  accuracy: 'estimated'
}
```

## 18.7 Validate at the trust boundary

TypeScript types disappear at runtime. A Unix socket client can send any JSON:

```json
{
  "method": "report-usage",
  "params": {
    "inputTokens": -500,
    "outputTokens": "many",
    "accuracy": "probably"
  }
}
```

If malformed values reach a reducer, they can create `NaN`, negative totals, or
misleading UI. Validation belongs in the Electron main process because that is
where untrusted external input enters the application.

The normalizer checks:

- Required values are present.
- Token counts are finite, non-negative integers.
- Cost is a finite, non-negative number when supplied.
- Accuracy is one of two explicit literals.
- Provider and model labels are non-empty strings when supplied.

CLI flags arrive as strings, so the boundary intentionally converts numeric
strings. Conversion and validation happen together; downstream code receives a
fully normalized `UsageReport`.

## 18.8 Transport over the existing Unix socket

The feature reuses Shepherd's newline-delimited JSON protocol:

```json
{
  "id": 1,
  "method": "report-usage",
  "params": { "inputTokens": "1200", "outputTokens": "300", "accuracy": "exact" }
}
```

The newline is framing. Unix sockets provide a byte stream, not one callback per
message. The server buffers bytes until it sees `\n`, parses one object, validates
it, resolves the target workspace, and forwards a normalized event.

The CLI command is intentionally explicit:

```bash
shepherd report-usage \
  --input-tokens 1200 \
  --output-tokens 300 \
  --cached-tokens 800 \
  --accuracy exact \
  --provider example \
  --model example-large
```

Shell conventions prefer kebab-case flags. JavaScript conventions prefer
camelCase properties. The CLI maps between them before serializing JSON.

Inside a pane, `SHEPHERD_WORKSPACE_ID` supplies the default target. An adapter does
not need to discover which sidebar row owns its terminal.

## 18.9 Pure aggregation in a reducer

Aggregation is a fold over events:

```text
new totals = accumulate(old totals, new report)
```

For numeric fields:

```ts
next.inputTokens = old.inputTokens + report.inputTokens
next.outputTokens = old.outputTokens + report.outputTokens
next.cachedTokens = old.cachedTokens + report.cachedTokens
```

For uncertainty:

```ts
next.hasEstimated = old.hasEstimated || report.accuracy === 'estimated'
```

The function returns a new object. React depends on immutable state to identify
changes, and pure reducers are easier to test, replay, and reason about.

Each workspace owns independent totals. A report resolved to workspace A must
not affect workspace B. This matches the product model: workspaces represent
separate tasks or agents even when they share one application window.

The latest event is retained for provenance details, while cumulative totals
answer the everyday sidebar question.

## 18.10 Persistence is a product decision, not a default

Persisting telemetry sounds convenient until its lifetime becomes ambiguous.
Does “session total” mean:

- Since the app launched?
- Since the workspace was created?
- Across every restored launch?
- Since the agent process started?
- Since a provider conversation ID began?

The MVP keeps usage ephemeral and resets it during session restoration. This
matches a simple promise: displayed usage belongs to reports observed during the
current application run.

A later persistent design should store explicit scope identifiers, schema
versions, and reset controls. Never silently change a session-scoped counter
into an all-time counter.

## 18.11 Present details without turning cost into anxiety

Telemetry competes with workspace name, status, and attention indicators. A
large permanent dashboard would weaken the sidebar's primary job.

The UI follows progressive disclosure:

- No report: render nothing.
- Reports exist: show a short total.
- Hover or accessibility description: show the breakdown and provenance.

Compact formatting makes scanning easier:

```text
999     → 999
1,250   → 1.3k
25,000  → 25k
1,250,000 → 1.3m
```

The approximate marker belongs at the beginning, where it qualifies the whole
number. Cost appears only when reported. Tabular numerals prevent the row from
visually jumping as digits change.

Accessibility matters even for secondary telemetry. A `title` helps pointer
users, while an `aria-label` exposes the same breakdown to assistive technology.

## 18.12 Building provider adapters

An adapter's responsibilities are deliberately narrow:

1. Observe an authoritative provider or agent usage event.
2. Map provider fields to the common contract.
3. Choose exact or estimated honestly.
4. Invoke `shepherd report-usage` in the correct workspace environment.

Pseudocode for an API client:

```ts
const response = await provider.generate(request)

await reportToCmux({
  inputTokens: response.usage.input,
  outputTokens: response.usage.output,
  cachedTokens: response.usage.cachedInput ?? 0,
  provider: 'example',
  model: response.model,
  accuracy: 'exact'
})
```

An adapter based on locally tokenizing visible text must say `estimated`. It
should also document exactly which text it counts.

Avoid parsing decorated terminal output unless there is no structured extension
point. ANSI escape sequences, redraws, spinners, wrapped text, and hidden context
make terminal scraping fragile even before tokenization begins.

## 18.13 Testing telemetry across layers

Pure functions deserve table-like unit tests:

- Valid numeric strings normalize correctly.
- Negative, fractional, missing, and non-finite values fail.
- Optional values stay optional.
- Multiple reports add correctly.
- Estimated state remains sticky.
- Formatting changes at thousand and million boundaries.

Reducers need isolation tests: report to workspace B and prove workspace A is
unchanged. Restoration tests should prove telemetry resets.

The CLI needs an integration test because argument mapping can compile while
still emitting the wrong wire keys. A controlled test server can:

1. Bind a temporary Unix socket.
2. Spawn the real CLI.
3. Capture one newline-delimited JSON request.
4. Return `{ "ok": true }`.
5. Assert method, params, and workspace targeting.

This test exercises process spawning, environment defaults, flag conversion,
JSON serialization, socket framing, and response handling without launching the
Electron UI.

## 18.14 Failure modes and future hardening

Important future cases include:

- **Duplicate reports:** add stable event IDs and deduplication.
- **Out-of-order events:** use producer timestamps plus ingestion timestamps.
- **Counter snapshots:** distinguish “delta” reports from cumulative snapshots.
- **Very large integers:** JavaScript loses integer precision above
  `Number.MAX_SAFE_INTEGER`; reject or adopt a string/BigInt wire representation.
- **Untrusted local users:** Unix socket permissions and authentication may matter
  on shared machines.
- **Unbounded history:** keep totals or a bounded ring buffer rather than every
  event forever.
- **Provider schema drift:** isolate mappings inside adapters and test fixtures.

The MVP stores deltas, trusts local socket access consistently with the existing
Shepherd API, and retains only totals plus the latest report.

## 18.15 Worked end-to-end example

Suppose an agent receives authoritative metadata:

```text
input:  8,400
output: 1,100
cached: 6,000
cost:   $0.072
```

It reports:

```bash
shepherd report-usage --input-tokens 8400 --output-tokens 1100 \
  --cached-tokens 6000 --cost-usd 0.072 --accuracy exact \
  --provider example --model example-large
```

The CLI sends camelCase JSON. Main validates every value, stamps the event, and
resolves the workspace from `SHEPHERD_WORKSPACE_ID`. React receives `report-usage`.
The reducer adds the report. The sidebar shows:

```text
9.5k tok · $0.07
```

Details preserve the unrounded values and identify the latest producer. If the
next report is estimated, the visible total gains `~` and keeps it for the rest
of that cumulative session.

## Checkpoint

1. Why is terminal output insufficient for exact API usage?
2. What is the semantic difference between zero and unavailable?
3. Why are cached tokens tracked separately from the compact total?
4. Why does validation belong in main rather than only in React?
5. What information would you add to make delivery idempotent?
6. When should an adapter label a report estimated?
7. What scope would you choose before persisting usage across restarts?

## Summary

Trustworthy telemetry is a chain of evidence. The producer measures, the adapter
normalizes, the boundary validates, the reducer aggregates, and the UI preserves
uncertainty. The arithmetic is intentionally boring. The design work is making
sure a precise-looking number never claims more certainty than the system has.

## Further reading

- `11-the-socket-api.md` — transport, framing, and CLI design.
- `09-typescript-and-the-data-model.md` — shared types and runtime validation.
- `13-session-persistence.md` — state lifetime and restoration boundaries.
- `08-react-in-this-app.md` — pure state updates and presentation components.
