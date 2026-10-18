import assert from 'node:assert/strict'
import {
  DetachedRuntimeState,
  MAX_RUNTIME_TERMINALS,
  TerminalReplayBuffer,
  type RuntimeObserver,
  type RuntimeProcess
} from './detachedRuntimeState'

class FakeProcess implements RuntimeProcess {
  pid = 1234
  writes: string[] = []
  sizes: Array<[number, number]> = []
  killed = false
  private dataListeners = new Set<(data: string) => void>()
  private exitListeners = new Set<(code: number) => void>()

  write(data: string): void {
    this.writes.push(data)
  }
  resize(cols: number, rows: number): void {
    this.sizes.push([cols, rows])
  }
  kill(): void {
    this.killed = true
  }
  onData(listener: (data: string) => void): { dispose(): void } {
    this.dataListeners.add(listener)
    return { dispose: () => this.dataListeners.delete(listener) }
  }
  onExit(listener: (code: number) => void): { dispose(): void } {
    this.exitListeners.add(listener)
    return { dispose: () => this.exitListeners.delete(listener) }
  }
  emitData(data: string): void {
    for (const listener of this.dataListeners) listener(data)
  }
  emitExit(code: number): void {
    for (const listener of this.exitListeners) listener(code)
  }
}

const replay = new TerminalReplayBuffer(5)
replay.append('abc')
replay.append('de')
assert.deepEqual(replay.snapshot(), { data: 'abcde', truncated: false })
replay.append('f')
assert.deepEqual(replay.snapshot(), { data: 'def', truncated: true })
replay.append('123456789')
assert.deepEqual(replay.snapshot(), { data: '56789', truncated: true })

const process = new FakeProcess()
let spawned = 0
const runtime = new DetachedRuntimeState(() => {
  spawned++
  return process
})
assert.deepEqual(runtime.create({ id: 'pane', workspaceId: 'work', cols: 80, rows: 24 }), {
  id: 'pane',
  workspaceId: 'work',
  pid: 1234,
  attached: false
})
assert.throws(() => runtime.create({ id: 'pane', cols: 80, rows: 24 }))
assert.equal(spawned, 1, 'reattachment must not spawn a replacement shell')

const output: string[] = []
const exited: number[] = []
const owner: RuntimeObserver = {
  output: (_id, data) => output.push(data),
  exit: (_id, code) => exited.push(code)
}
const stranger: RuntimeObserver = { output() {}, exit() {} }
process.emitData('before')
assert.deepEqual(runtime.attach('pane', owner), { replay: 'before', truncated: false })
process.emitData('during')
assert.deepEqual(output, ['during'])
assert.throws(() => runtime.attach('pane', stranger), /another client/)
assert.throws(() => runtime.input('pane', stranger, 'secret'), /not attached/)
runtime.input('pane', owner, 'hello')
runtime.resize('pane', owner, 100, 30)
assert.deepEqual(process.writes, ['hello'])
assert.deepEqual(process.sizes, [[100, 30]])
runtime.detachAll(owner)
assert.equal(process.killed, false, 'client disconnect must not kill the PTY')
process.emitData('after')
assert.deepEqual(runtime.attach('pane', stranger), {
  replay: 'beforeduringafter',
  truncated: false
})
assert.deepEqual(runtime.list(), [{ id: 'pane', workspaceId: 'work', pid: 1234, attached: true }])
process.emitExit(7)
assert.deepEqual(exited, [])
assert.deepEqual(runtime.list(), [])
assert.throws(() => runtime.attach('pane', owner), /not found/)

const second = new FakeProcess()
const disposeRuntime = new DetachedRuntimeState(() => second)
disposeRuntime.create({ id: 'second', cols: 80, rows: 24 })
disposeRuntime.attach('second', owner)
assert.throws(() => disposeRuntime.dispose('second', stranger), /not attached/)
disposeRuntime.dispose('second', owner)
assert.equal(second.killed, true)
assert.deepEqual(disposeRuntime.list(), [])

const bounded = new DetachedRuntimeState(() => new FakeProcess())
for (let index = 0; index < MAX_RUNTIME_TERMINALS; index++) {
  bounded.create({ id: `pane-${index}`, cols: 80, rows: 24 })
}
assert.throws(() => bounded.create({ id: 'one-too-many', cols: 80, rows: 24 }), /limit/)

console.log('detached runtime state tests passed')
