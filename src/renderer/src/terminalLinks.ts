import {
  MAX_TERMINAL_LINK_CANDIDATES,
  MAX_TERMINAL_LINK_POSITION,
  MAX_TERMINAL_LINK_TEXT_LENGTH,
  type TerminalFileReference
} from '../../shared/terminalLinks'

export { MAX_TERMINAL_LINK_CANDIDATES }

export interface TerminalFileLinkCandidate extends TerminalFileReference {
  text: string
  path: string
  startIndex: number
  endIndex: number
  line?: number
  column?: number
}

const TOKEN_PATTERN = /[^\s"'`<>{}\[\]()]+/gu
const TRAILING_PUNCTUATION = /[.,;!?]+$/u
const LOCATION_SUFFIX = /:(\d+)(?::(\d+))?$/u
const BARE_FILE = /^(?:\.[A-Za-z0-9][A-Za-z0-9._-]*|[A-Za-z0-9_@+-][A-Za-z0-9_@+.-]*\.[A-Za-z0-9]{1,16})$/u

function isFilePath(value: string): boolean {
  if (!value || value === '.' || value === '..' || value === '~') return false
  if (value.startsWith('//')) return false
  if (value.startsWith('/') || value.startsWith('~/')) return true
  if (value.startsWith('./') || value.startsWith('../')) return value.length > 2
  if (value.includes('/')) {
    return !value.startsWith(':') && !value.endsWith('/') && !value.includes('//')
  }
  return BARE_FILE.test(value)
}

function parsePosition(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_TERMINAL_LINK_POSITION) {
    return null
  }
  return parsed
}

/**
 * Find syntactic local-file references in one rendered terminal line.
 *
 * The main process still resolves every candidate against the terminal's live
 * cwd and requires the target to exist before it is displayed or opened.
 */
export function findTerminalFileLinks(lineText: string): TerminalFileLinkCandidate[] {
  const links: TerminalFileLinkCandidate[] = []

  for (const match of lineText.matchAll(TOKEN_PATTERN)) {
    if (links.length >= MAX_TERMINAL_LINK_CANDIDATES) break
    const raw = match[0]
    const rawStart = match.index
    if (rawStart === undefined || raw.length > MAX_TERMINAL_LINK_TEXT_LENGTH) continue

    const text = raw.replace(TRAILING_PUNCTUATION, '')
    if (!text || /^https?:\/\//iu.test(text)) continue

    const location = LOCATION_SUFFIX.exec(text)
    const path = location ? text.slice(0, location.index) : text
    if (!isFilePath(path)) continue

    const parsedLine = parsePosition(location?.[1])
    const parsedColumn = parsePosition(location?.[2])
    if (parsedLine === null || parsedColumn === null) continue

    links.push({
      text,
      path,
      startIndex: rawStart,
      endIndex: rawStart + text.length,
      ...(parsedLine === undefined ? {} : { line: parsedLine }),
      ...(parsedColumn === undefined ? {} : { column: parsedColumn })
    })
  }

  return links
}

export function terminalLinkModifierPressed(event: Pick<MouseEvent, 'ctrlKey' | 'metaKey'>): boolean {
  return event.ctrlKey || event.metaKey
}
