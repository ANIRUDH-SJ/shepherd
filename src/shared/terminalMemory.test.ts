import {
  TERMINAL_MEMORY_LOG_PREFIX,
  TERMINAL_SCROLLBACK_LINES,
  terminalMemoryDiagnosticsEnabled
} from './terminalMemory'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

assert(TERMINAL_SCROLLBACK_LINES === 1_000, 'keeps the documented scrollback bound')
assert(TERMINAL_MEMORY_LOG_PREFIX === '[shepherd:memory]', 'uses the Shepherd diagnostic prefix')
assert(
  terminalMemoryDiagnosticsEnabled({ SHEPHERD_MEMORY_DIAGNOSTICS: '1' }),
  'enables exact opt-in'
)
assert(
  terminalMemoryDiagnosticsEnabled({ CMUX_MEMORY_DIAGNOSTICS: '1' }),
  'accepts the legacy opt-in'
)
assert(!terminalMemoryDiagnosticsEnabled({}), 'stays disabled by default')
assert(
  !terminalMemoryDiagnosticsEnabled({ SHEPHERD_MEMORY_DIAGNOSTICS: 'true' }),
  'rejects ambiguous opt-in values'
)
assert(
  !terminalMemoryDiagnosticsEnabled({
    SHEPHERD_MEMORY_DIAGNOSTICS: '0',
    CMUX_MEMORY_DIAGNOSTICS: '1'
  }),
  'lets an explicit Shepherd value disable the legacy opt-in'
)

if (failures > 0) throw new Error(`${failures} terminal memory contract test(s) failed`)
console.log('\n✅ ALL TERMINAL MEMORY CONTRACT TESTS PASS')
