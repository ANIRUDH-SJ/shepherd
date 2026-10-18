import {
  CHROME_COLOR_KEYS,
  TERMINAL_COLOR_KEYS,
  contrastRatio,
  parseCustomTheme,
  validateCustomTheme
} from './customTheme'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}
function rejects(value: unknown, message: string): void {
  try {
    validateCustomTheme(value)
    assert(false, message)
  } catch {
    assert(true, message)
  }
}

const chrome = Object.fromEntries(CHROME_COLOR_KEYS.map((key) => [key, '#ffffff']))
chrome.canvas = '#000000'
chrome.sidebar = '#000000'
chrome.surface = '#000000'
chrome.selection = '#000000'
chrome['selection-hover'] = '#000000'
const terminal = Object.fromEntries(TERMINAL_COLOR_KEYS.map((key) => [key, '#ffffff']))
terminal.background = '#000000'
terminal.selectionBackground = '#000000'
const variant = { chrome, terminal }
const fixture = {
  format: 'shepherd-theme',
  version: 1,
  name: 'Test theme',
  dark: variant,
  light: variant
}
const parsed = validateCustomTheme(fixture)
assert(
  parsed.name === 'Test theme' && parsed.dark.chrome.canvas === '#000000',
  'accepts exact versioned theme'
)
assert(
  parseCustomTheme(JSON.stringify(fixture)).light.terminal.foreground === '#ffffff',
  'parses exported JSON'
)
assert(contrastRatio('#000000', '#ffffff') === 21, 'calculates WCAG contrast')
rejects({ ...fixture, version: 2 }, 'rejects unsupported version')
rejects({ ...fixture, name: '\u001b[31m' }, 'rejects control characters in names')
rejects(
  { ...fixture, dark: { ...variant, chrome: { ...chrome, canvas: 'red' } } },
  'rejects non-hex CSS values'
)
rejects(
  { ...fixture, dark: { ...variant, chrome: { ...chrome, extra: '#ffffff' } } },
  'rejects extra CSS keys'
)
rejects(
  { ...fixture, dark: { ...variant, chrome: { ...chrome, canvas: '#eeeeee' } } },
  'requires matching terminal background'
)
rejects(
  { ...fixture, dark: { ...variant, chrome: { ...chrome, text: '#111111' } } },
  'rejects unreadable primary text'
)
rejects(
  { ...fixture, dark: { ...variant, chrome: { ...chrome, selection: '#ffffff' } } },
  'rejects unreadable selection'
)
rejects(
  { ...fixture, dark: { ...variant, chrome: { ...chrome, focus: '#000000' } } },
  'rejects invisible keyboard focus'
)
try {
  parseCustomTheme('{bad')
  assert(false, 'rejects invalid JSON')
} catch {
  assert(true, 'rejects invalid JSON')
}
try {
  parseCustomTheme(' '.repeat(33_000))
  assert(false, 'rejects oversized theme')
} catch {
  assert(true, 'rejects oversized theme')
}
if (failures) process.exitCode = 1
