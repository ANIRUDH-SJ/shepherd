import { TERMINAL_THEME } from './terminalTheme'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

assert(TERMINAL_THEME.background === '#0d0d0d', 'keeps a terminal-owned background')
assert(TERMINAL_THEME.foreground === '#e6e6e6', 'keeps terminal text independent')
assert(TERMINAL_THEME.cursor === '#8ab4ff', 'keeps a distinct terminal cursor')
assert(TERMINAL_THEME.selectionBackground === '#294366', 'defines terminal selection locally')
assert(Object.isFrozen(TERMINAL_THEME), 'prevents one terminal from mutating the shared theme')
assert(
  Object.values(TERMINAL_THEME).every(
    (value) => typeof value !== 'string' || !value.includes('var(--color-')
  ),
  'does not couple xterm colors to application chrome variables'
)

if (failures > 0) throw new Error(`${failures} terminal-theme test(s) failed`)
console.log('\n✅ ALL TERMINAL THEME TESTS PASS')
