import type { AgentRecord } from '../../shared/agent'
import { nextAgentLifecycleDeadline } from './agentTiming'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

function agent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    agentId: 'codex:hooks:term-1',
    provider: 'codex',
    displayName: 'Codex',
    workspaceId: 'ws-1',
    paneId: 'pane-1',
    surfaceId: 'term-1',
    state: 'working',
    source: 'codex:hooks',
    revision: 1,
    updatedAt: 1_000,
    ...overrides
  }
}

assert(nextAgentLifecycleDeadline([]) === null, 'does not schedule an empty agent list')
assert(
  nextAgentLifecycleDeadline([agent({ staleAt: 2_000, expiresAt: 5_000 })]) === 2_000,
  'schedules the stale transition before expiry'
)
assert(
  nextAgentLifecycleDeadline([
    agent({ agentId: 'later', staleAt: 4_000 }),
    agent({ agentId: 'sooner', staleAt: 3_000 })
  ]) === 3_000,
  'selects the earliest deadline across agents'
)
assert(
  nextAgentLifecycleDeadline([
    agent({ state: 'unknown', staleAt: 2_000, expiresAt: 5_000 })
  ]) === 5_000,
  'skips a stale transition that already happened'
)
assert(
  nextAgentLifecycleDeadline([agent({ state: 'done', expiresAt: 900 })]) === 900,
  'returns an overdue expiry for immediate dispatch'
)

if (failures > 0) throw new Error(`${failures} agent timing test(s) failed`)
console.log('\n✅ ALL AGENT TIMING TESTS PASS')
