import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { getFontSize } from '../settings'

// ─────────────────────────────────────────────────────────────────────────────
// TerminalHost — ONE live terminal, bound to ONE backend shell by `surfaceId`.
// Multiple hosts coexist in a pane (one per tab); only the active one is shown.
// The instance is created once on mount and killed on unmount — because panes are
// keyed by a stable id in the flat layer (Workspace.tsx), restructuring the tree
// (splitting/closing OTHER panes) never remounts this, so shells don't churn.
// See textbook/07 (xterm.js) and /10 (why the flat keyed layer matters).
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  surfaceId: string
  workspaceId: string
  active: boolean
  focused: boolean
}

export default function TerminalHost({
  surfaceId,
  workspaceId,
  active,
  focused
}: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const refs = useRef<{ term: Terminal; fit: FitAddon } | null>(null)

  // Create the terminal + shell once (per surfaceId).
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
      fontSize: getFontSize(),
      cursorBlink: true,
      theme: { background: '#0d0d0f', foreground: '#e6e6e6', cursor: '#8ab4ff' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    fit.fit()
    refs.current = { term, fit }

    // GPU rendering for smooth scrolling; fall back silently if WebGL is unavailable.
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch {
      /* no WebGL — xterm uses its DOM/canvas renderer */
    }

    const offData = window.api.terminal.onData(surfaceId, (data) => term.write(data))
    const offExit = window.api.terminal.onExit(surfaceId, (code) =>
      term.write(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m\r\n`)
    )
    window.api.terminal.create({ id: surfaceId, workspaceId, cols: term.cols, rows: term.rows })
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
    window.addEventListener('cmux:fontsize', onFontSize)
    window.addEventListener('cmux:focus-surface', onFocusSurface)

    return () => {
      observer.disconnect()
      window.removeEventListener('cmux:fontsize', onFontSize)
      window.removeEventListener('cmux:focus-surface', onFocusSurface)
      onData.dispose()
      offData()
      offExit()
      window.api.terminal.dispose(surfaceId)
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

  return <div className="terminal" ref={containerRef} style={{ display: active ? 'block' : 'none' }} />
}
