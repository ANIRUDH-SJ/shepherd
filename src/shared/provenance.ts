export const MAX_AUDIT_ENTRIES = 500

export type AuditKind =
  | 'workspace-created'
  | 'workspace-closed'
  | 'workspace-renamed'
  | 'repository-linked'
  | 'repository-unlinked'
  | 'surface-opened'
  | 'surface-closed'
  | 'session-exported'

export interface AuditEntry {
  id: string
  at: number
  kind: AuditKind
  workspaceId: string | null
  workspaceName: string | null
  detail: string
}

export type AuditEvent = Pick<AuditEntry, 'kind' | 'workspaceId' | 'workspaceName' | 'detail'>

interface SessionWorkspace {
  id: string
  name: string
  linkedRepositories: string[]
  surfaceIds: string[]
}

function surfaceIds(node: unknown): string[] {
  if (!node || typeof node !== 'object') return []
  const value = node as Record<string, unknown>
  if (value.type === 'split' && Array.isArray(value.children))
    return value.children.flatMap(surfaceIds)
  if (value.type !== 'pane' || !value.pane || typeof value.pane !== 'object') return []
  const pane = value.pane as Record<string, unknown>
  return Array.isArray(pane.surfaces)
    ? pane.surfaces.flatMap((surface) =>
        surface && typeof surface === 'object' && typeof surface.id === 'string' ? [surface.id] : []
      )
    : []
}

function workspaces(snapshot: unknown): SessionWorkspace[] {
  if (!snapshot || typeof snapshot !== 'object') return []
  const candidates = (snapshot as { workspaces?: unknown }).workspaces
  if (!Array.isArray(candidates)) return []
  return candidates.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const value = item as Record<string, unknown>
    if (typeof value.id !== 'string' || typeof value.name !== 'string') return []
    return [
      {
        id: value.id,
        name: value.name.slice(0, 64),
        linkedRepositories: Array.isArray(value.linkedRepositories)
          ? value.linkedRepositories.filter((root): root is string => typeof root === 'string')
          : [],
        surfaceIds: surfaceIds(value.root)
      }
    ]
  })
}

/** Derive metadata-only events from snapshots; never inspect terminal output or inbox bodies. */
export function deriveAuditEvents(previous: unknown, next: unknown): AuditEvent[] {
  const before = new Map(workspaces(previous).map((workspace) => [workspace.id, workspace]))
  const after = new Map(workspaces(next).map((workspace) => [workspace.id, workspace]))
  const events: AuditEvent[] = []
  const event = (kind: AuditKind, workspace: SessionWorkspace, detail: string): void => {
    events.push({ kind, workspaceId: workspace.id, workspaceName: workspace.name, detail })
  }
  for (const workspace of after.values()) {
    const old = before.get(workspace.id)
    if (!old) {
      event('workspace-created', workspace, 'Workspace created')
      continue
    }
    if (old.name !== workspace.name) event('workspace-renamed', workspace, 'Workspace renamed')
    for (const root of workspace.linkedRepositories)
      if (!old.linkedRepositories.includes(root))
        event('repository-linked', workspace, 'Repository linked')
    for (const root of old.linkedRepositories)
      if (!workspace.linkedRepositories.includes(root))
        event('repository-unlinked', workspace, 'Repository unlinked')
    const oldSurfaces = new Set(old.surfaceIds)
    const newSurfaces = new Set(workspace.surfaceIds)
    for (const id of newSurfaces)
      if (!oldSurfaces.has(id)) event('surface-opened', workspace, 'Tab opened')
    for (const id of oldSurfaces)
      if (!newSurfaces.has(id)) event('surface-closed', workspace, 'Tab closed')
  }
  for (const workspace of before.values())
    if (!after.has(workspace.id)) event('workspace-closed', workspace, 'Workspace closed')
  return events.slice(0, 100)
}

export function sanitizeAuditEntries(value: unknown): AuditEntry[] {
  if (!Array.isArray(value)) return []
  const kinds: AuditKind[] = [
    'workspace-created',
    'workspace-closed',
    'workspace-renamed',
    'repository-linked',
    'repository-unlinked',
    'surface-opened',
    'surface-closed',
    'session-exported'
  ]
  return value
    .filter(
      (entry): entry is AuditEntry =>
        !!entry &&
        typeof entry === 'object' &&
        typeof entry.id === 'string' &&
        entry.id.length <= 100 &&
        typeof entry.at === 'number' &&
        Number.isSafeInteger(entry.at) &&
        entry.at >= 0 &&
        entry.at <= 8.64e15 &&
        kinds.includes(entry.kind) &&
        (entry.workspaceId === null ||
          (typeof entry.workspaceId === 'string' && entry.workspaceId.length <= 256)) &&
        (entry.workspaceName === null ||
          (typeof entry.workspaceName === 'string' && entry.workspaceName.length <= 64)) &&
        typeof entry.detail === 'string' &&
        entry.detail.length <= 100
    )
    .slice(-MAX_AUDIT_ENTRIES)
}

export function sessionExport(
  snapshot: unknown,
  history: AuditEntry[],
  exportedAt: number
): unknown {
  return {
    format: 'shepherd-session-export',
    version: 1,
    exportedAt,
    note: 'Layout and metadata only; running processes cannot be restored from this file.',
    session: snapshot,
    history
  }
}
