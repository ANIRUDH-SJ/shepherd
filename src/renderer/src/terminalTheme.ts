import type { ITheme } from '@xterm/xterm'

/** Terminal colors are an xterm contract, independent from Shepherd's chrome tokens. */
export const TERMINAL_THEME: Readonly<ITheme> = Object.freeze({
  background: '#272823',
  foreground: '#bdbfb4',
  cursor: '#dededd',
  cursorAccent: '#272823',
  selectionBackground: '#52534f99',
  black: '#1d1f21',
  red: '#cc6566',
  green: '#b6bd68',
  yellow: '#f0c674',
  blue: '#82a2be',
  magenta: '#b294bb',
  cyan: '#8abeb7',
  white: '#c4c8c6',
  brightBlack: '#666666',
  brightRed: '#d54e53',
  brightGreen: '#b9ca4b',
  brightYellow: '#e7c547',
  brightBlue: '#7aa6da',
  brightMagenta: '#c397d8',
  brightCyan: '#70c0b1',
  brightWhite: '#eaeaea'
})
