import { TERMINAL_THEME } from './terminalTheme'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

assert(TERMINAL_THEME.background === '#0d0e0c', 'keeps a terminal-owned graphite background')
assert(TERMINAL_THEME.foreground === '#e8e8e0', 'keeps warm terminal text independent')
assert(TERMINAL_THEME.cursor === '#d7d7cf', 'keeps a distinct neutral terminal cursor')
assert(TERMINAL_THEME.selectionBackground === '#3a3b34', 'keeps selection free of blue tint')
assert(Object.isFrozen(TERMINAL_THEME), 'prevents one terminal from mutating the shared theme')
assert(
  Object.values(TERMINAL_THEME).every(
    (value) => typeof value !== 'string' || !value.includes('var(--color-')
  ),
  'does not couple xterm colors to application chrome variables'
)

if (failures > 0) throw new Error(`${failures} terminal-theme test(s) failed`)
console.log('\n✅ ALL TERMINAL THEME TESTS PASS')
