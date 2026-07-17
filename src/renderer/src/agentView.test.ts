import type { AgentRecord } from '../../shared/agent'
import { agentAriaLabel, agentStatusLabel, sortAgentsForSidebar } from './agentView'

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
  state: AgentRecord['state'],
  updatedAt: number,
  extra: Partial<AgentRecord> = {}
): AgentRecord {
  return {
    agentId,
    provider: 'custom',
    displayName: agentId,
    workspaceId: 'ws-1',
    paneId: 'pane-1',
    surfaceId: `term-${agentId}`,
    state,
    source: 'test',
    revision: 1,
    updatedAt,
    ...extra
  }
}

assert(
  agentStatusLabel(agent('web', 'working', 1, { activity: 'web-search' })) === 'searching web',
  'renders web search as working detail'
)
assert(
  agentStatusLabel(agent('approval', 'blocked', 1, { blockReason: 'approval' })) ===
    'waiting approval',
  'renders approval as a block reason'
)
assert(agentStatusLabel(agent('done', 'done', 1)) === 'done', 'renders canonical done state')

const sorted = sortAgentsForSidebar([
  agent('idle', 'idle', 5),
  agent('working-old', 'working', 2),
  agent('blocked', 'blocked', 1),
  agent('done', 'done', 8),
  agent('working-new', 'working', 7),
  agent('unknown', 'unknown', 9)
])
assert(
  sorted.map((candidate) => candidate.agentId).join(',') ===
    'blocked,working-new,working-old,done,idle,unknown',
  'sorts by urgency then recency'
)

const ariaAgent = agent('Codex', 'blocked', 1, {
  blockReason: 'user-input',
  message: 'Choose an option'
})
assert(
  agentAriaLabel(ariaAgent, 'cmux-linux').includes('waiting input, cmux-linux, Choose an option'),
  'accessible label includes state, workspace, and detail'
)

if (failures > 0) throw new Error(`${failures} agent view test(s) failed`)
console.log('\n✅ ALL AGENT VIEW TESTS PASS')
