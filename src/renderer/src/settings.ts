import { APPEARANCE_MODES, isAppearanceMode, type AppearanceMode } from '../../shared/appearance'
import { RENDERER_EVENT } from './events'

export const RENDERER_PREFERENCES_VERSION = 1 as const
export const RENDERER_PREFERENCES_KEY = 'shepherd.preferences'
const LEGACY_FONT_KEY = 'shepherd.fontSize'
const LEGACY_CMUX_FONT_KEY = 'cmux.fontSize'

export const TERMINAL_PALETTE_IDS = ['graphite'] as const
export type TerminalPaletteId = (typeof TERMINAL_PALETTE_IDS)[number]

export interface RendererPreferences {
  version: typeof RENDERER_PREFERENCES_VERSION
  terminalFontSize: number
  appearanceMode: AppearanceMode
  terminalPaletteId: TerminalPaletteId
}

export const DEFAULT_FONT_SIZE = 13
const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 28

export const DEFAULT_RENDERER_PREFERENCES: Readonly<RendererPreferences> = Object.freeze({
  version: RENDERER_PREFERENCES_VERSION,
  terminalFontSize: DEFAULT_FONT_SIZE,
  appearanceMode: 'system',
  terminalPaletteId: 'graphite'
})

function normalizedFontSize(value: unknown): number {
  const parsed = Math.round(Number(value))
  return Number.isFinite(parsed) && parsed >= MIN_FONT_SIZE && parsed <= MAX_FONT_SIZE
    ? parsed
    : DEFAULT_FONT_SIZE
}

function clampedFontSize(value: number, fallback: number): number {
  const rounded = Math.round(value)
  return Number.isFinite(rounded)
    ? Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, rounded))
    : fallback
}

function isTerminalPaletteId(value: unknown): value is TerminalPaletteId {
  return (
    typeof value === 'string' && TERMINAL_PALETTE_IDS.includes(value as TerminalPaletteId)
  )
}

function normalizePreferences(value: unknown): RendererPreferences | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<RendererPreferences>
  if (candidate.version !== RENDERER_PREFERENCES_VERSION) return null
  if (!isAppearanceMode(candidate.appearanceMode)) return null
  if (!isTerminalPaletteId(candidate.terminalPaletteId)) return null
  return {
    version: RENDERER_PREFERENCES_VERSION,
    terminalFontSize: normalizedFontSize(candidate.terminalFontSize),
    appearanceMode: candidate.appearanceMode,
    terminalPaletteId: candidate.terminalPaletteId
  }
}

function persistPreferences(preferences: RendererPreferences): void {
  localStorage.setItem(RENDERER_PREFERENCES_KEY, JSON.stringify(preferences))
}

function migratedPreferences(): RendererPreferences {
  const legacy = localStorage.getItem(LEGACY_FONT_KEY) ?? localStorage.getItem(LEGACY_CMUX_FONT_KEY)
  const preferences = {
    ...DEFAULT_RENDERER_PREFERENCES,
    terminalFontSize: legacy === null ? DEFAULT_FONT_SIZE : normalizedFontSize(legacy)
  }
  persistPreferences(preferences)
  return preferences
}

export function getRendererPreferences(): RendererPreferences {
  const stored = localStorage.getItem(RENDERER_PREFERENCES_KEY)
  if (stored !== null) {
    try {
      const normalized = normalizePreferences(JSON.parse(stored))
      if (normalized) return normalized
    } catch {
      // A corrupt preference blob is replaced with safe defaults below.
    }
  }
  return migratedPreferences()
}

export function updateRendererPreferences(
  patch: Partial<Omit<RendererPreferences, 'version'>>
): RendererPreferences {
  const current = getRendererPreferences()
  const next: RendererPreferences = {
    version: RENDERER_PREFERENCES_VERSION,
    terminalFontSize:
      patch.terminalFontSize === undefined
        ? current.terminalFontSize
        : clampedFontSize(patch.terminalFontSize, current.terminalFontSize),
    appearanceMode: isAppearanceMode(patch.appearanceMode)
      ? patch.appearanceMode
      : current.appearanceMode,
    terminalPaletteId: isTerminalPaletteId(patch.terminalPaletteId)
      ? patch.terminalPaletteId
      : current.terminalPaletteId
  }
  persistPreferences(next)
  window.dispatchEvent(new CustomEvent(RENDERER_EVENT.preferences, { detail: next }))
  return next
}

export function getFontSize(): number {
  return getRendererPreferences().terminalFontSize
}

export function setFontSize(size: number): number {
  const next = updateRendererPreferences({ terminalFontSize: size })
  window.dispatchEvent(new CustomEvent(RENDERER_EVENT.fontSize, { detail: next.terminalFontSize }))
  return next.terminalFontSize
}

export function bumpFontSize(delta: number): number {
  return setFontSize(getFontSize() + delta)
}

export function resetFontSize(): number {
  return setFontSize(DEFAULT_FONT_SIZE)
}

export function setAppearanceMode(mode: AppearanceMode): RendererPreferences {
  return updateRendererPreferences({ appearanceMode: mode })
}

export { APPEARANCE_MODES }
