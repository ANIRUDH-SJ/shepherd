export const THEME_PRESETS = [
  { id: 'system', label: 'Shepherd', description: 'Original high-contrast palette' },
  { id: 'tokyo-night', label: 'Tokyo Night', description: 'Cool blues and violet' },
  { id: 'catppuccin', label: 'Catppuccin', description: 'Soft pastel contrast' },
  { id: 'gruvbox', label: 'Gruvbox', description: 'Warm retro colors' },
  { id: 'solarized', label: 'Solarized', description: 'Balanced teal and gold' },
  { id: 'rose-pine', label: 'Rosé Pine', description: 'Muted rose and iris' }
] as const

export type ThemePresetId = (typeof THEME_PRESETS)[number]['id']

export function isThemePresetId(value: unknown): value is ThemePresetId {
  return typeof value === 'string' && THEME_PRESETS.some((preset) => preset.id === value)
}
