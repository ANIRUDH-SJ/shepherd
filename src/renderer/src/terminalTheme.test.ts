import {
  DARK_TERMINAL_THEME,
  LIGHT_TERMINAL_THEME,
  terminalThemeForAppearance
} from './terminalTheme'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

assert(DARK_TERMINAL_THEME.background === '#1e1e1e', 'uses the cmux dark terminal backdrop')
assert(DARK_TERMINAL_THEME.foreground === '#ffffff', 'uses the cmux dark foreground')
assert(DARK_TERMINAL_THEME.cursor === '#98989d', 'uses the cmux system cursor')
assert(DARK_TERMINAL_THEME.selectionBackground === '#3f638b', 'uses cmux dark selection')
assert(LIGHT_TERMINAL_THEME.background === '#feffff', 'uses the cmux light terminal backdrop')
assert(LIGHT_TERMINAL_THEME.foreground === '#000000', 'uses the cmux light foreground')
assert(LIGHT_TERMINAL_THEME.selectionBackground === '#abd8ff', 'uses cmux light selection')
assert(DARK_TERMINAL_THEME.red === '#cc372e', 'uses the cmux system ANSI red')
assert(DARK_TERMINAL_THEME.blue === '#0869cb', 'uses the cmux system ANSI blue')
assert(DARK_TERMINAL_THEME.brightYellow === '#ffd60a', 'uses the dark system bright yellow')
assert(LIGHT_TERMINAL_THEME.brightYellow === '#e5bc00', 'uses the light system bright yellow')
assert(Object.isFrozen(DARK_TERMINAL_THEME), 'freezes the shared dark theme')
assert(Object.isFrozen(LIGHT_TERMINAL_THEME), 'freezes the shared light theme')
assert(terminalThemeForAppearance('dark') === DARK_TERMINAL_THEME, 'selects the dark palette')
assert(terminalThemeForAppearance('light') === LIGHT_TERMINAL_THEME, 'selects the light palette')
assert(
  [...Object.values(DARK_TERMINAL_THEME), ...Object.values(LIGHT_TERMINAL_THEME)].every(
    (value) => typeof value !== 'string' || !value.includes('var(--color-')
  ),
  'does not couple xterm colors to application chrome variables'
)

if (failures > 0) throw new Error(`${failures} terminal-theme test(s) failed`)
console.log('\n✅ ALL TERMINAL THEME TESTS PASS')
