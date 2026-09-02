import {
  DEFAULT_FONT_SIZE,
  DEFAULT_RENDERER_PREFERENCES,
  RENDERER_PREFERENCES_KEY,
  RENDERER_PREFERENCES_VERSION,
  bumpFontSize,
  getFontSize,
  getRendererPreferences,
  resetFontSize,
  setAppearanceMode,
  setFontSize,
  updateRendererPreferences
} from './settings'
import { RENDERER_EVENT } from './events'

const store = new Map<string, string>()
let lastDetail: unknown = null
let lastType = ''
const g = globalThis as unknown as {
  localStorage: { getItem(k: string): string | null; setItem(k: string, v: string): void }
  CustomEvent: new (type: string, init?: { detail?: unknown }) => { type: string; detail: unknown }
  window: { dispatchEvent(e: { type?: string; detail?: unknown }): boolean }
}
g.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, value)
}
g.CustomEvent = class {
  type: string
  detail: unknown
  constructor(type: string, init?: { detail?: unknown }) {
    this.type = type
    this.detail = init?.detail
  }
}
g.window = {
  dispatchEvent: (event) => {
    lastType = event.type ?? ''
    lastDetail = event.detail
    return true
  }
}

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

store.clear()
assert(
  JSON.stringify(getRendererPreferences()) === JSON.stringify(DEFAULT_RENDERER_PREFERENCES),
  'unset preferences migrate to versioned defaults'
)
assert(
  JSON.parse(store.get(RENDERER_PREFERENCES_KEY) ?? '{}').version ===
    RENDERER_PREFERENCES_VERSION,
  'persists the current schema version'
)

store.clear()
store.set('cmux.fontSize', '17.8')
assert(getFontSize() === 18, 'migrates and rounds the legacy cmux font size')
assert(
  JSON.parse(store.get(RENDERER_PREFERENCES_KEY) ?? '{}').terminalFontSize === 18,
  'stores migrated font size inside the preference object'
)

store.clear()
store.set('shepherd.fontSize', '19')
assert(getFontSize() === 19, 'migrates the previous Shepherd font key')

store.clear()
store.set(RENDERER_PREFERENCES_KEY, '{broken')
assert(getFontSize() === DEFAULT_FONT_SIZE, 'corrupt JSON falls back safely')

store.clear()
store.set(
  RENDERER_PREFERENCES_KEY,
  JSON.stringify({
    version: RENDERER_PREFERENCES_VERSION,
    terminalFontSize: 14,
    appearanceMode: 'sepia',
    terminalPaletteId: 'graphite'
  })
)
assert(
  getRendererPreferences().appearanceMode === 'system',
  'invalid appearance mode resets to safe defaults'
)

store.clear()
assert(setFontSize(16) === 16 && getFontSize() === 16, 'font setter persists in schema')
assert(lastType === RENDERER_EVENT.fontSize && lastDetail === 16, 'font setter broadcasts detail')
assert(setFontSize(999) === 28, 'clamps above the terminal range')
assert(setFontSize(1) === 8, 'clamps below the terminal range')
assert(setFontSize(13.6) === 14, 'rounds fractional font input')
assert(bumpFontSize(2) === 16, 'font bump is relative to current value')
assert(resetFontSize() === DEFAULT_FONT_SIZE, 'font reset restores the default')
assert(
  updateRendererPreferences({ terminalFontSize: Number.NaN }).terminalFontSize === DEFAULT_FONT_SIZE,
  'non-finite font updates preserve the current valid size'
)

const appearance = setAppearanceMode('light')
assert(appearance.appearanceMode === 'light', 'appearance setter persists a valid mode')
assert(
  appearance.terminalFontSize === DEFAULT_FONT_SIZE && appearance.terminalPaletteId === 'graphite',
  'appearance update preserves unrelated preferences'
)
assert(lastType === RENDERER_EVENT.preferences, 'preference update broadcasts the full schema')

const invalid = updateRendererPreferences({ appearanceMode: 'invalid' as 'system' })
assert(invalid.appearanceMode === 'light', 'invalid patch does not replace a valid mode')

console.log(failures === 0 ? '\n✅ ALL SETTINGS TESTS PASS' : `\n❌ ${failures} FAILURE(S)`)
if (failures > 0) throw new Error(`${failures} settings test(s) failed`)
