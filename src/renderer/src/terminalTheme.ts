import type { ITheme } from '@xterm/xterm'

/** Terminal colors are an xterm contract, independent from Shepherd's chrome tokens. */
export const TERMINAL_THEME: Readonly<ITheme> = Object.freeze({
  background: '#0d0e0c',
  foreground: '#e8e8e0',
  cursor: '#d7d7cf',
  selectionBackground: '#3a3b34'
})
