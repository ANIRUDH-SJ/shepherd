import type { AppearanceMode, AppearanceSnapshot } from '../../shared/appearance'
import { RENDERER_EVENT } from './events'
import { getRendererPreferences, setAppearanceMode, updateRendererPreferences } from './settings'
import type { ThemePresetId } from './themePresets'
import { applyCustomChrome, saveCustomTheme } from './customTheme'
import type { CustomTheme } from '../../shared/customTheme'

let initialized = false

export function applyAppearanceSnapshot(snapshot: AppearanceSnapshot): void {
  const root = document.documentElement
  root.dataset.theme = snapshot.resolved
  applyCustomChrome(snapshot.resolved, getRendererPreferences().themePresetId)
  root.toggleAttribute('data-high-contrast', snapshot.highContrast)
  root.toggleAttribute('data-inverted-colors', snapshot.inverted)
  root.style.colorScheme = snapshot.resolved
  window.dispatchEvent(new CustomEvent(RENDERER_EVENT.appearance, { detail: snapshot }))
}

function optimisticSnapshot(mode: AppearanceMode, system: AppearanceSnapshot): AppearanceSnapshot {
  if (mode === 'system') return { ...system, mode }
  return { ...system, mode, resolved: mode }
}

export function initializeAppearance(): void {
  if (initialized) return
  initialized = true
  const preferences = getRendererPreferences()
  document.documentElement.dataset.themePreset = preferences.themePresetId
  const system = window.api.appearance.getSync()
  applyAppearanceSnapshot(optimisticSnapshot(preferences.appearanceMode, system))
  window.api.appearance.onChanged(applyAppearanceSnapshot)
  void window.api.appearance
    .setMode(preferences.appearanceMode)
    .then(applyAppearanceSnapshot)
    .catch(() => applyAppearanceSnapshot(optimisticSnapshot(preferences.appearanceMode, system)))
}

export function setApplicationThemePreset(preset: ThemePresetId): void {
  const preferences = updateRendererPreferences({ themePresetId: preset })
  document.documentElement.dataset.themePreset = preferences.themePresetId
  applyCustomChrome(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark', preset)
}

export function setApplicationCustomTheme(value: CustomTheme): void {
  const wasCustom = getRendererPreferences().themePresetId === 'custom'
  saveCustomTheme(value)
  setApplicationThemePreset('custom')
  if (wasCustom) window.dispatchEvent(new Event(RENDERER_EVENT.themeFile))
}

export async function setApplicationAppearance(mode: AppearanceMode): Promise<AppearanceSnapshot> {
  setAppearanceMode(mode)
  const current = window.api.appearance.getSync()
  applyAppearanceSnapshot(optimisticSnapshot(mode, current))
  const resolved = await window.api.appearance.setMode(mode)
  applyAppearanceSnapshot(resolved)
  return resolved
}
