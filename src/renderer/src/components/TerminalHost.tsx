import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { TERMINAL_SCROLLBACK_LINES } from '../../../shared/terminalMemory'
import type { TerminalLinkTarget } from '../../../shared/terminalLinks'
import { getFontSize } from '../settings'
import { RENDERER_EVENT } from '../events'
import { terminalPanelId, terminalTabId } from '../terminalChrome'
import {
  MAX_TERMINAL_FIND_QUERY_LENGTH,
  normalizeTerminalFindQuery,
  terminalFindStatus,
  TERMINAL_FIND_HIGHLIGHT_LIMIT,
  TERMINAL_FIND_TERMINAL_OPTIONS
} from '../terminalFind'
import { TERMINAL_THEME } from '../terminalTheme'
import {
  registerTerminalFileLinks,
  terminalLinkModifierPressed,
  terminalOscLinkTarget
} from '../terminalLinks'
import Icon from './Icon'

const SEARCH_OPTIONS: ISearchOptions = {
  decorations: {
    matchBackground: '#333842',
    matchBorder: '#737985',
    matchOverviewRuler: '#737985',
    activeMatchBackground: '#4d5665',
    activeMatchBorder: '#c7cbd1',
    activeMatchColorOverviewRuler: '#c7cbd1'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TerminalHost — ONE live terminal, bound to ONE backend shell by `surfaceId`.
// Multiple hosts coexist in a pane (one per tab); only the active one is shown.
// The instance is created once on mount and killed on unmount — because panes are
// keyed by a stable id in the flat layer (Workspace.tsx), restructuring the tree
// (splitting/closing OTHER panes) never remounts this, so shells don't churn.
// See docs/ARCHITECTURE.md for renderer and terminal ownership boundaries.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  surfaceId: string
  workspaceId: string
  cwd: string
  active: boolean
  focused: boolean
}

export default function TerminalHost({
  surfaceId,
  workspaceId,
  cwd,
  active,
  focused
}: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const refs = useRef<{ term: Terminal; fit: FitAddon; search: SearchAddon } | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findResults, setFindResults] = useState({ resultIndex: 0, resultCount: 0 })

  const closeFind = (restoreFocus: boolean): void => {
    refs.current?.search.clearDecorations()
    setFindOpen(false)
    if (restoreFocus) requestAnimationFrame(() => refs.current?.term.focus())
  }

  const updateFind = (value: string, direction: 'next' | 'previous' = 'next'): void => {
    const query = normalizeTerminalFindQuery(value)
    setFindQuery(query)
    const search = refs.current?.search
    if (!search) return
    if (!query) {
      search.clearDecorations()
      setFindResults({ resultIndex: 0, resultCount: 0 })
      return
    }
    const options = { ...SEARCH_OPTIONS, incremental: direction === 'next' }
    if (direction === 'previous') search.findPrevious(query, options)
    else search.findNext(query, options)
  }

  useEffect(() => {
    if (!findOpen) return
    requestAnimationFrame(() => {
      findInputRef.current?.focus()
      findInputRef.current?.select()
    })
  }, [findOpen])

  useEffect(() => {
    if (!active && findOpen) closeFind(false)
  }, [active, findOpen])

  // Create the terminal + shell once (per surfaceId).
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const openLink = (target: TerminalLinkTarget): void => {
      void window.api.terminal.openLink({ id: surfaceId, target }).then(
        (result) => {
          if (!result.ok) console.warn(`[shepherd:links] open failed: ${result.error}`)
        },
        () => console.warn('[shepherd:links] open request failed')
      )
    }

    const term = new Terminal({
      ...TERMINAL_FIND_TERMINAL_OPTIONS,
      fontFamily: '"JetBrains Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
      fontSize: getFontSize(),
      scrollback: TERMINAL_SCROLLBACK_LINES,
      cursorBlink: true,
      theme: TERMINAL_THEME,
      linkHandler: {
        allowNonHttpProtocols: true,
        activate: (event, value) => {
          if (!terminalLinkModifierPressed(event)) return
          const target = terminalOscLinkTarget(value)
          if (target) openLink(target)
        }
      }
    })
    const fit = new FitAddon()
    const search = new SearchAddon({ highlightLimit: TERMINAL_FIND_HIGHLIGHT_LIMIT })
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(
      new WebLinksAddon((event, url) => {
        if (terminalLinkModifierPressed(event)) openLink({ kind: 'url', url })
      })
    )
    term.open(container)
    const fileLinks = registerTerminalFileLinks(
      term,
      (candidates) => window.api.terminal.resolveFileLinks({ id: surfaceId, candidates }),
      (event, candidate) => {
        if (!terminalLinkModifierPressed(event)) return
        openLink({
          kind: 'file',
          path: candidate.path,
          ...(candidate.line === undefined ? {} : { line: candidate.line }),
          ...(candidate.column === undefined ? {} : { column: candidate.column })
        })
      }
    )
    const measuresStartup = window.api.performance.enabled && focused
    if (measuresStartup) window.api.performance.mark('terminal-opened')
    fit.fit()
    if (measuresStartup) window.api.performance.mark('terminal-fitted')
    refs.current = { term, fit, search }
    const searchResults = search.onDidChangeResults((results) => setFindResults(results))

    // GPU rendering for smooth scrolling; fall back silently if WebGL is unavailable.
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
      if (measuresStartup) {
        window.api.performance.mark('terminal-renderer-webgl')
      }
    } catch {
      if (measuresStartup) {
        window.api.performance.mark('terminal-renderer-fallback')
      }
      /* no WebGL — xterm uses its DOM/canvas renderer */
    }

    let writeData: (data: string, acknowledge: () => void) => void
    if (measuresStartup) {
      let waitingForFirstOutput = true
      writeData = (data, acknowledge) => {
        if (!waitingForFirstOutput) {
          term.write(data, acknowledge)
          return
        }
        waitingForFirstOutput = false
        term.write(data, () => {
          acknowledge()
          window.requestAnimationFrame(() => {
            window.api.performance.mark('terminal-first-output-written')
          })
        })
      }
    } else {
      writeData = (data, acknowledge) => term.write(data, acknowledge)
    }
    const offData = window.api.terminal.onData(surfaceId, writeData)
    const offExit = window.api.terminal.onExit(surfaceId, (code) => {
      term.write(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m\r\n`)
      window.dispatchEvent(
        new CustomEvent(RENDERER_EVENT.terminalExit, { detail: { surfaceId, exitCode: code } })
      )
    })
    const terminalCreation = window.api.terminal.create({
      id: surfaceId,
      workspaceId,
      cwd,
      cols: term.cols,
      rows: term.rows,
      ...(measuresStartup ? { startupPerformanceCandidate: true } : {})
    })
    let disposed = false
    let startupReadyFrame: number | null = null
    if (focused) {
      void terminalCreation.then(
        () => {
          if (disposed) return
          startupReadyFrame = window.requestAnimationFrame(() => {
            startupReadyFrame = null
            window.api.startup.firstTerminalReady()
          })
        },
        () => undefined
      )
    }
    const onData = term.onData((data) => window.api.terminal.input({ id: surfaceId, data }))

    // Refit on resize — but skip while hidden (0×0) so we don't resize the shell to 1×1.
    const resize = (): void => {
      if (container.offsetWidth === 0 || container.offsetHeight === 0) return
      fit.fit()
      window.api.terminal.resize({ id: surfaceId, cols: term.cols, rows: term.rows })
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)

    // Live-update the font when the user zooms (Ctrl+Shift+±).
    const onFontSize = (e: Event): void => {
      term.options.fontSize = (e as CustomEvent<number>).detail
      resize()
    }
    const onFocusSurface = (e: Event): void => {
      if ((e as CustomEvent<string>).detail !== surfaceId) return
      resize()
      term.focus()
    }
    const onTerminalFind = (e: Event): void => {
      if ((e as CustomEvent<{ surfaceId?: unknown }>).detail?.surfaceId !== surfaceId) return
      setFindOpen(true)
    }
    window.addEventListener(RENDERER_EVENT.fontSize, onFontSize)
    window.addEventListener(RENDERER_EVENT.focusSurface, onFocusSurface)
    window.addEventListener(RENDERER_EVENT.terminalFind, onTerminalFind)

    return () => {
      disposed = true
      if (startupReadyFrame !== null) window.cancelAnimationFrame(startupReadyFrame)
      observer.disconnect()
      window.removeEventListener(RENDERER_EVENT.fontSize, onFontSize)
      window.removeEventListener(RENDERER_EVENT.focusSurface, onFocusSurface)
      window.removeEventListener(RENDERER_EVENT.terminalFind, onTerminalFind)
      searchResults.dispose()
      onData.dispose()
      offData()
      offExit()
      window.api.terminal.dispose(surfaceId)
      fileLinks.dispose()
      term.dispose()
      refs.current = null
    }
  }, [surfaceId])

  // Refit when this tab becomes visible, and focus when it is also the selected
  // pane in the active workspace (including focus-agent sidebar navigation).
  useEffect(() => {
    if (!active || !refs.current) return
    const { term, fit } = refs.current
    fit.fit()
    window.api.terminal.resize({ id: surfaceId, cols: term.cols, rows: term.rows })
  }, [active, surfaceId])

  useEffect(() => {
    if (focused) refs.current?.term.focus()
  }, [focused])

  return (
    <>
      <div
        id={terminalPanelId(surfaceId)}
        className="terminal"
        ref={containerRef}
        role="tabpanel"
        aria-labelledby={terminalTabId(surfaceId)}
        hidden={!active}
      />
      {active && findOpen && (
        <form
          className="terminal-find"
          role="search"
          aria-label="Find in current terminal"
          onSubmit={(event) => {
            event.preventDefault()
            updateFind(findQuery)
          }}
        >
          <input
            ref={findInputRef}
            type="search"
            value={findQuery}
            maxLength={MAX_TERMINAL_FIND_QUERY_LENGTH}
            aria-label="Search terminal scrollback"
            placeholder="Find"
            onChange={(event) => updateFind(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                updateFind(findQuery, event.shiftKey ? 'previous' : 'next')
              } else if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                closeFind(true)
              }
            }}
          />
          <output aria-live="polite">
            {terminalFindStatus(findQuery, findResults.resultIndex, findResults.resultCount)}
          </output>
          <button
            type="button"
            title="Previous match (Shift+Enter)"
            aria-label="Previous match"
            disabled={!findQuery}
            onClick={() => updateFind(findQuery, 'previous')}
          >
            ↑
          </button>
          <button
            type="button"
            title="Next match (Enter)"
            aria-label="Next match"
            disabled={!findQuery}
            onClick={() => updateFind(findQuery)}
          >
            ↓
          </button>
          <button
            type="button"
            title="Close find (Escape)"
            aria-label="Close terminal find"
            onClick={() => closeFind(true)}
          >
            <Icon name="close" />
          </button>
        </form>
      )}
    </>
  )
}
