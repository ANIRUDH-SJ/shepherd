import type { AgentRecord } from '../../shared/agent'

const STATE_PRIORITY: Record<AgentRecord['state'], number> = {
  blocked: 0,
  working: 1,
  done: 2,
  idle: 3,
  unknown: 4
}

const ACTIVITY_LABELS: Record<NonNullable<AgentRecord['activity']>, string> = {
  thinking: 'thinking',
  reading: 'reading files',
  editing: 'editing',
  'running-command': 'running command',
  testing: 'testing',
  'web-search': 'searching web',
  waiting: 'waiting'
}

const BLOCK_LABELS: Record<NonNullable<AgentRecord['blockReason']>, string> = {
  approval: 'waiting approval',
  'user-input': 'waiting input',
  authentication: 'authentication needed',
  'tool-error': 'tool error',
  external: 'waiting externally'
}

export function agentStatusLabel(agent: AgentRecord): string {
  if (agent.state === 'working' && agent.activity) return ACTIVITY_LABELS[agent.activity]
  if (agent.state === 'blocked' && agent.blockReason) return BLOCK_LABELS[agent.blockReason]
  return agent.state
}

export function sortAgentsForSidebar(agents: AgentRecord[]): AgentRecord[] {
  return [...agents].sort((a, b) => {
    const stateDifference = STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state]
    if (stateDifference !== 0) return stateDifference
    const recencyDifference = b.updatedAt - a.updatedAt
    if (recencyDifference !== 0) return recencyDifference
    return a.agentId.localeCompare(b.agentId)
  })
}

export function agentAriaLabel(agent: AgentRecord, workspaceName: string): string {
  const message = agent.message ? `, ${agent.message}` : ''
  return `${agent.displayName}, ${agent.state}, ${agentStatusLabel(agent)}, ${workspaceName}${message}`
}
