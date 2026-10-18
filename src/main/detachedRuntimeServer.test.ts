import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createDetachedRuntimeServer } from './detachedRuntimeServer'
import { DetachedRuntimeState, type RuntimeProcess } from './detachedRuntimeState'

const token = 'a'.repeat(64)

class FakeProcess implements RuntimeProcess {
  pid = 4321
  killed = false
  writes: string[] = []
  private output: ((data: string) => void) | null = null

  write(data: string): void {
    this.writes.push(data)
  }
  resize(): void {}
  kill(): void {
    this.killed = true
  }
  onData(listener: (data: string) => void): { dispose(): void } {
    this.output = listener
    return { dispose: () => (this.output = null) }
  }
  onExit(): { dispose(): void } {
    return { dispose() {} }
  }
  emit(data: string): void {
    this.output?.(data)
  }
}

class Client {
  private pending = ''
  private messages: unknown[] = []
  private waiters: Array<(message: unknown) => void> = []

  constructor(readonly socket: net.Socket) {
    socket.on('data', (chunk) => {
      this.pending += chunk.toString('utf8')
      let newline = this.pending.indexOf('\n')
      while (newline >= 0) {
        const message = JSON.parse(this.pending.slice(0, newline)) as unknown
        this.pending = this.pending.slice(newline + 1)
        const waiter = this.waiters.shift()
        if (waiter) waiter(message)
        else this.messages.push(message)
        newline = this.pending.indexOf('\n')
      }
    })
  }

  send(request: Record<string, unknown>): void {
    this.socket.write(JSON.stringify({ version: 1, token, ...request }) + '\n')
  }

  next(): Promise<unknown> {
    const message = this.messages.shift()
    if (message !== undefined) return Promise.resolve(message)
    return new Promise((resolve) => this.waiters.push(resolve))
  }
}

async function connect(path: string): Promise<Client> {
  const socket = net.createConnection(path)
  await once(socket, 'connect')
  return new Client(socket)
}

async function run(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'shepherd-runtime-test-'))
  const path = join(directory, 'runtime.sock')
  const process = new FakeProcess()
  let spawnCount = 0
  const state = new DetachedRuntimeState(() => {
    spawnCount++
    return process
  })
  const server = createDetachedRuntimeServer(path, token, state)
  try {
    await new Promise<void>((resolve) => server.listen(path, resolve))
    assert.equal(statSync(path).mode & 0o777, 0o600)
    const unauthorized = await connect(path)
    unauthorized.send({
      token: 'b'.repeat(64),
      requestId: 'denied',
      operation: 'create',
      terminalId: 'forbidden',
      cols: 80,
      rows: 24
    })
    await once(unauthorized.socket, 'close')
    assert.equal(spawnCount, 0, 'invalid token must not spawn a PTY')
    const first = await connect(path)
    first.send({ requestId: 'create', operation: 'create', terminalId: 'pane', cols: 80, rows: 24 })
    assert.deepEqual(await first.next(), {
      version: 1,
      requestId: 'create',
      ok: true,
      result: { id: 'pane', pid: 4321, attached: false }
    })
    first.send({ requestId: 'attach', operation: 'attach', terminalId: 'pane' })
    assert.deepEqual(await first.next(), {
      version: 1,
      requestId: 'attach',
      ok: true,
      result: { truncated: false }
    })
    first.send({ requestId: 'input', operation: 'input', terminalId: 'pane', data: 'hi' })
    assert.deepEqual(await first.next(), { version: 1, requestId: 'input', ok: true, result: null })
    assert.deepEqual(process.writes, ['hi'])
    first.socket.end()
    await once(first.socket, 'close')
    assert.equal(process.killed, false)
    process.emit('while disconnected')

    const second = await connect(path)
    second.send({ requestId: 'again', operation: 'attach', terminalId: 'pane' })
    assert.deepEqual(await second.next(), {
      version: 1,
      requestId: 'again',
      ok: true,
      result: { truncated: false }
    })
    assert.deepEqual(await second.next(), {
      version: 1,
      event: 'output',
      terminalId: 'pane',
      data: 'while disconnected',
      replay: true
    })
    assert.equal(spawnCount, 1)
    second.send({ requestId: 'dispose', operation: 'dispose', terminalId: 'pane' })
    assert.deepEqual(await second.next(), {
      version: 1,
      requestId: 'dispose',
      ok: true,
      result: null
    })
    assert.equal(process.killed, true)
    second.socket.end()
    await once(second.socket, 'close')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(path, { force: true })
    rmSync(directory, { recursive: true, force: true })
  }
  console.log('detached runtime server tests passed')
}

void run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
