import { agentNeedsAttention, type AgentRecord } from '../../shared/agent'

const STATE_PRIORITY: Record<AgentRecord['state'], number> = {
  blocked: 0,
  working: 1,
  done: 2,
  idle: 3,
  unknown: 4
}

export type AgentSidebarGroupKey = 'needs-you' | 'working' | 'waiting' | 'finished' | 'quiet'

export interface AgentSidebarGroup {
  key: AgentSidebarGroupKey
  label: string
  agents: AgentRecord[]
}

const AGENT_GROUPS: Array<{
  key: AgentSidebarGroupKey
  label: string
  matches: (agent: AgentRecord) => boolean
}> = [
  { key: 'needs-you', label: 'Needs you', matches: agentNeedsAttention },
  { key: 'working', label: 'Working', matches: (agent) => agent.state === 'working' },
  {
    key: 'waiting',
    label: 'Waiting',
    matches: (agent) => agent.state === 'blocked' && !agentNeedsAttention(agent)
  },
  { key: 'finished', label: 'Finished', matches: (agent) => agent.state === 'done' },
  {
    key: 'quiet',
    label: 'Quiet',
    matches: (agent) => agent.state === 'idle' || agent.state === 'unknown'
  }
]

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

/** Compact provider and state text for an agent shown inside its owning workspace. */
export function workspaceAgentLabel(agent: AgentRecord): string {
  return `${agent.displayName} · ${agentStatusLabel(agent)}`
}

/** Keep the visible row terse while exposing optional provider detail accessibly. */
export function workspaceAgentAriaLabel(agent: AgentRecord, workspaceName: string): string {
  const message = agent.message ? `, ${agent.message}` : ''
  return `Focus ${agent.displayName}, ${agentStatusLabel(agent)}, ${workspaceName}${message}`
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

export function groupAgentsForSidebar(agents: AgentRecord[]): AgentSidebarGroup[] {
  const ordered = sortAgentsForSidebar(agents)
  return AGENT_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    agents: ordered.filter(group.matches)
  })).filter((group) => group.agents.length > 0)
}

export function formatAgentElapsed(updatedAt: number, now: number): string {
  const ageSeconds = Math.max(0, Math.floor((now - updatedAt) / 1000))
  if (ageSeconds < 5) return 'now'
  if (ageSeconds < 60) return `${Math.floor(ageSeconds / 5) * 5}s`
  const ageMinutes = Math.floor(ageSeconds / 60)
  if (ageMinutes < 60) return `${ageMinutes}m`
  const ageHours = Math.floor(ageMinutes / 60)
  if (ageHours < 24) return `${ageHours}h`
  return `${Math.floor(ageHours / 24)}d`
}

export function agentRollupLabel(agents: AgentRecord[]): string | undefined {
  if (agents.length === 0) return undefined
  const states = (Object.keys(STATE_PRIORITY) as AgentRecord['state'][]).sort(
    (a, b) => STATE_PRIORITY[a] - STATE_PRIORITY[b]
  )
  const groups = states
    .map((state) => ({ state, count: agents.filter((agent) => agent.state === state).length }))
    .filter((group) => group.count > 0)
  const visible = groups.slice(0, 2)
  const hiddenCount = groups.slice(2).reduce((total, group) => total + group.count, 0)
  const summary = visible.map((group) => `${group.count} ${group.state}`).join(' · ')
  return hiddenCount > 0 ? `${summary} · +${hiddenCount}` : summary
}

function updatedLabel(agent: AgentRecord, now: number): string {
  const elapsed = formatAgentElapsed(agent.updatedAt, now)
  return elapsed === 'now' ? 'updated now' : `updated ${elapsed} ago`
}

export function agentAriaLabel(
  agent: AgentRecord,
  workspaceName: string,
  now = Date.now()
): string {
  const message = agent.message ? `, ${agent.message}` : ''
  return `${agent.displayName}, ${agent.state}, ${agentStatusLabel(agent)}, ${workspaceName}${message}, ${updatedLabel(agent, now)}`
}
