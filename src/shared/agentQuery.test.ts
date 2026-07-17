import type { AgentRecord } from './agent'
import { normalizeAgentQuery, queryAgents, summarizeAgents } from './agentQuery'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

function agent(
  agentId: string,
  provider: AgentRecord['provider'],
  state: AgentRecord['state'],
  updatedAt: number,
  extra: Partial<AgentRecord> = {}
): AgentRecord {
  return {
    agentId,
    provider,
    displayName: agentId,
    workspaceId: 'ws-1',
    paneId: 'pane-1',
    surfaceId: `term-${agentId}`,
    state,
    source: `${provider}:test`,
    revision: 1,
    updatedAt,
    ...extra
  }
}

const validation = normalizeAgentQuery({
  provider: 'codex, claude',
  state: ['working', 'blocked', 'working'],
  activity: 'web-search',
  reason: 'approval,user-input',
  sessionId: ' session-1 ',
  updatedAfter: '100',
  limit: '25'
})
assert(validation.ok, 'normalizes a complete agent query')
if (validation.ok) {
  assert(validation.query.providers?.join(',') === 'codex,claude', 'normalizes providers')
  assert(validation.query.states?.join(',') === 'working,blocked', 'deduplicates states')
  assert(validation.query.sessionId === 'session-1', 'normalizes exact-match filters')
  assert(validation.query.updatedAfter === 100, 'normalizes the update cursor')
  assert(validation.query.limit === 25, 'normalizes the result limit')
}

assert(!normalizeAgentQuery({ state: 'busy' }).ok, 'rejects unsupported states')
assert(!normalizeAgentQuery({ activity: '' }).ok, 'rejects empty enum filters')
assert(!normalizeAgentQuery({ updatedAfter: -1 }).ok, 'rejects invalid update cursors')
assert(!normalizeAgentQuery({ limit: 1001 }).ok, 'bounds query result size')

const agents = [
  agent('old-block', 'codex', 'blocked', 10, { blockReason: 'approval' }),
  agent('search', 'codex', 'working', 30, {
    activity: 'web-search',
    sessionId: 'session-1'
  }),
  agent('done', 'claude', 'done', 20)
]
const queried = queryAgents(agents, {
  providers: ['codex'],
  states: ['working', 'blocked'],
  limit: 1
})
assert(queried.matched === 2, 'reports matches before the result limit')
assert(queried.truncated, 'reports a truncated result')
assert(queried.agents[0].agentId === 'search', 'returns newest matching records first')
assert(queried.summary.byState.working === 1, 'summarizes matching semantic states')
assert(queried.summary.byState.blocked === 1, 'summarizes matches beyond the result limit')

const summary = summarizeAgents(agents)
assert(summary.total === 3, 'summarizes total agents')
assert(summary.actionable === 1, 'summarizes actionable blocks')
assert(summary.byProvider.codex === 2, 'summarizes provider counts')

if (failures > 0) throw new Error(`${failures} agent query test(s) failed`)
console.log('\n✅ ALL AGENT QUERY TESTS PASS')
