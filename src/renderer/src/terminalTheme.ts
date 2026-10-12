import type { ITheme } from '@xterm/xterm'
import type { ResolvedAppearance } from '../../shared/appearance'
import type { ThemePresetId } from './themePresets'

const SHARED_ANSI_COLORS = {
  black: '#1a1a1a',
  red: '#cc372e',
  green: '#26a439',
  yellow: '#cdac08',
  blue: '#0869cb',
  magenta: '#9647bf',
  cyan: '#479ec2',
  white: '#98989d',
  brightBlack: '#464646',
  brightRed: '#ff453a',
  brightGreen: '#32d74b',
  brightBlue: '#0a84ff',
  brightMagenta: '#bf5af2',
  brightWhite: '#ffffff'
} as const

/** cmux-aligned terminal colors remain an xterm contract, separate from CSS tokens. */
export const DARK_TERMINAL_THEME: Readonly<ITheme> = Object.freeze({
  ...SHARED_ANSI_COLORS,
  background: '#000000',
  foreground: '#ffffff',
  cursor: '#98989d',
  cursorAccent: '#ffffff',
  selectionBackground: '#3f638b',
  selectionForeground: '#ffffff',
  brightYellow: '#ffd60a',
  brightCyan: '#76d6ff'
})

export const LIGHT_TERMINAL_THEME: Readonly<ITheme> = Object.freeze({
  ...SHARED_ANSI_COLORS,
  background: '#feffff',
  foreground: '#000000',
  cursor: '#98989d',
  cursorAccent: '#ffffff',
  selectionBackground: '#abd8ff',
  selectionForeground: '#000000',
  brightYellow: '#e5bc00',
  brightCyan: '#69c9f2'
})

const TOKYO_NIGHT_DARK: Readonly<ITheme> = Object.freeze({
  background: '#1a1b26',
  foreground: '#c0caf5',
  cursor: '#c0caf5',
  cursorAccent: '#1a1b26',
  selectionBackground: '#364a82',
  selectionForeground: '#c0caf5',
  black: '#15161e',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#a9b1d6',
  brightBlack: '#414868',
  brightRed: '#f7768e',
  brightGreen: '#9ece6a',
  brightYellow: '#e0af68',
  brightBlue: '#7aa2f7',
  brightMagenta: '#bb9af7',
  brightCyan: '#7dcfff',
  brightWhite: '#c0caf5'
})

const TOKYO_NIGHT_LIGHT: Readonly<ITheme> = Object.freeze({
  background: '#e1e2e7',
  foreground: '#3760bf',
  cursor: '#3760bf',
  cursorAccent: '#e1e2e7',
  selectionBackground: '#b7c6e8',
  selectionForeground: '#1a1b26',
  black: '#1b1d2b',
  red: '#f52a65',
  green: '#587539',
  yellow: '#8c6c3e',
  blue: '#2e7de9',
  magenta: '#9854f1',
  cyan: '#007197',
  white: '#6172b0',
  brightBlack: '#a1a6c5',
  brightRed: '#f52a65',
  brightGreen: '#587539',
  brightYellow: '#8c6c3e',
  brightBlue: '#2e7de9',
  brightMagenta: '#9854f1',
  brightCyan: '#007197',
  brightWhite: '#3760bf'
})

const CATPPUCCIN_DARK: Readonly<ITheme> = Object.freeze({
  background: '#1e1e2e',
  foreground: '#cdd6f4',
  cursor: '#f5e0dc',
  cursorAccent: '#1e1e2e',
  selectionBackground: '#45475a',
  selectionForeground: '#cdd6f4',
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#cba6f7',
  cyan: '#94e2d5',
  white: '#bac2de',
  brightBlack: '#585b70',
  brightRed: '#f38ba8',
  brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af',
  brightBlue: '#89b4fa',
  brightMagenta: '#cba6f7',
  brightCyan: '#94e2d5',
  brightWhite: '#cdd6f4'
})

const CATPPUCCIN_LIGHT: Readonly<ITheme> = Object.freeze({
  background: '#eff1f5',
  foreground: '#4c4f69',
  cursor: '#dc8a78',
  cursorAccent: '#eff1f5',
  selectionBackground: '#ccd0da',
  selectionForeground: '#4c4f69',
  black: '#5c5f77',
  red: '#d20f39',
  green: '#40a02b',
  yellow: '#df8e1d',
  blue: '#1e66f5',
  magenta: '#8839ef',
  cyan: '#179299',
  white: '#acb0be',
  brightBlack: '#6c6f85',
  brightRed: '#d20f39',
  brightGreen: '#40a02b',
  brightYellow: '#df8e1d',
  brightBlue: '#1e66f5',
  brightMagenta: '#8839ef',
  brightCyan: '#179299',
  brightWhite: '#4c4f69'
})

export function terminalThemeForAppearance(
  appearance: ResolvedAppearance,
  preset: ThemePresetId = 'system'
): Readonly<ITheme> {
  if (preset === 'tokyo-night') return appearance === 'light' ? TOKYO_NIGHT_LIGHT : TOKYO_NIGHT_DARK
  if (preset === 'catppuccin') return appearance === 'light' ? CATPPUCCIN_LIGHT : CATPPUCCIN_DARK
  return appearance === 'light' ? LIGHT_TERMINAL_THEME : DARK_TERMINAL_THEME
}
