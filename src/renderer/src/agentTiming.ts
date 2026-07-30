import type { AgentRecord } from '../../shared/agent'

/** Earliest reducer transition still pending for the current agent records. */
export function nextAgentLifecycleDeadline(agents: AgentRecord[]): number | null {
  let next: number | null = null
  for (const agent of agents) {
    const candidates = [
      ...(agent.state !== 'unknown' && agent.staleAt !== undefined ? [agent.staleAt] : []),
      ...(agent.expiresAt !== undefined ? [agent.expiresAt] : [])
    ]
    for (const candidate of candidates) {
      if (next === null || candidate < next) next = candidate
    }
  }
  return next
}
