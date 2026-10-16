/** Permissions for commands accepted from processes on the local Unix socket.
 * These are app-wide controls, not authentication of a claimed agent provider. */
export interface AgentAccessPolicy {
  version: 1
  terminalInspection: boolean
  terminalInput: boolean
}

export const DEFAULT_AGENT_ACCESS_POLICY: AgentAccessPolicy = {
  version: 1,
  terminalInspection: true,
  terminalInput: true
}

export function parseAgentAccessPolicy(value: unknown): AgentAccessPolicy | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AgentAccessPolicy>
  if (
    candidate.version !== 1 ||
    typeof candidate.terminalInspection !== 'boolean' ||
    typeof candidate.terminalInput !== 'boolean'
  )
    return null
  return {
    version: 1,
    terminalInspection: candidate.terminalInspection,
    terminalInput: candidate.terminalInput
  }
}

export function socketPermissionForMethod(
  policy: AgentAccessPolicy,
  method: string
): string | null {
  if (method === 'inspect-agent' && !policy.terminalInspection) {
    return 'Terminal inspection is disabled in Settings → Agents'
  }
  if ((method === 'send-text' || method === 'send-key') && !policy.terminalInput) {
    return 'Terminal input from the local socket is disabled in Settings → Agents'
  }
  return null
}
