import {
  CHROME_COLOR_KEYS,
  TERMINAL_COLOR_KEYS,
  CUSTOM_THEME_FORMAT,
  CUSTOM_THEME_VERSION,
  validateCustomTheme,
  type CustomTheme
} from '../../shared/customTheme'
import { getCustomTheme } from './customTheme'
import { terminalThemeForAppearance } from './terminalTheme'
import { THEME_PRESETS, type ThemePresetId } from './themePresets'

function restoreAttribute(root: HTMLElement, name: string, value: string | null): void {
  if (value === null) root.removeAttribute(name)
  else root.setAttribute(name, value)
}

/** Sample only registered tokens; temporary attribute changes are restored before paint. */
export function captureThemeForExport(preset: ThemePresetId): CustomTheme {
  if (preset === 'custom') {
    const saved = getCustomTheme()
    if (!saved) throw new Error('No imported theme is available')
    return saved
  }
  const root = document.documentElement
  const previousTheme = root.getAttribute('data-theme')
  const previousPreset = root.getAttribute('data-theme-preset')
  const previousContrast = root.getAttribute('data-high-contrast')
  const variants: Partial<Pick<CustomTheme, 'dark' | 'light'>> = {}
  try {
    root.removeAttribute('data-high-contrast')
    root.dataset.themePreset = preset
    for (const appearance of ['dark', 'light'] as const) {
      root.dataset.theme = appearance
      const style = getComputedStyle(root)
      const chrome = Object.fromEntries(
        CHROME_COLOR_KEYS.map((key) => [key, style.getPropertyValue(`--color-${key}`).trim()])
      )
      const palette = terminalThemeForAppearance(appearance, preset) as Record<string, unknown>
      const terminal = Object.fromEntries(TERMINAL_COLOR_KEYS.map((key) => [key, palette[key]]))
      variants[appearance] = { chrome, terminal } as CustomTheme['dark']
    }
  } finally {
    restoreAttribute(root, 'data-theme', previousTheme)
    restoreAttribute(root, 'data-theme-preset', previousPreset)
    restoreAttribute(root, 'data-high-contrast', previousContrast)
  }
  return validateCustomTheme({
    format: CUSTOM_THEME_FORMAT,
    version: CUSTOM_THEME_VERSION,
    name: THEME_PRESETS.find((entry) => entry.id === preset)?.label ?? 'Shepherd',
    dark: variants.dark,
    light: variants.light
  })
}
