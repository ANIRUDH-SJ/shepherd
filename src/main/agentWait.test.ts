import { normalizeAgentWait, waitForAgent } from './agentWait'
import type { AgentRecord } from '../shared/agent'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

const valid = normalizeAgentWait({
  agentId: ' codex:term-1 ',
  state: 'blocked,done,blocked',
  timeoutMs: '2500'
})
assert(valid.ok, 'normalizes agent wait options')
if (valid.ok) {
  assert(valid.options.agentId === 'codex:term-1', 'trims the agent id')
  assert(valid.options.states.join(',') === 'blocked,done', 'normalizes unique states')
  assert(valid.options.timeoutMs === 2500, 'normalizes timeout')
}
assert(!normalizeAgentWait({ agentId: 'agent' }).ok, 'requires a target state')
assert(
  !normalizeAgentWait({ agentId: 'agent', state: 'searching' }).ok,
  'rejects display activities as semantic states'
)
assert(
  !normalizeAgentWait({ agentId: 'agent', state: 'done', timeoutMs: 0 }).ok,
  'rejects invalid timeouts'
)

async function main(): Promise<void> {
  const agent: AgentRecord = {
    agentId: 'codex:term-1',
    provider: 'codex',
    displayName: 'Codex',
    workspaceId: 'ws-1',
    paneId: 'pane-1',
    surfaceId: 'term-1',
    state: 'working',
    source: 'codex:hooks',
    revision: 1,
    updatedAt: 1
  }

  let now = 0
  let polls = 0
  const completed = await waitForAgent(
    () => {
      polls++
      return [{ ...agent, state: polls >= 3 ? 'done' : 'working' }]
    },
    { agentId: agent.agentId, states: ['done'], timeoutMs: 150 },
    () => now,
    async (ms) => {
      now += ms
    }
  )
  assert(completed.ok && completed.agent.state === 'done', 'resolves on semantic state change')

  now = 0
  const timedOut = await waitForAgent(
    () => [agent],
    { agentId: agent.agentId, states: ['blocked'], timeoutMs: 20 },
    () => now,
    async (ms) => {
      now += ms
    }
  )
  assert(!timedOut.ok && timedOut.error.includes('timed out'), 'returns a bounded timeout error')

  if (failures > 0) throw new Error(`${failures} agent wait test(s) failed`)
  console.log('\n✅ ALL AGENT WAIT TESTS PASS')
}

void main()
