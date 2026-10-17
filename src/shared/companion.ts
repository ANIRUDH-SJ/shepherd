import type { WorkspacesSync } from './ipc'

export interface CompanionStatus {
  running: boolean
  url: string | null
  accessCode: string | null
}

export interface CompanionNetwork {
  label: string
  address: string
}

export interface CompanionSnapshot {
  version: 1
  activeWorkspaceId: string | null
  workspaces: Array<{
    id: string
    name: string
    working: number
    blocked: number
    done: number
  }>
}

/** Deliberately excludes paths, terminal output, messages, and token usage. */
export function companionSnapshot(sync: WorkspacesSync): CompanionSnapshot {
  return {
    version: 1,
    activeWorkspaceId: sync.activeWorkspaceId || null,
    workspaces: sync.workspaces.slice(0, 100).map((workspace) => {
      const agents = sync.agents.filter((agent) => agent.workspaceId === workspace.id)
      return {
        id: workspace.id,
        name: workspace.name.slice(0, 64) || 'Workspace',
        working: agents.filter((agent) => agent.state === 'working').length,
        blocked: agents.filter((agent) => agent.state === 'blocked').length,
        done: agents.filter((agent) => agent.state === 'done').length
      }
    })
  }
}

export function privateIPv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return false
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  )
}
