export interface ReviewFile {
  path: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  conflicted: boolean
}

export interface ReviewStatus {
  root: string
  branch: string | null
  files: ReviewFile[]
  truncated: boolean
  canRunNpmTest: boolean
}

export interface ReviewDiff {
  path: string
  section: 'staged' | 'unstaged'
  text: string
  truncated: boolean
}

export interface ReviewRequest {
  surfaceId: string
}

export interface ReviewFileRequest extends ReviewRequest {
  root: string
  path: string
}

export interface ReviewDiffRequest extends ReviewFileRequest {
  section: 'staged' | 'unstaged'
}

export interface ReviewCommitRequest extends ReviewRequest {
  root: string
  message: string
}

export interface ReviewRootRequest extends ReviewRequest {
  root: string
}

export interface ReviewTestResult {
  ok: boolean
  output: string
  truncated: boolean
}

export interface ReviewPullRequestDiff {
  text: string
  truncated: boolean
}

export function isReviewRequest(value: unknown): value is ReviewRequest {
  if (!value || typeof value !== 'object') return false
  const surfaceId = (value as Record<string, unknown>).surfaceId
  return typeof surfaceId === 'string' && surfaceId.length > 0 && surfaceId.length <= 128
}

export function isReviewFileRequest(value: unknown): value is ReviewFileRequest {
  if (!isReviewRequest(value)) return false
  const request = value as unknown as Record<string, unknown>
  const path = request.path
  return (
    typeof request.root === 'string' &&
    request.root.startsWith('/') &&
    request.root.length <= 4096 &&
    typeof path === 'string' &&
    path.length > 0 &&
    path.length <= 4096 &&
    !path.includes('\0')
  )
}

export function isReviewDiffRequest(value: unknown): value is ReviewDiffRequest {
  if (!isReviewFileRequest(value)) return false
  const section = (value as unknown as Record<string, unknown>).section
  return section === 'staged' || section === 'unstaged'
}

export function isReviewCommitRequest(value: unknown): value is ReviewCommitRequest {
  if (!isReviewRequest(value)) return false
  const request = value as unknown as Record<string, unknown>
  const message = request.message
  return (
    typeof request.root === 'string' &&
    request.root.startsWith('/') &&
    request.root.length <= 4096 &&
    typeof message === 'string' &&
    message.trim().length > 0 &&
    message.length <= 200 &&
    ![...message].some((character) => {
      const code = character.codePointAt(0) ?? 0
      return code < 32 || code === 127
    })
  )
}

export function isReviewRootRequest(value: unknown): value is ReviewRootRequest {
  if (!isReviewRequest(value)) return false
  const root = (value as unknown as Record<string, unknown>).root
  return typeof root === 'string' && root.startsWith('/') && root.length <= 4096
}
