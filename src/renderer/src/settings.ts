// ─────────────────────────────────────────────────────────────────────────────
// RENDERER SETTINGS  (persisted in localStorage)
// Currently: terminal font size. Changing it broadcasts a `cmux:fontsize` event so
// every live TerminalHost updates without a reload.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = 'cmux.fontSize'
export const DEFAULT_FONT_SIZE = 13
const MIN = 8
const MAX = 28

export function getFontSize(): number {
  // Round on read too: a fractional persisted value shouldn't yield a
  // non-integer font size (setFontSize already rounds before storing).
  const v = Math.round(Number(localStorage.getItem(KEY)))
  return Number.isFinite(v) && v >= MIN && v <= MAX ? v : DEFAULT_FONT_SIZE
}

/** Set the font size (clamped + persisted) and broadcast so live terminals update. */
export function setFontSize(size: number): number {
  const clamped = Math.min(MAX, Math.max(MIN, Math.round(size)))
  localStorage.setItem(KEY, String(clamped))
  window.dispatchEvent(new CustomEvent('cmux:fontsize', { detail: clamped }))
  return clamped
}

export function bumpFontSize(delta: number): number {
  return setFontSize(getFontSize() + delta)
}

export function resetFontSize(): number {
  return setFontSize(DEFAULT_FONT_SIZE)
}
