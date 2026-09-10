import type { AppearanceMode, AppearanceSnapshot } from '../../shared/appearance'
import { RENDERER_EVENT } from './events'
import { getRendererPreferences, setAppearanceMode } from './settings'

let initialized = false

export function applyAppearanceSnapshot(snapshot: AppearanceSnapshot): void {
  const root = document.documentElement
  root.dataset.theme = snapshot.resolved
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
  const system = window.api.appearance.getSync()
  applyAppearanceSnapshot(optimisticSnapshot(preferences.appearanceMode, system))
  window.api.appearance.onChanged(applyAppearanceSnapshot)
  void window.api.appearance
    .setMode(preferences.appearanceMode)
    .then(applyAppearanceSnapshot)
    .catch(() => applyAppearanceSnapshot(optimisticSnapshot(preferences.appearanceMode, system)))
}

export async function setApplicationAppearance(mode: AppearanceMode): Promise<AppearanceSnapshot> {
  setAppearanceMode(mode)
  const current = window.api.appearance.getSync()
  applyAppearanceSnapshot(optimisticSnapshot(mode, current))
  const resolved = await window.api.appearance.setMode(mode)
  applyAppearanceSnapshot(resolved)
  return resolved
}
