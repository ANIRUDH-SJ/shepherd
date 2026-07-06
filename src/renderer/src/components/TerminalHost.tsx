import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

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
}

export default function TerminalHost({ surfaceId, workspaceId, active }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const refs = useRef<{ term: Terminal; fit: FitAddon } | null>(null)

  // Create the terminal + shell once (per surfaceId).
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: { background: '#0d0d0f', foreground: '#e6e6e6', cursor: '#8ab4ff' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    fit.fit()
    refs.current = { term, fit }

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

    return () => {
      observer.disconnect()
      onData.dispose()
      offData()
      offExit()
      window.api.terminal.dispose(surfaceId)
      term.dispose()
      refs.current = null
    }
  }, [surfaceId])

  // When this tab becomes active (was hidden → shown), refit and focus.
  useEffect(() => {
    if (!active || !refs.current) return
    const { term, fit } = refs.current
    fit.fit()
    window.api.terminal.resize({ id: surfaceId, cols: term.cols, rows: term.rows })
    term.focus()
  }, [active, surfaceId])

  return <div className="terminal" ref={containerRef} style={{ display: active ? 'block' : 'none' }} />
}
