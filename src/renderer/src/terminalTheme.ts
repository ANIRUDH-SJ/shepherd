import type { ITheme } from '@xterm/xterm'
import type { ResolvedAppearance } from '../../shared/appearance'

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
  background: '#1e1e1e',
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

export function terminalThemeForAppearance(appearance: ResolvedAppearance): Readonly<ITheme> {
  return appearance === 'light' ? LIGHT_TERMINAL_THEME : DARK_TERMINAL_THEME
}
