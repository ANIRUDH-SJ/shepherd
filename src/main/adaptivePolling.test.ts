import { AdaptivePollingLoop } from './adaptivePolling'

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
  runNext: () => ScheduledTask | undefined
  pending: () => ScheduledTask[]
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
      let scheduled = tasks.shift()
      while (scheduled?.cancelled) scheduled = tasks.shift()
      scheduled?.run()
      return scheduled
    },
    pending: () => tasks.filter((task) => !task.cancelled)
  }
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function main(): Promise<void> {
  let now = 0
  let runs = 0
  const scheduler = manualScheduler()
  const loop = new AdaptivePollingLoop({
    run: () => {
      runs++
    },
    activeIntervalMs: 1_000,
    idleIntervalMs: 5_000,
    hiddenIntervalMs: 15_000,
    activeForMs: 4_000,
    now: () => now,
    schedule: scheduler.schedule
  })

  loop.start()
  loop.start()
  assert(scheduler.pending().length === 1, 'starts with one immediate poll')
  assert(scheduler.pending()[0]?.delayMs === 0, 'does not wait for the first recovery poll')
  scheduler.runNext()
  await settle()
  assert(runs === 1, 'runs the first poll once')
  assert(scheduler.pending()[0]?.delayMs === 5_000, 'uses the quiet visible interval')

  now = 100
  loop.trigger()
  loop.trigger()
  assert(scheduler.pending().length === 1, 'coalesces repeated activity triggers')
  assert(scheduler.pending()[0]?.delayMs === 0, 'activity accelerates an idle poll immediately')
  scheduler.runNext()
  await settle()
  assert(runs === 2, 'runs the activity poll')
  assert(scheduler.pending()[0]?.delayMs === 1_000, 'uses the active interval after activity')

  now = 1_100
  scheduler.runNext()
  await settle()
  assert(runs === 3, 'continues active polling')
  assert(scheduler.pending()[0]?.delayMs === 1_000, 'keeps the active cadence inside the window')

  loop.setVisible(false)
  assert(scheduler.pending()[0]?.delayMs === 15_000, 'backs off a hidden window')
  loop.setVisible(true)
  assert(scheduler.pending()[0]?.delayMs === 0, 'restoring visibility requests an immediate poll')

  let resolveRun: (() => void) | undefined
  let asyncRuns = 0
  const asyncScheduler = manualScheduler()
  const asyncLoop = new AdaptivePollingLoop({
    run: () =>
      new Promise<void>((resolve) => {
        asyncRuns++
        resolveRun = resolve
      }),
    activeIntervalMs: 1,
    idleIntervalMs: 5,
    hiddenIntervalMs: 15,
    activeForMs: 4,
    now: () => now,
    schedule: asyncScheduler.schedule
  })
  asyncLoop.start()
  asyncScheduler.runNext()
  await Promise.resolve()
  asyncLoop.trigger()
  asyncLoop.trigger()
  assert(asyncRuns === 1, 'never overlaps an async poll')
  assert(asyncScheduler.pending().length === 0, 'holds a trigger while a poll is running')
  resolveRun?.()
  await settle()
  assert(asyncScheduler.pending()[0]?.delayMs === 0, 'runs once more after in-flight activity')

  let reportedErrors = 0
  const errorScheduler = manualScheduler()
  const errorLoop = new AdaptivePollingLoop({
    run: () => {
      throw new Error('temporary failure')
    },
    activeIntervalMs: 1,
    idleIntervalMs: 5,
    hiddenIntervalMs: 15,
    activeForMs: 4,
    now: () => now,
    schedule: errorScheduler.schedule,
    onError: () => reportedErrors++
  })
  errorLoop.start()
  errorScheduler.runNext()
  await settle()
  assert(reportedErrors === 1, 'contains and reports a polling failure')
  assert(errorScheduler.pending()[0]?.delayMs === 5, 'keeps recovery polling after a failure')
  errorLoop.stop()
  errorLoop.stop()
  assert(errorScheduler.pending().length === 0, 'stop is idempotent and cancels pending work')

  asyncLoop.stop()
  resolveRun?.()
  await settle()
  assert(asyncScheduler.pending().length === 0, 'late async completion cannot restart a stopped loop')
  loop.stop()

  if (failures > 0) throw new Error(`${failures} adaptive polling test(s) failed`)
  console.log('\n✅ ALL ADAPTIVE POLLING TESTS PASS')
}

void main()
