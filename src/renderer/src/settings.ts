import { APPEARANCE_MODES, isAppearanceMode, type AppearanceMode } from '../../shared/appearance'
import { RENDERER_EVENT } from './events'
import { isThemePresetId, type ThemePresetId } from './themePresets'
import { getCustomTheme } from './customTheme'

export const RENDERER_PREFERENCES_VERSION = 4 as const
export const RENDERER_PREFERENCES_KEY = 'shepherd.preferences'
const LEGACY_FONT_KEY = 'shepherd.fontSize'
const LEGACY_CMUX_FONT_KEY = 'cmux.fontSize'

export interface RendererPreferences {
  version: typeof RENDERER_PREFERENCES_VERSION
  terminalFontSize: number
  appearanceMode: AppearanceMode
  themePresetId: ThemePresetId
}

export const DEFAULT_FONT_SIZE = 13
const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 28

export const DEFAULT_RENDERER_PREFERENCES: Readonly<RendererPreferences> = Object.freeze({
  version: RENDERER_PREFERENCES_VERSION,
  terminalFontSize: DEFAULT_FONT_SIZE,
  appearanceMode: 'system',
  themePresetId: 'system'
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

function normalizePreferences(value: unknown): RendererPreferences | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (![1, 2, 3, 4].includes(candidate.version as number)) return null
  if (!isAppearanceMode(candidate.appearanceMode)) return null
  if (candidate.version === 1 && candidate.terminalPaletteId !== 'graphite') return null
  if (candidate.version === 2 && candidate.terminalPaletteId !== 'system') return null
  const themePresetId =
    candidate.version === 3 || candidate.version === 4 ? candidate.themePresetId : 'system'
  if (!isThemePresetId(themePresetId)) return null
  return {
    version: RENDERER_PREFERENCES_VERSION,
    terminalFontSize: normalizedFontSize(candidate.terminalFontSize),
    appearanceMode: candidate.appearanceMode,
    themePresetId: themePresetId === 'custom' && !getCustomTheme() ? 'system' : themePresetId
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
      const parsed = JSON.parse(stored) as unknown
      const normalized = normalizePreferences(parsed)
      if (normalized) {
        if (
          (parsed as { version?: unknown }).version !== RENDERER_PREFERENCES_VERSION ||
          (parsed as { themePresetId?: unknown }).themePresetId !== normalized.themePresetId
        ) {
          persistPreferences(normalized)
        }
        return normalized
      }
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
    themePresetId:
      isThemePresetId(patch.themePresetId) && (patch.themePresetId !== 'custom' || getCustomTheme())
        ? patch.themePresetId
        : current.themePresetId
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
