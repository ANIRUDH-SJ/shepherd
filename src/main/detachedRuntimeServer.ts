import { timingSafeEqual } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync } from 'node:fs'
import net from 'node:net'
import { dirname } from 'node:path'
import {
  MAX_RUNTIME_FRAME_BYTES,
  parseRuntimeRequest,
  RuntimeFrameDecoder,
  type RuntimeRequest
} from './detachedRuntimeProtocol'
import { DetachedRuntimeState, type RuntimeObserver } from './detachedRuntimeState'

const OUTPUT_FRAME_BYTES = 16 * 1024
const MAX_CLIENT_WRITE_BYTES = 1024 * 1024

function sameToken(actual: string, expected: string): boolean {
  const left = Buffer.from(actual, 'hex')
  const right = Buffer.from(expected, 'hex')
  return left.length === 32 && right.length === 32 && timingSafeEqual(left, right)
}

function outputFrames(data: string): string[] {
  const frames: string[] = []
  let part = ''
  let bytes = 0
  for (const character of data) {
    const size = Buffer.byteLength(character)
    if (bytes + size > OUTPUT_FRAME_BYTES) {
      frames.push(part)
      part = ''
      bytes = 0
    }
    part += character
    bytes += size
  }
  if (part) frames.push(part)
  return frames
}

/** A private, authenticated Unix-socket endpoint around PTY state. Closing a
 * client detaches it; only an explicit dispose terminates a PTY. */
export function createDetachedRuntimeServer(
  path: string,
  token: string,
  runtime: DetachedRuntimeState
): net.Server {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('invalid runtime token')
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const stats = lstatSync(directory)
  if (!stats.isDirectory() || stats.uid !== process.getuid?.() || (stats.mode & 0o077) !== 0) {
    throw new Error('runtime directory must be private to the current user')
  }

  const server = net.createServer((socket) => {
    const decoder = new RuntimeFrameDecoder()
    const send = (message: unknown): void => {
      if (socket.destroyed) return
      const frame = JSON.stringify(message) + '\n'
      if (
        Buffer.byteLength(frame) > MAX_RUNTIME_FRAME_BYTES ||
        socket.writableLength + Buffer.byteLength(frame) > MAX_CLIENT_WRITE_BYTES
      ) {
        socket.destroy()
        return
      }
      socket.write(frame)
    }
    const observer: RuntimeObserver = {
      output: (terminalId, data) => {
        for (const part of outputFrames(data)) {
          send({ version: 1, event: 'output', terminalId, data: part })
        }
      },
      exit: (terminalId, code) => send({ version: 1, event: 'exit', terminalId, exitCode: code })
    }
    const handle = (request: RuntimeRequest): void => {
      try {
        let result: unknown = null
        switch (request.operation) {
          case 'create':
            result = runtime.create({
              id: request.terminalId,
              ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
              ...(request.cwd ? { cwd: request.cwd } : {}),
              cols: request.cols,
              rows: request.rows
            })
            break
          case 'attach': {
            const snapshot = runtime.attach(request.terminalId, observer)
            result = { truncated: snapshot.truncated }
            send({ version: 1, requestId: request.requestId, ok: true, result })
            for (const part of outputFrames(snapshot.replay)) {
              send({
                version: 1,
                event: 'output',
                terminalId: request.terminalId,
                data: part,
                replay: true
              })
            }
            return
          }
          case 'detach':
            runtime.detach(request.terminalId, observer)
            break
          case 'input':
            runtime.input(request.terminalId, observer, request.data)
            break
          case 'resize':
            runtime.resize(request.terminalId, observer, request.cols, request.rows)
            break
          case 'dispose':
            runtime.dispose(request.terminalId, observer)
            break
          case 'list':
            result = runtime.list()
            break
        }
        send({ version: 1, requestId: request.requestId, ok: true, result })
      } catch (error) {
        send({
          version: 1,
          requestId: request.requestId,
          ok: false,
          error: error instanceof Error ? error.message : 'runtime operation failed'
        })
      }
    }
    socket.on('data', (chunk) => {
      try {
        for (const value of decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))) {
          const request = parseRuntimeRequest(value)
          if (!request || !sameToken(request.token, token)) {
            socket.destroy()
            return
          }
          handle(request)
        }
      } catch {
        socket.destroy()
      }
    })
    socket.on('close', () => runtime.detachAll(observer))
  })
  server.on('listening', () => chmodSync(path, 0o600))
  return server
}
