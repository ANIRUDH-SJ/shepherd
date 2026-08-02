import type { ITheme } from '@xterm/xterm'

/** Terminal colors are an xterm contract, independent from Shepherd's chrome tokens. */
export const TERMINAL_THEME: Readonly<ITheme> = Object.freeze({
  background: '#0d0d0d',
  foreground: '#e6e6e6',
  cursor: '#8ab4ff',
  selectionBackground: '#294366'
})
