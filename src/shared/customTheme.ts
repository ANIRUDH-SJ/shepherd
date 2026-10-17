export const CUSTOM_THEME_FORMAT = 'shepherd-theme' as const
export const CUSTOM_THEME_VERSION = 1 as const
export const MAX_THEME_FILE_BYTES = 32 * 1024

export const CHROME_COLOR_KEYS = [
  'canvas',
  'sidebar',
  'surface',
  'surface-hover',
  'surface-raised',
  'border',
  'border-strong',
  'text',
  'text-secondary',
  'text-muted',
  'text-subdued',
  'text-faint',
  'accent',
  'accent-strong',
  'selection',
  'selection-hover',
  'selection-text',
  'focus',
  'attention',
  'danger',
  'success',
  'info',
  'working',
  'git'
] as const

export const TERMINAL_COLOR_KEYS = [
  'background',
  'foreground',
  'cursor',
  'cursorAccent',
  'selectionBackground',
  'selectionForeground',
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite'
] as const

export type ChromeColorKey = (typeof CHROME_COLOR_KEYS)[number]
export type TerminalColorKey = (typeof TERMINAL_COLOR_KEYS)[number]

export interface CustomThemeVariant {
  chrome: Record<ChromeColorKey, string>
  terminal: Record<TerminalColorKey, string>
}

export interface CustomTheme {
  format: typeof CUSTOM_THEME_FORMAT
  version: typeof CUSTOM_THEME_VERSION
  name: string
  dark: CustomThemeVariant
  light: CustomThemeVariant
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Theme must be a JSON object')
  return value as Record<string, unknown>
}

function colors<K extends string>(
  value: unknown,
  keys: readonly K[],
  label: string
): Record<K, string> {
  const source = record(value)
  if (
    Object.keys(source).length !== keys.length ||
    Object.keys(source).some((key) => !keys.includes(key as K))
  )
    throw new Error(`${label} must contain exactly the supported color keys`)
  return Object.fromEntries(
    keys.map((key) => {
      const color = source[key]
      if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))
        throw new Error(`${label}.${key} must be a six-digit hex color`)
      return [key, color.toLowerCase()]
    })
  ) as Record<K, string>
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

export function contrastRatio(first: string, second: string): number {
  const a = luminance(first)
  const b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function variant(value: unknown, label: string): CustomThemeVariant {
  const source = record(value)
  if (Object.keys(source).sort().join(',') !== 'chrome,terminal')
    throw new Error(`${label} must contain chrome and terminal palettes`)
  const chrome = colors(source.chrome, CHROME_COLOR_KEYS, `${label}.chrome`)
  const terminal = colors(source.terminal, TERMINAL_COLOR_KEYS, `${label}.terminal`)
  if (chrome.canvas !== terminal.background)
    throw new Error(`${label} application and terminal backgrounds must match`)
  for (const [background, foreground] of [
    [chrome.canvas, chrome.text],
    [chrome.surface, chrome['text-secondary']],
    [chrome.sidebar, chrome['text-muted']],
    [chrome.selection, chrome['selection-text']],
    [chrome['selection-hover'], chrome['selection-text']],
    [terminal.background, terminal.foreground],
    [terminal.selectionBackground, terminal.selectionForeground]
  ]) {
    if (contrastRatio(background, foreground) < 4.5)
      throw new Error(`${label} text contrast must be at least 4.5:1`)
  }
  if (
    contrastRatio(chrome.canvas, chrome.accent) < 3 ||
    contrastRatio(chrome.canvas, chrome.focus) < 3
  )
    throw new Error(`${label} accent and focus contrast must be at least 3:1`)
  return { chrome, terminal }
}

/** Parse only a finite palette contract; never accept CSS, URLs, or executable content. */
export function validateCustomTheme(value: unknown): CustomTheme {
  const source = record(value)
  if (
    Object.keys(source).sort().join(',') !== 'dark,format,light,name,version' ||
    source.format !== CUSTOM_THEME_FORMAT ||
    source.version !== CUSTOM_THEME_VERSION
  )
    throw new Error('Unsupported Shepherd theme format or version')
  if (
    typeof source.name !== 'string' ||
    source.name.trim().length < 1 ||
    source.name.trim().length > 64 ||
    [...source.name].some((character) => {
      const code = character.codePointAt(0) ?? 0
      return code < 32 || code === 127
    })
  )
    throw new Error('Theme name must be 1–64 printable characters')
  return {
    format: CUSTOM_THEME_FORMAT,
    version: CUSTOM_THEME_VERSION,
    name: source.name.trim(),
    dark: variant(source.dark, 'Dark theme'),
    light: variant(source.light, 'Light theme')
  }
}

export function parseCustomTheme(contents: string): CustomTheme {
  if (new TextEncoder().encode(contents).length > MAX_THEME_FILE_BYTES)
    throw new Error('Theme file exceeds the 32 KB limit')
  try {
    return validateCustomTheme(JSON.parse(contents))
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error('Theme file is not valid JSON', { cause: error })
    throw error
  }
}
