import { agentNeedsAttention, normalizeAgentReport, type AgentReport } from './agent'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

const valid = normalizeAgentReport(
  {
    provider: 'codex',
    state: 'working',
    activity: 'web-search',
    workspaceId: ' ws-1 ',
    surfaceId: 'term-1',
    source: 'codex:hooks',
    displayName: ' Codex\nResearch ',
    message: '  researching\tthe API  ',
    revision: '4',
    ttlMs: '5000'
  },
  1000
)
assert(valid.ok, 'accepts and normalizes a complete agent report')
if (valid.ok) {
  assert(valid.report.agentId === 'codex:hooks:term-1', 'derives a stable agent id')
  assert(valid.report.workspaceId === 'ws-1', 'trims target ids')
  assert(valid.report.displayName === 'Codex Research', 'normalizes control characters in labels')
  assert(valid.report.message === 'researching the API', 'collapses display whitespace')
  assert(valid.report.revision === 4, 'normalizes a numeric revision')
  assert(valid.report.expiresAt === 6000, 'calculates expiry from ingestion time')
}

const minimal = normalizeAgentReport(
  {
    agent: 'claude',
    state: 'idle',
    workspace: 'ws-2',
    surface: 'term-2',
    source: 'claude-hook'
  },
  2000
)
assert(minimal.ok && minimal.report.displayName === 'Claude Code', 'supplies provider label')
assert(minimal.ok && minimal.report.revision === undefined, 'permits unsequenced reports')

assert(
  !normalizeAgentReport({ provider: 'other', state: 'idle' }).ok,
  'rejects unsupported providers'
)
assert(
  !normalizeAgentReport({
    provider: 'codex',
    state: 'idle',
    workspaceId: 'ws',
    surfaceId: 'term',
    source: 'codex',
    activity: 'testing'
  }).ok,
  'rejects working activity on a non-working state'
)
assert(
  !normalizeAgentReport({
    provider: 'codex',
    state: 'working',
    workspaceId: 'ws',
    surfaceId: 'term',
    source: 'bad source'
  }).ok,
  'rejects unsafe source identifiers'
)
assert(
  !normalizeAgentReport({
    provider: 'codex',
    state: 'blocked',
    workspaceId: 'ws',
    surfaceId: 'term',
    source: 'codex',
    ttlMs: 0
  }).ok,
  'rejects invalid expiry windows'
)

const approval: Pick<AgentReport, 'state' | 'blockReason'> = {
  state: 'blocked',
  blockReason: 'approval'
}
assert(agentNeedsAttention(approval), 'approval blocks need attention')
assert(
  !agentNeedsAttention({ state: 'blocked', blockReason: 'external' }),
  'external waits do not request attention'
)
assert(!agentNeedsAttention({ state: 'done' }), 'done is unread but not attention-worthy')

if (failures > 0) throw new Error(`${failures} agent contract test(s) failed`)
console.log('\n✅ ALL AGENT CONTRACT TESTS PASS')
