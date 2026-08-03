import { TERMINAL_THEME } from './terminalTheme'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

assert(TERMINAL_THEME.background === '#272823', 'anchors the UI to the measured cmux backdrop')
assert(TERMINAL_THEME.foreground === '#bdbfb4', 'uses the measured cmux terminal foreground')
assert(TERMINAL_THEME.cursor === '#dededd', 'keeps a distinct neutral terminal cursor')
assert(TERMINAL_THEME.cursorAccent === '#272823', 'keeps cursor text readable')
assert(TERMINAL_THEME.selectionBackground === '#3f8ff766', 'uses a translucent cmux-blue selection')
assert(TERMINAL_THEME.red === '#cc6566', 'uses the bundled cmux Ghostty red')
assert(TERMINAL_THEME.blue === '#82a2be', 'uses the bundled cmux Ghostty blue')
assert(Object.isFrozen(TERMINAL_THEME), 'prevents one terminal from mutating the shared theme')
assert(
  Object.values(TERMINAL_THEME).every(
    (value) => typeof value !== 'string' || !value.includes('var(--color-')
  ),
  'does not couple xterm colors to application chrome variables'
)

if (failures > 0) throw new Error(`${failures} terminal-theme test(s) failed`)
console.log('\n✅ ALL TERMINAL THEME TESTS PASS')
