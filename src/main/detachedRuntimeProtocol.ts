/** Wire contract for an out-of-process terminal owner. No Electron types
 * cross this boundary, so the same parser can run in the desktop and runtime. */
export const RUNTIME_PROTOCOL_VERSION = 1
export const MAX_RUNTIME_FRAME_BYTES = 64 * 1024
export const MAX_RUNTIME_INPUT_BYTES = 32 * 1024

export type RuntimeRequest =
  | {
      version: 1
      requestId: string
      token: string
      operation: 'create'
      terminalId: string
      workspaceId?: string
      cwd?: string
      cols: number
      rows: number
    }
  | {
      version: 1
      requestId: string
      token: string
      operation: 'attach' | 'detach' | 'dispose'
      terminalId: string
    }
  | {
      version: 1
      requestId: string
      token: string
      operation: 'input'
      terminalId: string
      data: string
    }
  | {
      version: 1
      requestId: string
      token: string
      operation: 'resize'
      terminalId: string
      cols: number
      rows: number
    }
  | { version: 1; requestId: string; token: string; operation: 'list' }

const identifier = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 256 &&
  [...value].every((character) => character.charCodeAt(0) > 31)

const gridSize = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 500

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

/** Reject malformed and overprivileged frames before they reach a PTY. */
export function parseRuntimeRequest(value: unknown): RuntimeRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const request = value as Record<string, unknown>
  if (
    request.version !== RUNTIME_PROTOCOL_VERSION ||
    !identifier(request.requestId) ||
    typeof request.token !== 'string' ||
    !/^[a-f0-9]{64}$/.test(request.token)
  )
    return null

  const common = ['version', 'requestId', 'token', 'operation']
  if (request.operation === 'list') {
    return exactKeys(request, common) ? (request as RuntimeRequest) : null
  }
  if (!identifier(request.terminalId)) return null
  const terminalKeys = [...common, 'terminalId']
  if (['attach', 'detach', 'dispose'].includes(String(request.operation))) {
    return exactKeys(request, terminalKeys) ? (request as RuntimeRequest) : null
  }
  if (request.operation === 'input') {
    return exactKeys(request, [...terminalKeys, 'data']) &&
      typeof request.data === 'string' &&
      Buffer.byteLength(request.data) <= MAX_RUNTIME_INPUT_BYTES
      ? (request as RuntimeRequest)
      : null
  }
  if (request.operation === 'resize') {
    return exactKeys(request, [...terminalKeys, 'cols', 'rows']) &&
      gridSize(request.cols) &&
      gridSize(request.rows)
      ? (request as RuntimeRequest)
      : null
  }
  if (request.operation === 'create') {
    return exactKeys(request, [...terminalKeys, 'workspaceId', 'cwd', 'cols', 'rows']) &&
      (request.workspaceId === undefined || identifier(request.workspaceId)) &&
      (request.cwd === undefined ||
        (typeof request.cwd === 'string' &&
          request.cwd.length > 0 &&
          Buffer.byteLength(request.cwd) <= 4096 &&
          !request.cwd.includes('\u0000'))) &&
      gridSize(request.cols) &&
      gridSize(request.rows)
      ? (request as RuntimeRequest)
      : null
  }
  return null
}

/** Byte-based newline framing: caps memory even if a peer never sends a newline. */
export class RuntimeFrameDecoder {
  private pending = Buffer.alloc(0)

  push(chunk: Buffer): unknown[] {
    if (chunk.length === 0) return []
    const combined = Buffer.concat([this.pending, chunk])
    const frames: unknown[] = []
    let start = 0
    for (let index = 0; index < combined.length; index++) {
      if (combined[index] !== 10) continue
      if (index - start > MAX_RUNTIME_FRAME_BYTES) throw new Error('runtime frame too large')
      const line = combined.subarray(start, index).toString('utf8')
      try {
        frames.push(JSON.parse(line))
      } catch {
        throw new Error('invalid runtime JSON frame')
      }
      start = index + 1
    }
    if (combined.length - start > MAX_RUNTIME_FRAME_BYTES)
      throw new Error('runtime frame too large')
    this.pending = combined.subarray(start)
    return frames
  }
}
