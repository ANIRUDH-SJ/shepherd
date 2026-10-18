import {
  CHROME_COLOR_KEYS,
  parseCustomTheme,
  validateCustomTheme,
  type CustomTheme
} from '../../shared/customTheme'
import type { ResolvedAppearance } from '../../shared/appearance'
import type { ThemePresetId } from './themePresets'

export const CUSTOM_THEME_KEY = 'shepherd.customTheme'

export function getCustomTheme(): CustomTheme | null {
  try {
    const stored = localStorage.getItem(CUSTOM_THEME_KEY)
    return stored ? parseCustomTheme(stored) : null
  } catch {
    return null
  }
}

export function saveCustomTheme(value: unknown): CustomTheme {
  const theme = validateCustomTheme(value)
  localStorage.setItem(CUSTOM_THEME_KEY, JSON.stringify(theme))
  return theme
}

/** The CSS token mapping keeps high-contrast rules above imported values. */
export function applyCustomChrome(appearance: ResolvedAppearance, preset: ThemePresetId): void {
  const theme = preset === 'custom' ? getCustomTheme() : null
  const root = document.documentElement
  for (const key of CHROME_COLOR_KEYS) {
    const property = `--custom-color-${key}`
    if (theme) root.style.setProperty(property, theme[appearance].chrome[key])
    else root.style.removeProperty(property)
  }
}
