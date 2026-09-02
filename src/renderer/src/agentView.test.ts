import type { AgentRecord } from '../../shared/agent'
import type { InboxNotification } from './state/notificationInbox'
import {
  attentionAgentsForSidebar,
  agentAriaLabel,
  groupAgentsForSidebar,
  agentRollupLabel,
  agentStatusLabel,
  formatAgentElapsed,
  isUnseenCompletedAgent,
  sortAgentsForSidebar,
  workspaceAgentAriaLabel,
  workspaceAgentLabel
} from './agentView'

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

function completionNotification(agentId: string, workspaceId = 'ws-1'): InboxNotification {
  return {
    id: `agent:${agentId}:1`,
    workspaceId,
    surfaceId: `term-${agentId}`,
    subjectId: agentId,
    title: agentId,
    body: 'Completed work',
    sources: ['agent'],
    severity: 'info',
    createdAt: 10,
    unread: true,
    resolved: false,
    occurrences: 1,
    dedupeKey: `test:${agentId}`
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

const contextualAgent = agent('Codex', 'working', 1, { activity: 'testing' })
assert(
  workspaceAgentLabel(contextualAgent) === 'Codex · testing',
  'keeps contextual agent text compact'
)
assert(
  workspaceAgentAriaLabel(
    agent('Claude', 'blocked', 1, {
      blockReason: 'approval',
      message: 'Allow npm test?'
    }),
    'shepherd'
  ) === 'Focus Claude, waiting approval, shepherd, Allow npm test?',
  'describes exact contextual agent navigation accessibly'
)

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

const grouped = groupAgentsForSidebar([
  agent('quiet', 'idle', 1),
  agent('external', 'blocked', 2, { blockReason: 'external' }),
  agent('approval', 'blocked', 3, { blockReason: 'approval' }),
  agent('active', 'working', 4),
  agent('finished', 'done', 5)
])
assert(
  grouped.map((group) => group.label).join(',') === 'Needs you,Working,Waiting,Finished,Quiet',
  'groups agents into explicit urgency bands'
)
assert(grouped[0].agents[0].agentId === 'approval', 'puts actionable blocks in Needs you')
assert(grouped[2].agents[0].agentId === 'external', 'keeps external blocks in Waiting')

const ariaAgent = agent('Codex', 'blocked', 1, {
  blockReason: 'user-input',
  message: 'Choose an option'
})
assert(
  agentAriaLabel(ariaAgent, 'shepherd', 61_001).includes(
    'waiting input, shepherd, Choose an option, updated 1m ago'
  ),
  'accessible label includes state, workspace, and detail'
)

assert(formatAgentElapsed(10_000, 12_000) === 'now', 'formats a fresh report as now')
assert(formatAgentElapsed(10_000, 27_000) === '15s', 'buckets recent reports by five seconds')
assert(formatAgentElapsed(10_000, 130_000) === '2m', 'formats elapsed minutes')
assert(formatAgentElapsed(10_000, 7_210_000) === '2h', 'formats elapsed hours')
assert(formatAgentElapsed(10_000, 172_810_000) === '2d', 'formats elapsed days')

const rollup = agentRollupLabel([
  agent('blocked-1', 'blocked', 1),
  agent('blocked-2', 'blocked', 1),
  agent('working-1', 'working', 1),
  agent('done-1', 'done', 1),
  agent('idle-1', 'idle', 1)
])
assert(rollup === '2 need you · Working', 'summarizes semantic urgent and active states')
assert(
  agentRollupLabel([agent('done-2', 'done', 1), agent('idle-2', 'idle', 1)], true) ===
    'Completed · Idle',
  'calls out unseen completion without relying on color'
)
assert(agentRollupLabel([]) === undefined, 'omits an empty workspace rollup')

const completedAgent = agent('completed', 'done', 8)
const unreadCompletion = completionNotification(completedAgent.agentId)
assert(
  isUnseenCompletedAgent(completedAgent, [unreadCompletion]),
  'recognizes an unread completed-agent notification'
)
assert(
  !isUnseenCompletedAgent(completedAgent, [{ ...unreadCompletion, unread: false }]),
  'does not treat an acknowledged completion as unseen'
)
assert(
  isUnseenCompletedAgent(completedAgent, [], new Set(['ws-1'])),
  'uses the workspace unread marker when a deduplicated notification lost subject detail'
)

const attentionAgents = attentionAgentsForSidebar(
  [
    agent('active', 'working', 12),
    agent('approval', 'blocked', 11, { blockReason: 'approval' }),
    agent('external', 'blocked', 10, { blockReason: 'external' }),
    completedAgent,
    agent('seen', 'done', 7),
    agent('idle', 'idle', 6),
    agent('stale', 'unknown', 5)
  ],
  [unreadCompletion]
)
assert(
  attentionAgents.map((candidate) => candidate.agentId).join(',') === 'approval,completed',
  'attention list contains only actionable blocks and unseen completions'
)

if (failures > 0) throw new Error(`${failures} agent view test(s) failed`)
console.log('\n✅ ALL AGENT VIEW TESTS PASS')
