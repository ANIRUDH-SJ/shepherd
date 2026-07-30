import {
  RUNTIME_PERFORMANCE_MARK_NAMES,
  isRendererRuntimePerformanceMarkName,
  isRuntimePerformanceMarkName,
  runtimePerformanceDiagnosticsEnabled
} from './runtimePerformance'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

assert(
  runtimePerformanceDiagnosticsEnabled({ SHEPHERD_PERF_DIAGNOSTICS: '1' }),
  'enables diagnostics with the exact opt-in value'
)
assert(
  !runtimePerformanceDiagnosticsEnabled({ SHEPHERD_PERF_DIAGNOSTICS: 'true' }),
  'rejects ambiguous opt-in values'
)
assert(
  runtimePerformanceDiagnosticsEnabled({ CMUX_PERF_DIAGNOSTICS: '1' }),
  'accepts the legacy opt-in variable'
)
assert(
  !runtimePerformanceDiagnosticsEnabled({
    SHEPHERD_PERF_DIAGNOSTICS: '0',
    CMUX_PERF_DIAGNOSTICS: '1'
  }),
  'lets an explicit Shepherd value override the legacy variable'
)
assert(!runtimePerformanceDiagnosticsEnabled({}), 'keeps diagnostics disabled by default')
assert(isRuntimePerformanceMarkName('renderer-mounted'), 'accepts a published milestone')
assert(!isRuntimePerformanceMarkName('renderer:arbitrary'), 'rejects an unknown milestone')
assert(!isRuntimePerformanceMarkName({ name: 'electron-ready' }), 'rejects non-string payloads')
assert(
  isRendererRuntimePerformanceMarkName('terminal-opened'),
  'accepts a renderer-owned milestone'
)
assert(
  !isRendererRuntimePerformanceMarkName('electron-ready'),
  'rejects a main-owned milestone from renderer IPC'
)
assert(
  !isRendererRuntimePerformanceMarkName('first-terminal-ready'),
  'keeps the readiness handshake on its dedicated IPC channel'
)
assert(
  new Set(RUNTIME_PERFORMANCE_MARK_NAMES).size === RUNTIME_PERFORMANCE_MARK_NAMES.length,
  'uses unique milestone names'
)

if (failures > 0) throw new Error(`${failures} runtime performance contract test(s) failed`)
console.log('\n✅ ALL RUNTIME PERFORMANCE CONTRACT TESTS PASS')
