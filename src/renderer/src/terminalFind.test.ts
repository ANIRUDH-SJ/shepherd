import {
  MAX_TERMINAL_FIND_QUERY_LENGTH,
  TERMINAL_FIND_HIGHLIGHT_LIMIT,
  TERMINAL_FIND_TERMINAL_OPTIONS,
  normalizeTerminalFindQuery,
  terminalFindStatus
} from './terminalFind'

let failures = 0
function assert(condition: unknown, message: string): void {
  if (condition) console.log(`  ok: ${message}`)
  else {
    console.error(`FAIL: ${message}`)
    failures++
  }
}

assert(terminalFindStatus('', 0, 0) === 'Enter search text', 'describes an empty query')
assert(
  TERMINAL_FIND_TERMINAL_OPTIONS.allowProposedApi,
  'enables the xterm decoration API required by the official search add-on'
)
assert(terminalFindStatus('build', 0, 0) === 'No results', 'describes no matches')
assert(terminalFindStatus('build', 1, 5) === '2 of 5', 'formats the active match position')
assert(
  terminalFindStatus('build', 0, TERMINAL_FIND_HIGHLIGHT_LIMIT) === '1000+ results',
  'describes the add-on highlight limit'
)
assert(normalizeTerminalFindQuery('a\0b') === 'ab', 'removes control characters')
assert(
  normalizeTerminalFindQuery('x'.repeat(MAX_TERMINAL_FIND_QUERY_LENGTH + 20)).length ===
    MAX_TERMINAL_FIND_QUERY_LENGTH,
  'bounds an expensive search query'
)

if (failures > 0) throw new Error(`${failures} terminal find test(s) failed`)
console.log('\n✅ ALL TERMINAL FIND TESTS PASS')
