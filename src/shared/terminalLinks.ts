export const MAX_TERMINAL_LINK_CANDIDATES = 16
export const MAX_TERMINAL_LINK_TEXT_LENGTH = 1024
export const MAX_TERMINAL_URL_LENGTH = 2048
export const MAX_TERMINAL_LINK_POSITION = 1_000_000

export interface TerminalFileReference {
  path: string
  line?: number
  column?: number
}

export interface ResolveTerminalFileLinksRequest {
  id: string
  candidates: TerminalFileReference[]
}

export type TerminalLinkTarget =
  { kind: 'url'; url: string } | ({ kind: 'file' } & TerminalFileReference)

export interface OpenTerminalLinkRequest {
  id: string
  target: TerminalLinkTarget
}

export type OpenTerminalLinkResult =
  | { ok: true }
  | {
      ok: false
      error: 'invalid-request' | 'terminal-not-found' | 'target-not-found' | 'open-failed'
    }

function isBoundedPlainString(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength &&
    !hasTerminalLinkControlCharacters(value)
  )
}

export function hasTerminalLinkControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function isTerminalId(value: unknown): value is string {
  return isBoundedPlainString(value, 256)
}

function isPosition(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_TERMINAL_LINK_POSITION
  )
}

export function isTerminalFileReference(value: unknown): value is TerminalFileReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<TerminalFileReference>
  if (!isBoundedPlainString(candidate.path, MAX_TERMINAL_LINK_TEXT_LENGTH)) return false
  if (candidate.line !== undefined && !isPosition(candidate.line)) return false
  if (candidate.column !== undefined && !isPosition(candidate.column)) return false
  return candidate.line !== undefined || candidate.column === undefined
}

export function isResolveTerminalFileLinksRequest(
  value: unknown
): value is ResolveTerminalFileLinksRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Partial<ResolveTerminalFileLinksRequest>
  return (
    isTerminalId(request.id) &&
    Array.isArray(request.candidates) &&
    request.candidates.length <= MAX_TERMINAL_LINK_CANDIDATES &&
    request.candidates.every(isTerminalFileReference)
  )
}

export function isOpenTerminalLinkRequest(value: unknown): value is OpenTerminalLinkRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Partial<OpenTerminalLinkRequest>
  if (!isTerminalId(request.id) || !request.target || typeof request.target !== 'object') {
    return false
  }
  if (request.target.kind === 'url') {
    return isBoundedPlainString(request.target.url, MAX_TERMINAL_URL_LENGTH)
  }
  return request.target.kind === 'file' && isTerminalFileReference(request.target)
}
