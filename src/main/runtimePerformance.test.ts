import { RUNTIME_PERFORMANCE_LOG_PREFIX, RuntimePerformanceRecorder } from './runtimePerformance'
import type { RuntimePerformanceMarkName } from '../shared/runtimePerformance'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

const disabledOutput: string[] = []
const disabled = new RuntimePerformanceRecorder({
  enabled: false,
  now: () => 10,
  output: (line) => disabledOutput.push(line)
})
disabled.mark('electron-ready')
disabled.flush()
assert(disabled.snapshot().events.length === 0, 'does no work when diagnostics are disabled')
assert(disabledOutput.length === 0, 'emits no disabled summary')

let now = 0
const output: string[] = []
const recorder = new RuntimePerformanceRecorder({
  enabled: true,
  now: () => ++now + 0.12345,
  output: (line) => output.push(line)
})
recorder.mark('main-process-start', 0)
recorder.mark('main-module-loaded')
recorder.mark('main-module-loaded')
assert(
  recorder.snapshot().events.filter((event) => event.name === 'main-module-loaded').length === 1,
  'records each milestone once'
)
assert(recorder.snapshot().events[1]?.elapsedMs === 1.123, 'rounds elapsed time predictably')

const required: RuntimePerformanceMarkName[] = [
  'electron-ready',
  'backend-services-started',
  'window-created',
  'renderer-bootstrap',
  'renderer-mounted',
  'terminal-opened',
  'terminal-fitted',
  'terminal-renderer-webgl',
  'pty-spawn-requested',
  'pty-spawned',
  'pty-first-output',
  'terminal-first-output-written',
  'window-visible'
]
for (const name of required) recorder.mark(name)

assert(output.length === 1, 'emits once when startup becomes complete')
assert(output[0]?.startsWith(RUNTIME_PERFORMANCE_LOG_PREFIX) === true, 'uses a stable log prefix')
const summary = JSON.parse(output[0]!.slice(RUNTIME_PERFORMANCE_LOG_PREFIX.length)) as {
  complete: boolean
  events: { name: string; elapsedMs: number }[]
}
assert(summary.complete === true, 'labels a complete startup summary')
assert(summary.events.at(-1)?.name === 'startup-ready', 'adds a final readiness milestone')
recorder.flush()
assert(output.length === 1, 'does not emit the completed summary twice')

const partialOutput: string[] = []
const partial = new RuntimePerformanceRecorder({
  enabled: true,
  now: () => 3,
  output: (line) => partialOutput.push(line)
})
partial.mark('main-process-start', 0)
partial.mark('electron-ready')
partial.flush()
partial.flush()
const partialSummary = JSON.parse(
  partialOutput[0]!.slice(RUNTIME_PERFORMANCE_LOG_PREFIX.length)
) as { complete: boolean; events: { name: string }[] }
assert(partialOutput.length === 1, 'flushes an incomplete startup once')
assert(partialSummary.complete === false, 'labels an incomplete startup summary')
assert(
  !partialSummary.events.some((event) => event.name === 'startup-ready'),
  'omits false readiness'
)

if (failures > 0) throw new Error(`${failures} runtime performance recorder test(s) failed`)
console.log('\n✅ ALL RUNTIME PERFORMANCE RECORDER TESTS PASS')
