import { app, ipcMain } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import {
  DEFAULT_AGENT_ACCESS_POLICY,
  parseAgentAccessPolicy,
  type AgentAccessPolicy
} from '../shared/agentAccess'
import { writeSessionSnapshot } from './sessionFile'

let cachedPolicy: AgentAccessPolicy | null = null

function policyPath(): string {
  return join(app.getPath('userData'), 'agent-access.json')
}

export function getAgentAccessPolicy(): AgentAccessPolicy {
  if (cachedPolicy) return cachedPolicy
  try {
    cachedPolicy =
      parseAgentAccessPolicy(JSON.parse(readFileSync(policyPath(), 'utf8'))) ??
      DEFAULT_AGENT_ACCESS_POLICY
  } catch {
    cachedPolicy = DEFAULT_AGENT_ACCESS_POLICY
  }
  return cachedPolicy
}

export function setAgentAccessPolicy(value: unknown): AgentAccessPolicy {
  const parsed = parseAgentAccessPolicy(value)
  if (!parsed) throw new Error('Invalid agent access policy')
  writeSessionSnapshot(policyPath(), parsed)
  cachedPolicy = parsed
  return parsed
}

export function registerAgentAccessIpc(): void {
  ipcMain.handle(IPC.AGENT_ACCESS_GET, () => getAgentAccessPolicy())
  ipcMain.handle(IPC.AGENT_ACCESS_SET, (_event, value: unknown) => setAgentAccessPolicy(value))
}
