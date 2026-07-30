// ─────────────────────────────────────────────────────────────────────────────
// RENDERER SETTINGS  (persisted in localStorage)
// Currently: terminal font size. A legacy key is read once and migrated in place.
// ─────────────────────────────────────────────────────────────────────────────

import { RENDERER_EVENT } from './events'

const KEY = 'shepherd.fontSize'
const LEGACY_KEY = 'cmux.fontSize'
export const DEFAULT_FONT_SIZE = 13
const MIN = 8
const MAX = 28

export function getFontSize(): number {
  // Round on read too: a fractional persisted value shouldn't yield a
  // non-integer font size (setFontSize already rounds before storing).
  const current = localStorage.getItem(KEY)
  const legacy = current === null ? localStorage.getItem(LEGACY_KEY) : null
  const value = Math.round(Number(current ?? legacy))
  if (!Number.isFinite(value) || value < MIN || value > MAX) return DEFAULT_FONT_SIZE
  if (current === null && legacy !== null) localStorage.setItem(KEY, String(value))
  return value
}

/** Set the font size (clamped + persisted) and broadcast so live terminals update. */
export function setFontSize(size: number): number {
  const clamped = Math.min(MAX, Math.max(MIN, Math.round(size)))
  localStorage.setItem(KEY, String(clamped))
  window.dispatchEvent(new CustomEvent(RENDERER_EVENT.fontSize, { detail: clamped }))
  return clamped
}

export function bumpFontSize(delta: number): number {
  return setFontSize(getFontSize() + delta)
}

export function resetFontSize(): number {
  return setFontSize(DEFAULT_FONT_SIZE)
}
