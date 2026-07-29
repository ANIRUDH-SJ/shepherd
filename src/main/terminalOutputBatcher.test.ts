import { TerminalOutputBatcher } from './terminalOutputBatcher'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

interface ScheduledTask {
  cancelled: boolean
  delayMs: number
  run: () => void
}

function manualScheduler(): {
  tasks: ScheduledTask[]
  schedule: (task: () => void, delayMs: number) => () => void
  runNext: () => void
} {
  const tasks: ScheduledTask[] = []
  return {
    tasks,
    schedule: (task, delayMs) => {
      const scheduled = { cancelled: false, delayMs, run: task }
      tasks.push(scheduled)
      return () => {
        scheduled.cancelled = true
      }
    },
    runNext: () => {
      const scheduled = tasks.shift()
      if (scheduled && !scheduled.cancelled) scheduled.run()
    }
  }
}

interface SentBatch {
  data: string
  sequence: number
}

let now = 100
const scheduler = manualScheduler()
const sent: SentBatch[] = []
const batcher = new TerminalOutputBatcher({
  send: (data, sequence) => {
    sent.push({ data, sequence })
    return true
  },
  now: () => now,
  schedule: scheduler.schedule,
  targetBatchBytes: 4,
  maxDelayMs: 3,
  maxInFlightBytes: 16,
  pauseAtBytes: 32,
  resumeAtBytes: 8
})

batcher.push('first')
assert(sent[0]?.data === 'first', 'forwards the first output without a batching delay')
batcher.acknowledge(sent[0]!.sequence)

batcher.push('a')
batcher.push('b')
assert(sent.length === 1, 'holds adjacent output below the byte target')
assert(scheduler.tasks.at(-1)?.delayMs === 3, 'uses the bounded time cap')
scheduler.runNext()
assert(sent[1]?.data === 'ab', 'coalesces adjacent chunks in their original order')
batcher.acknowledge(sent[1]!.sequence)

batcher.push('12')
batcher.push('34')
assert(sent[2]?.data === '1234', 'flushes immediately at the byte target')
batcher.acknowledge(sent[2]!.sequence)

batcher.push('\ud83d')
batcher.push('\ude80')
scheduler.runNext()
assert(sent[3]?.data === '🚀', 'preserves Unicode code units across chunk boundaries')
batcher.acknowledge(sent[3]!.sequence)

batcher.push('pending')
batcher.markInteractive()
assert(sent[4]?.data === 'pending', 'flushes pending output before interactive input')
batcher.acknowledge(sent[4]!.sequence)
now += 10
batcher.push('echo')
assert(sent[5]?.data === 'echo', 'forwards input-driven echo without the time cap')
batcher.acknowledge(sent[5]!.sequence)

const pressureScheduler = manualScheduler()
const pressureSent: SentBatch[] = []
let pauses = 0
let resumes = 0
const pressured = new TerminalOutputBatcher({
  send: (data, sequence) => {
    pressureSent.push({ data, sequence })
    return true
  },
  pause: () => pauses++,
  resume: () => resumes++,
  now: () => now,
  schedule: pressureScheduler.schedule,
  targetBatchBytes: 4,
  maxInFlightBytes: 4,
  pauseAtBytes: 8,
  resumeAtBytes: 2
})

pressured.push('aaaa')
pressured.push('bbbb')
assert(pressureSent.length === 1, 'bounds sends while the renderer has an in-flight batch')
assert(pauses === 1, 'pauses PTY reads at the queue high-water mark')
pressured.push('cc')
pressured.acknowledge(999)
assert(pressureSent.length === 1, 'ignores an unknown acknowledgement sequence')
pressured.acknowledge(pressureSent[0]!.sequence)
assert(pressureSent[1]?.data === 'bbbbcc', 'releases queued output after acknowledgement')
assert(resumes === 0, 'keeps reads paused above the low-water mark')
pressured.acknowledge(pressureSent[1]!.sequence)
assert(resumes === 1, 'resumes PTY reads below the low-water mark')

pressured.push('ta')
assert(pressureSent.length === 2, 'holds an undersized tail before exit')
pressured.drain()
assert(pressureSent.at(-1)?.data === 'ta', 'drains pending output before process exit')

const disposeScheduler = manualScheduler()
let disposedSends = 0
let balancedResume = 0
const disposed = new TerminalOutputBatcher({
  send: () => {
    disposedSends++
    return true
  },
  pause: () => undefined,
  resume: () => balancedResume++,
  schedule: disposeScheduler.schedule,
  targetBatchBytes: 10,
  pauseAtBytes: 2,
  resumeAtBytes: 1
})
disposed.push('x')
disposed.push('y')
disposed.dispose()
disposeScheduler.runNext()
disposed.push('ignored')
assert(disposedSends === 1, 'cancels delayed sends and ignores output after disposal')
assert(balancedResume === 1, 'balances a paused PTY when the batcher is disposed')

const closedScheduler = manualScheduler()
let closedRendererSends = 0
const closedRenderer = new TerminalOutputBatcher({
  send: () => {
    closedRendererSends++
    return false
  },
  schedule: closedScheduler.schedule
})
closedRenderer.push('orphaned')
closedRenderer.push('still accepted')
closedScheduler.runNext()
assert(
  closedRendererSends === 2,
  'releases capacity immediately when no renderer can acknowledge it'
)

if (failures > 0) throw new Error(`${failures} terminal output batcher test(s) failed`)
console.log('\n✅ ALL TERMINAL OUTPUT BATCHER TESTS PASS')
