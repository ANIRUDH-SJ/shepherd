// Headless tests for the renderer settings store (terminal font size).
// Run via `npm test` (tsx). settings.ts reads `localStorage` and dispatches a
// `cmux:fontsize` window event — neither exists in Node, so we stub them.
// (The static import below is side-effect-free at module load; the stubs are in
// place before any settings function is actually called.)
import { getFontSize, setFontSize, bumpFontSize, resetFontSize, DEFAULT_FONT_SIZE } from './settings'

// ── minimal browser-global stubs ────────────────────────────────────────────
const store = new Map<string, string>()
let lastDetail: number | null = null
const g = globalThis as unknown as {
  localStorage: { getItem(k: string): string | null; setItem(k: string, v: string): void }
  CustomEvent: new (type: string, init?: { detail?: unknown }) => { type: string; detail: unknown }
  window: { dispatchEvent(e: { detail?: unknown }): boolean }
}
g.localStorage = {
  getItem: (k) => (store.has(k) ? (store.get(k) as string) : null),
  setItem: (k, v) => {
    store.set(k, v)
  }
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
  dispatchEvent: (e) => {
    lastDetail = (e.detail as number) ?? null
    return true
  }
}

// ── harness ─────────────────────────────────────────────────────────────────
let failures = 0
const assert = (c: boolean, m: string): void => {
  if (c) console.log('  ok:', m)
  else {
    console.error('FAIL:', m)
    failures++
  }
}

// default when unset
store.clear()
assert(getFontSize() === DEFAULT_FONT_SIZE, 'unset → default')

// set persists, returns the clamped value, and broadcasts the detail
lastDetail = null
assert(setFontSize(16) === 16 && getFontSize() === 16, 'set 16 → persisted')
assert(lastDetail === 16, 'set broadcasts cmux:fontsize detail')

// clamps to the [8, 28] range
assert(setFontSize(999) === 28, 'clamp above MAX → 28')
assert(setFontSize(1) === 8, 'clamp below MIN → 8')

// rounds fractional input before storing
assert(setFontSize(13.6) === 14, 'round fractional input')

// getFontSize normalizes a fractional stored value to an integer (Copilot, PR #10)
store.set('cmux.fontSize', '17.8')
assert(getFontSize() === 18, 'stored fractional → rounded on read')

// out-of-range / garbage stored values fall back to the default
store.set('cmux.fontSize', '500')
assert(getFontSize() === DEFAULT_FONT_SIZE, 'stored out-of-range → default')
store.set('cmux.fontSize', 'nope')
assert(getFontSize() === DEFAULT_FONT_SIZE, 'stored garbage → default')

// bump is relative to the current value
setFontSize(13)
assert(bumpFontSize(2) === 15, 'bump +2 → 15')
assert(bumpFontSize(-3) === 12, 'bump -3 → 12')

// reset returns to the default
assert(resetFontSize() === DEFAULT_FONT_SIZE, 'reset → default')

console.log(failures === 0 ? '\n✅ ALL SETTINGS TESTS PASS' : `\n❌ ${failures} FAILURE(S)`)
if (failures > 0) throw new Error(`${failures} settings test(s) failed`)
