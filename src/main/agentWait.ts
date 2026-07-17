import { AGENT_STATES, type AgentRecord, type AgentState } from '../shared/agent'

export interface AgentWaitOptions {
  agentId: string
  states: AgentState[]
  timeoutMs: number
}

export type AgentWaitValidation =
  { ok: true; options: AgentWaitOptions } | { ok: false; error: string }

export type AgentWaitResult = { ok: true; agent: AgentRecord } | { ok: false; error: string }

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 300_000

export function normalizeAgentWait(params: Record<string, unknown>): AgentWaitValidation {
  const agentId = typeof params.agentId === 'string' ? params.agentId.trim() : ''
  if (!agentId) return { ok: false, error: 'agentId is required' }

  const raw = params.states ?? params.state
  const requested = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',').map((state) => state.trim())
      : []
  if (requested.length === 0) return { ok: false, error: 'state is required' }
  if (
    !requested.every((state): state is AgentState => AGENT_STATES.includes(state as AgentState))
  ) {
    return { ok: false, error: `state must be one of: ${AGENT_STATES.join(', ')}` }
  }

  const timeoutValue = params.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timeoutMs = typeof timeoutValue === 'string' ? Number(timeoutValue) : timeoutValue
  if (
    typeof timeoutMs !== 'number' ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    return { ok: false, error: `timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}` }
  }

  return { ok: true, options: { agentId, states: [...new Set(requested)], timeoutMs } }
}

export async function waitForAgent(
  getAgents: () => AgentRecord[],
  options: AgentWaitOptions,
  clock: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<AgentWaitResult> {
  const deadline = clock() + options.timeoutMs
  while (clock() < deadline) {
    const agent = getAgents().find((candidate) => candidate.agentId === options.agentId)
    if (agent && options.states.includes(agent.state)) return { ok: true, agent }
    await sleep(Math.min(50, Math.max(1, deadline - clock())))
  }
  return {
    ok: false,
    error: `timed out waiting for ${options.agentId} to enter ${options.states.join(', ')}`
  }
}
