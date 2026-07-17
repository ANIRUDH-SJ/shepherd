import {
  AGENT_ACTIVITIES,
  AGENT_BLOCK_REASONS,
  AGENT_PROVIDERS,
  AGENT_STATES,
  agentNeedsAttention,
  type AgentActivity,
  type AgentBlockReason,
  type AgentProvider,
  type AgentRecord,
  type AgentState
} from './agent'
import { DEFAULT_AGENT_QUERY_LIMIT, MAX_AGENT_QUERY_LIMIT } from './agentLimits'

export { DEFAULT_AGENT_QUERY_LIMIT, MAX_AGENT_QUERY_LIMIT } from './agentLimits'

export interface AgentQuery {
  providers?: AgentProvider[]
  states?: AgentState[]
  activities?: AgentActivity[]
  blockReasons?: AgentBlockReason[]
  source?: string
  sessionId?: string
  surfaceId?: string
  updatedAfter?: number
  limit: number
}

export interface AgentSummary {
  total: number
  actionable: number
  byState: Record<AgentState, number>
  byProvider: Record<AgentProvider, number>
}

export type AgentQueryValidation = { ok: true; query: AgentQuery } | { ok: false; error: string }

export interface AgentQueryResult {
  agents: AgentRecord[]
  matched: number
  truncated: boolean
  summary: AgentSummary
}

const MAX_FILTER_LENGTH = 200

function parseChoices<const T extends readonly string[]>(
  field: string,
  raw: unknown,
  choices: T
): { ok: true; values?: T[number][] } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true }
  const values = (Array.isArray(raw) ? raw : String(raw).split(',')).map((value) =>
    typeof value === 'string' ? value.trim() : ''
  )
  if (
    values.length === 0 ||
    !values.every((value): value is T[number] => choices.includes(value as T[number]))
  ) {
    return { ok: false, error: `${field} must be one or more of: ${choices.join(', ')}` }
  }
  return { ok: true, values: [...new Set(values)] }
}

function optionalFilter(
  params: Record<string, unknown>,
  field: string
): { ok: true; value?: string } | { ok: false; error: string } {
  if (params[field] === undefined) return { ok: true }
  const value = typeof params[field] === 'string' ? params[field].trim() : ''
  if (!value || value.length > MAX_FILTER_LENGTH) {
    return { ok: false, error: `${field} must be a non-empty string up to ${MAX_FILTER_LENGTH}` }
  }
  return { ok: true, value }
}

export function normalizeAgentQuery(params: Record<string, unknown>): AgentQueryValidation {
  const providers = parseChoices('provider', params.providers ?? params.provider, AGENT_PROVIDERS)
  if (!providers.ok) return providers
  const states = parseChoices('state', params.states ?? params.state, AGENT_STATES)
  if (!states.ok) return states
  const activities = parseChoices(
    'activity',
    params.activities ?? params.activity,
    AGENT_ACTIVITIES
  )
  if (!activities.ok) return activities
  const blockReasons = parseChoices(
    'reason',
    params.blockReasons ?? params.blockReason ?? params.reason,
    AGENT_BLOCK_REASONS
  )
  if (!blockReasons.ok) return blockReasons

  const source = optionalFilter(params, 'source')
  if (!source.ok) return source
  const sessionId = optionalFilter(params, 'sessionId')
  if (!sessionId.ok) return sessionId
  const surfaceId = optionalFilter(params, 'surfaceId')
  if (!surfaceId.ok) return surfaceId

  let updatedAfter: number | undefined
  if (params.updatedAfter !== undefined) {
    const parsed =
      typeof params.updatedAfter === 'string' ? Number(params.updatedAfter) : params.updatedAfter
    if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < 0) {
      return { ok: false, error: 'updatedAfter must be a non-negative integer timestamp' }
    }
    updatedAfter = parsed
  }

  const limitValue = params.limit ?? DEFAULT_AGENT_QUERY_LIMIT
  const limit = typeof limitValue === 'string' ? Number(limitValue) : limitValue
  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_AGENT_QUERY_LIMIT
  ) {
    return { ok: false, error: `limit must be an integer from 1 to ${MAX_AGENT_QUERY_LIMIT}` }
  }

  return {
    ok: true,
    query: {
      ...(providers.values ? { providers: providers.values } : {}),
      ...(states.values ? { states: states.values } : {}),
      ...(activities.values ? { activities: activities.values } : {}),
      ...(blockReasons.values ? { blockReasons: blockReasons.values } : {}),
      ...(source.value ? { source: source.value } : {}),
      ...(sessionId.value ? { sessionId: sessionId.value } : {}),
      ...(surfaceId.value ? { surfaceId: surfaceId.value } : {}),
      ...(updatedAfter === undefined ? {} : { updatedAfter }),
      limit
    }
  }
}

export function summarizeAgents(agents: AgentRecord[]): AgentSummary {
  const byState = Object.fromEntries(AGENT_STATES.map((state) => [state, 0])) as Record<
    AgentState,
    number
  >
  const byProvider = Object.fromEntries(AGENT_PROVIDERS.map((provider) => [provider, 0])) as Record<
    AgentProvider,
    number
  >
  let actionable = 0
  for (const agent of agents) {
    byState[agent.state]++
    byProvider[agent.provider]++
    if (agentNeedsAttention(agent)) actionable++
  }
  return { total: agents.length, actionable, byState, byProvider }
}

export function queryAgents(agents: AgentRecord[], query: AgentQuery): AgentQueryResult {
  const matchedAgents = agents.filter(
    (agent) =>
      (!query.providers || query.providers.includes(agent.provider)) &&
      (!query.states || query.states.includes(agent.state)) &&
      (!query.activities ||
        (agent.activity !== undefined && query.activities.includes(agent.activity))) &&
      (!query.blockReasons ||
        (agent.blockReason !== undefined && query.blockReasons.includes(agent.blockReason))) &&
      (!query.source || agent.source === query.source) &&
      (!query.sessionId || agent.sessionId === query.sessionId) &&
      (!query.surfaceId || agent.surfaceId === query.surfaceId) &&
      (query.updatedAfter === undefined || agent.updatedAt > query.updatedAfter)
  )
  matchedAgents.sort(
    (left, right) => right.updatedAt - left.updatedAt || left.agentId.localeCompare(right.agentId)
  )
  const result = matchedAgents.slice(0, query.limit)
  return {
    agents: result,
    matched: matchedAgents.length,
    truncated: matchedAgents.length > result.length,
    summary: summarizeAgents(matchedAgents)
  }
}
