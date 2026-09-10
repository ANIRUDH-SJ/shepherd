export const APPEARANCE_MODES = ['system', 'light', 'dark'] as const
export type AppearanceMode = (typeof APPEARANCE_MODES)[number]

export type ResolvedAppearance = 'light' | 'dark'

export const APP_BACKGROUND_COLOR: Readonly<Record<ResolvedAppearance, string>> = Object.freeze({
  light: '#feffff',
  dark: '#1e1e1e'
})

export interface AppearanceSnapshot {
  mode: AppearanceMode
  resolved: ResolvedAppearance
  highContrast: boolean
  inverted: boolean
}

export function isAppearanceMode(value: unknown): value is AppearanceMode {
  return typeof value === 'string' && APPEARANCE_MODES.includes(value as AppearanceMode)
}

export function resolvedAppearance(dark: boolean): ResolvedAppearance {
  return dark ? 'dark' : 'light'
}
