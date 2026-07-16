import { emptyWorkspaceUsage, addWorkspaceUsage, type UsageReport } from '../../shared/usage'
import { formatTokenCount, usageDetails, usageSummary } from './usageView'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

assert(formatTokenCount(999) === '999', 'formats small token counts')
assert(formatTokenCount(1250) === '1.3k', 'formats thousands compactly')
assert(formatTokenCount(25_000) === '25k', 'drops decimals for large thousands')
assert(formatTokenCount(1_250_000) === '1.3m', 'formats millions compactly')
assert(usageSummary(emptyWorkspaceUsage()) === null, 'hides empty usage')

const report: UsageReport = {
  inputTokens: 1200,
  outputTokens: 300,
  cachedTokens: 800,
  costUsd: 0.042,
  provider: 'provider-a',
  model: 'model-a',
  accuracy: 'estimated',
  timestamp: 1
}
const usage = addWorkspaceUsage(emptyWorkspaceUsage(), report)
assert(usageSummary(usage) === '~1.5k tok · $0.04', 'marks estimates and reported cost')
assert(usageDetails(usage).includes('1,200 input tokens'), 'details include input tokens')
assert(usageDetails(usage).includes('Latest: provider-a · model-a'), 'details include provenance')

if (failures > 0) throw new Error(`${failures} usage-view test(s) failed`)
console.log('\n✅ ALL USAGE-VIEW TESTS PASS')
