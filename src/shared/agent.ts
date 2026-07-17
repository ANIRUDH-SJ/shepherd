export const AGENT_PROVIDERS = ['codex', 'claude', 'opencode', 'custom'] as const
export type AgentProvider = (typeof AGENT_PROVIDERS)[number]

export const AGENT_STATES = ['working', 'blocked', 'done', 'idle', 'unknown'] as const
export type AgentState = (typeof AGENT_STATES)[number]

export const AGENT_ACTIVITIES = [
  'thinking',
  'reading',
  'editing',
  'running-command',
  'testing',
  'web-search',
  'waiting'
] as const
export type AgentActivity = (typeof AGENT_ACTIVITIES)[number]

export const AGENT_BLOCK_REASONS = [
  'approval',
  'user-input',
  'authentication',
  'tool-error',
  'external'
] as const
export type AgentBlockReason = (typeof AGENT_BLOCK_REASONS)[number]

export interface AgentReport {
  agentId: string
  provider: AgentProvider
  displayName: string
  workspaceId: string
  surfaceId: string
  state: AgentState
  activity?: AgentActivity
  blockReason?: AgentBlockReason
  message?: string
  source: string
  sessionId?: string
  revision?: number
  updatedAt: number
  staleAt?: number
  expiresAt?: number
}

export interface AgentRecord extends Omit<AgentReport, 'revision'> {
  paneId: string
  revision: number
}

export type AgentReportValidation = { ok: true; report: AgentReport } | { ok: false; error: string }

const SOURCE_PATTERN = /^[A-Za-z0-9:._-]+$/
const MAX_ID_LENGTH = 200
const MAX_SOURCE_LENGTH = 80
const MAX_LABEL_LENGTH = 80
const MAX_MESSAGE_LENGTH = 240
const MAX_TTL_MS = 86_400_000

function isOneOf<const T extends readonly string[]>(
  value: unknown,
  choices: T
): value is T[number] {
  return typeof value === 'string' && choices.includes(value)
}

function requiredId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_ID_LENGTH || hasControlCharacter(normalized)) {
    return null
  }
  return normalized
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

function displayText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const safe = Array.from(value, (character) =>
    hasControlCharacter(character) ? ' ' : character
  ).join('')
  const normalized = safe.replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, maxLength) : undefined
}

function defaultDisplayName(provider: AgentProvider): string {
  if (provider === 'codex') return 'Codex'
  if (provider === 'claude') return 'Claude Code'
  if (provider === 'opencode') return 'OpenCode'
  return 'Agent'
}

function invalid(field: string, expected: string): AgentReportValidation {
  return { ok: false, error: `${field} ${expected}` }
}

/** Validate and normalize untrusted agent lifecycle params at the process boundary. */
export function normalizeAgentReport(
  params: Record<string, unknown>,
  timestamp = Date.now()
): AgentReportValidation {
  const providerValue = params.provider ?? params.agent
  if (!isOneOf(providerValue, AGENT_PROVIDERS)) {
    return invalid('provider', `must be one of: ${AGENT_PROVIDERS.join(', ')}`)
  }
  const provider = providerValue

  if (!isOneOf(params.state, AGENT_STATES)) {
    return invalid('state', `must be one of: ${AGENT_STATES.join(', ')}`)
  }
  const state = params.state

  const workspaceId = requiredId(params.workspaceId ?? params.workspace)
  if (!workspaceId) return invalid('workspaceId', 'must be a non-empty id')

  const surfaceId = requiredId(params.surfaceId ?? params.surface)
  if (!surfaceId) return invalid('surfaceId', 'must be a non-empty id')

  const source = requiredId(params.source)
  if (!source || source.length > MAX_SOURCE_LENGTH || !SOURCE_PATTERN.test(source)) {
    return invalid(
      'source',
      'must contain only letters, numbers, colon, dot, underscore, or hyphen'
    )
  }

  const suppliedAgentId = requiredId(params.agentId)
  if (params.agentId !== undefined && !suppliedAgentId) {
    return invalid('agentId', 'must be a non-empty id')
  }
  const agentId = suppliedAgentId ?? `${source}:${surfaceId}`
  const displayName =
    displayText(params.displayName, MAX_LABEL_LENGTH) ?? defaultDisplayName(provider)

  let activity: AgentActivity | undefined
  if (params.activity !== undefined) {
    if (!isOneOf(params.activity, AGENT_ACTIVITIES)) {
      return invalid('activity', `must be one of: ${AGENT_ACTIVITIES.join(', ')}`)
    }
    if (state !== 'working') return invalid('activity', 'is only valid when state is working')
    activity = params.activity
  }

  let blockReason: AgentBlockReason | undefined
  const reasonValue = params.blockReason ?? params.reason
  if (reasonValue !== undefined) {
    if (!isOneOf(reasonValue, AGENT_BLOCK_REASONS)) {
      return invalid('blockReason', `must be one of: ${AGENT_BLOCK_REASONS.join(', ')}`)
    }
    if (state !== 'blocked') {
      return invalid('blockReason', 'is only valid when state is blocked')
    }
    blockReason = reasonValue
  }

  let revision: number | undefined
  if (params.revision !== undefined) {
    const parsed = typeof params.revision === 'string' ? Number(params.revision) : params.revision
    if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < 0) {
      return invalid('revision', 'must be a non-negative integer')
    }
    revision = parsed
  }

  let staleAt: number | undefined
  if (params.staleAfterMs !== undefined) {
    const parsed =
      typeof params.staleAfterMs === 'string' ? Number(params.staleAfterMs) : params.staleAfterMs
    if (
      typeof parsed !== 'number' ||
      !Number.isInteger(parsed) ||
      parsed < 1 ||
      parsed > MAX_TTL_MS
    ) {
      return invalid('staleAfterMs', `must be an integer from 1 to ${MAX_TTL_MS}`)
    }
    staleAt = timestamp + parsed
  }

  let expiresAt: number | undefined
  if (params.ttlMs !== undefined) {
    const parsed = typeof params.ttlMs === 'string' ? Number(params.ttlMs) : params.ttlMs
    if (
      typeof parsed !== 'number' ||
      !Number.isInteger(parsed) ||
      parsed < 1 ||
      parsed > MAX_TTL_MS
    ) {
      return invalid('ttlMs', `must be an integer from 1 to ${MAX_TTL_MS}`)
    }
    expiresAt = timestamp + parsed
  }
  if (staleAt !== undefined && expiresAt !== undefined && staleAt >= expiresAt) {
    return invalid('staleAfterMs', 'must be less than ttlMs')
  }

  const message = displayText(params.message, MAX_MESSAGE_LENGTH)
  const sessionId = displayText(params.sessionId, MAX_ID_LENGTH)

  return {
    ok: true,
    report: {
      agentId,
      provider,
      displayName,
      workspaceId,
      surfaceId,
      state,
      ...(activity ? { activity } : {}),
      ...(blockReason ? { blockReason } : {}),
      ...(message ? { message } : {}),
      source,
      ...(sessionId ? { sessionId } : {}),
      ...(revision === undefined ? {} : { revision }),
      updatedAt: timestamp,
      ...(staleAt === undefined ? {} : { staleAt }),
      ...(expiresAt === undefined ? {} : { expiresAt })
    }
  }
}

export function agentNeedsAttention(agent: Pick<AgentReport, 'state' | 'blockReason'>): boolean {
  return agent.state === 'blocked' && agent.blockReason !== 'external'
}
