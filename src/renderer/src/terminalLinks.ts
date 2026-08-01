import {
  MAX_TERMINAL_LINK_CANDIDATES,
  MAX_TERMINAL_LINK_POSITION,
  MAX_TERMINAL_LINK_TEXT_LENGTH,
  type TerminalFileReference,
  type TerminalLinkTarget
} from '../../shared/terminalLinks'
import type { IBufferLine, IDisposable, ILink, ILinkProvider, Terminal } from '@xterm/xterm'

export { MAX_TERMINAL_LINK_CANDIDATES }

export interface TerminalFileLinkCandidate extends TerminalFileReference {
  text: string
  path: string
  startIndex: number
  endIndex: number
  line?: number
  column?: number
}

export interface TerminalLineCell {
  startIndex: number
  endIndex: number
  startColumn: number
  endColumn: number
}

export interface TerminalLineSnapshot {
  text: string
  cells: TerminalLineCell[]
}

export type ResolveTerminalFileLinks = (candidates: TerminalFileReference[]) => Promise<boolean[]>

export type ActivateTerminalFileLink = (
  event: MouseEvent,
  candidate: TerminalFileLinkCandidate
) => void

const TOKEN_PATTERN = /[^\s"'`<>{}[\]()]+/gu
const TRAILING_PUNCTUATION = /[.,;!?]+$/u
const LOCATION_SUFFIX = /:(\d+)(?::(\d+))?$/u
const BARE_FILE =
  /^(?:\.[A-Za-z0-9][A-Za-z0-9._-]*|[A-Za-z0-9_@+-][A-Za-z0-9_@+.-]*\.[A-Za-z0-9]{1,16})$/u

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

export function terminalLinkModifierPressed(
  event: Pick<MouseEvent, 'ctrlKey' | 'metaKey'>
): boolean {
  return event.ctrlKey || event.metaKey
}

/** Convert a trusted subset of OSC 8 payloads into the shared activation contract. */
export function terminalOscLinkTarget(value: string): TerminalLinkTarget | null {
  try {
    const url = new URL(value)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return { kind: 'url', url: value }
    }
    if (url.protocol === 'file:') {
      return { kind: 'file', path: value }
    }
  } catch {
    // Malformed or relative OSC 8 values are not actionable.
  }
  return null
}

/**
 * Snapshot one physical xterm buffer line and retain the mapping from UTF-16
 * string offsets back to terminal cells. Continuation cells for wide glyphs
 * are skipped because the leading cell already owns their display width.
 */
export function snapshotTerminalLine(
  line: IBufferLine,
  maximumColumns: number
): TerminalLineSnapshot {
  const cells: TerminalLineCell[] = []
  let text = ''
  const columnLimit = Math.max(0, Math.min(line.length, maximumColumns))

  for (let column = 0; column < columnLimit; column++) {
    const cell = line.getCell(column)
    if (!cell) break
    const width = cell.getWidth()
    if (width === 0) continue

    const chars = cell.getChars() || ' '
    const startIndex = text.length
    text += chars
    cells.push({
      startIndex,
      endIndex: text.length,
      startColumn: column,
      endColumn: column + Math.max(1, width)
    })
  }

  return { text: text.trimEnd(), cells }
}

export function terminalFileLinkRange(
  candidate: TerminalFileLinkCandidate,
  snapshot: TerminalLineSnapshot,
  bufferLineNumber: number
): ILink['range'] | null {
  const startCell = snapshot.cells.find(
    (cell) => candidate.startIndex >= cell.startIndex && candidate.startIndex < cell.endIndex
  )
  const endIndex = candidate.endIndex - 1
  const endCell = snapshot.cells.find(
    (cell) => endIndex >= cell.startIndex && endIndex < cell.endIndex
  )
  if (!startCell || !endCell) return null

  return {
    start: { x: startCell.startColumn + 1, y: bufferLineNumber },
    end: { x: endCell.endColumn, y: bufferLineNumber }
  }
}

export class TerminalFileLinkProvider implements ILinkProvider, IDisposable {
  private disposed = false
  private requestSequence = 0

  constructor(
    private readonly terminal: Pick<Terminal, 'buffer' | 'cols'>,
    private readonly resolveLinks: ResolveTerminalFileLinks,
    private readonly activateLink: ActivateTerminalFileLink
  ) {}

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const requestSequence = ++this.requestSequence
    const line = this.terminal.buffer.active.getLine(bufferLineNumber - 1)
    if (!line) {
      callback(undefined)
      return
    }

    const snapshot = snapshotTerminalLine(line, this.terminal.cols)
    const candidates = findTerminalFileLinks(snapshot.text)
    if (candidates.length === 0) {
      callback(undefined)
      return
    }

    void this.resolveLinks(
      candidates.map(({ path, line: lineNumber, column }) => ({
        path,
        ...(lineNumber === undefined ? {} : { line: lineNumber }),
        ...(column === undefined ? {} : { column })
      }))
    ).then(
      (exists) => {
        if (this.disposed || requestSequence !== this.requestSequence) {
          callback(undefined)
          return
        }

        const links = candidates.flatMap((candidate, index): ILink[] => {
          if (exists[index] !== true) return []
          const range = terminalFileLinkRange(candidate, snapshot, bufferLineNumber)
          if (!range) return []
          return [
            {
              range,
              text: candidate.text,
              activate: (event) => this.activateLink(event, candidate)
            }
          ]
        })
        callback(links.length > 0 ? links : undefined)
      },
      () => callback(undefined)
    )
  }

  dispose(): void {
    this.disposed = true
    this.requestSequence++
  }
}

export function registerTerminalFileLinks(
  terminal: Terminal,
  resolveLinks: ResolveTerminalFileLinks,
  activateLink: ActivateTerminalFileLink
): IDisposable {
  const provider = new TerminalFileLinkProvider(terminal, resolveLinks, activateLink)
  const registration = terminal.registerLinkProvider(provider)
  return {
    dispose: () => {
      provider.dispose()
      registration.dispose()
    }
  }
}
