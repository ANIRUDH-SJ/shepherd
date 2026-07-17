export interface WorkspaceMetadata {
  surfaceId: string
  cwd: string
  projectName: string
  gitRoot: string | null
  gitBranch: string | null
}

const MAX_PROJECT_NAME_LENGTH = 120

/** Derive a compact project label without exposing more of the path than the UI needs. */
export function workspaceProjectName(cwd: string, gitRoot?: string | null, home?: string): string {
  const source = gitRoot || cwd
  if (source === '~' || (!gitRoot && home !== undefined && source === home)) return 'Home'
  const normalized = source.replace(/\/+$/, '')
  const name = normalized.split('/').filter(Boolean).at(-1) ?? '/'
  return name.slice(0, MAX_PROJECT_NAME_LENGTH)
}

export function sameWorkspaceMetadata(
  left: WorkspaceMetadata | undefined,
  right: WorkspaceMetadata
): boolean {
  return (
    left?.surfaceId === right.surfaceId &&
    left.cwd === right.cwd &&
    left.projectName === right.projectName &&
    left.gitRoot === right.gitRoot &&
    left.gitBranch === right.gitBranch
  )
}

export function isWorkspaceMetadata(value: unknown): value is WorkspaceMetadata {
  if (!value || typeof value !== 'object') return false
  const metadata = value as Record<string, unknown>
  return (
    typeof metadata.surfaceId === 'string' &&
    metadata.surfaceId.length > 0 &&
    typeof metadata.cwd === 'string' &&
    metadata.cwd.startsWith('/') &&
    typeof metadata.projectName === 'string' &&
    metadata.projectName.length > 0 &&
    (metadata.gitRoot === null ||
      (typeof metadata.gitRoot === 'string' && metadata.gitRoot.startsWith('/'))) &&
    (metadata.gitBranch === null || typeof metadata.gitBranch === 'string')
  )
}
