import {
  accumulateUsage,
  emptyUsageTotals,
  normalizeUsageReport,
  type UsageReport
} from './usage'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

const valid = normalizeUsageReport(
  {
    inputTokens: '1200',
    outputTokens: 300,
    cachedTokens: '800',
    costUsd: '0.042',
    model: ' model-x ',
    provider: 'provider-y',
    accuracy: 'exact'
  },
  123
)
assert(valid.ok, 'accepts numeric CLI strings and numbers')
if (valid.ok) {
  assert(valid.report.inputTokens === 1200, 'normalizes input tokens')
  assert(valid.report.cachedTokens === 800, 'normalizes cached tokens')
  assert(valid.report.costUsd === 0.042, 'normalizes optional cost')
  assert(valid.report.model === 'model-x', 'trims optional labels')
  assert(valid.report.timestamp === 123, 'uses ingestion timestamp')
}

const minimal = normalizeUsageReport(
  { inputTokens: 0, outputTokens: 25, accuracy: 'estimated' },
  456
)
assert(minimal.ok && minimal.report.cachedTokens === 0, 'defaults omitted cached tokens to zero')
assert(minimal.ok && minimal.report.costUsd === undefined, 'keeps omitted cost unknown')

assert(!normalizeUsageReport({ outputTokens: 1, accuracy: 'exact' }).ok, 'requires input tokens')
assert(
  !normalizeUsageReport({ inputTokens: 1, outputTokens: -1, accuracy: 'exact' }).ok,
  'rejects negative tokens'
)
assert(
  !normalizeUsageReport({ inputTokens: 1.5, outputTokens: 1, accuracy: 'exact' }).ok,
  'rejects fractional tokens'
)
assert(
  !normalizeUsageReport({ inputTokens: 1, outputTokens: 1, accuracy: 'guess' }).ok,
  'requires declared accuracy'
)

const exact: UsageReport = {
  inputTokens: 100,
  outputTokens: 20,
  cachedTokens: 60,
  costUsd: 0.01,
  accuracy: 'exact',
  timestamp: 1
}
const estimated: UsageReport = {
  inputTokens: 200,
  outputTokens: 40,
  cachedTokens: 0,
  accuracy: 'estimated',
  timestamp: 2
}
const totals = accumulateUsage(accumulateUsage(emptyUsageTotals(), exact), estimated)
assert(totals.inputTokens === 300 && totals.outputTokens === 60, 'accumulates token totals')
assert(totals.cachedTokens === 60 && totals.costUsd === 0.01, 'accumulates cache and known cost')
assert(totals.reportCount === 2, 'counts reports')
assert(totals.hasEstimated, 'remembers estimated data in cumulative totals')

if (failures > 0) throw new Error(`${failures} usage test(s) failed`)
console.log('\n✅ ALL USAGE TESTS PASS')
