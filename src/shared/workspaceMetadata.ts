export type WorkspacePullRequestState = 'open' | 'draft' | 'merged' | 'closed'

export interface WorkspacePullRequest {
  number: number
  state: WorkspacePullRequestState
  url: string
}

export interface WorkspaceMetadata {
  surfaceId: string
  cwd: string
  projectName: string
  gitRoot: string | null
  gitBranch: string | null
  pullRequest: WorkspacePullRequest | null
  ports: number[]
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
    left.gitBranch === right.gitBranch &&
    left.pullRequest?.number === right.pullRequest?.number &&
    left.pullRequest?.state === right.pullRequest?.state &&
    left.pullRequest?.url === right.pullRequest?.url &&
    left.ports.length === right.ports.length &&
    left.ports.every((port, index) => port === right.ports[index])
  )
}

export function isWorkspaceMetadata(value: unknown): value is WorkspaceMetadata {
  if (!value || typeof value !== 'object') return false
  const metadata = value as Record<string, unknown>
  const pullRequest = metadata.pullRequest
  const validPullRequest =
    pullRequest === null ||
    (typeof pullRequest === 'object' &&
      typeof (pullRequest as Record<string, unknown>).number === 'number' &&
      Number.isSafeInteger((pullRequest as Record<string, unknown>).number) &&
      ((pullRequest as Record<string, unknown>).number as number) > 0 &&
      ['open', 'draft', 'merged', 'closed'].includes(
        String((pullRequest as Record<string, unknown>).state)
      ) &&
      typeof (pullRequest as Record<string, unknown>).url === 'string' &&
      /^https:\/\/github\.com\//i.test(String((pullRequest as Record<string, unknown>).url)))
  const ports = metadata.ports
  const validPorts =
    Array.isArray(ports) &&
    ports.length <= 16 &&
    ports.every(
      (port, index) =>
        typeof port === 'number' &&
        Number.isInteger(port) &&
        port > 0 &&
        port <= 65_535 &&
        (index === 0 || (ports[index - 1] as number) < port)
    )
  return (
    typeof metadata.surfaceId === 'string' &&
    metadata.surfaceId.length > 0 &&
    typeof metadata.cwd === 'string' &&
    metadata.cwd.startsWith('/') &&
    typeof metadata.projectName === 'string' &&
    metadata.projectName.length > 0 &&
    (metadata.gitRoot === null ||
      (typeof metadata.gitRoot === 'string' && metadata.gitRoot.startsWith('/'))) &&
    (metadata.gitBranch === null || typeof metadata.gitBranch === 'string') &&
    validPullRequest &&
    validPorts
  )
}
