import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

// ─────────────────────────────────────────────────────────────────────────────
// TerminalView — ONE live terminal.
// An xterm.js instance (renderer) bound over IPC to a real shell (node-pty) in
// the main process. This component is the whole "core loop" made concrete.
// See textbook/07 (xterm.js) and textbook/17 (how it all connects).
// ─────────────────────────────────────────────────────────────────────────────

export default function TerminalView(): React.JSX.Element {
  // The div xterm.js paints into. A ref, not state — xterm owns its own canvas
  // and must NOT be driven by React re-renders (textbook/08).
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // 1) Create the terminal + fit addon, and paint it into our div.
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

    // 2) A unique id ties THIS xterm to ONE shell in the backend.
    const id = crypto.randomUUID()

    // 3) Subscribe to shell output BEFORE creating the shell, so we miss nothing.
    const offData = window.api.terminal.onData(id, (data) => term.write(data))
    const offExit = window.api.terminal.onExit(id, (code) => {
      term.write(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m\r\n`)
    })

    // 4) Ask the backend to spawn the shell at our current grid size.
    window.api.terminal.create({ id, cols: term.cols, rows: term.rows })

    // 5) Keystrokes → shell.
    const onData = term.onData((data) => window.api.terminal.input({ id, data }))

    // 6) Keep sizes in sync: when the container resizes, refit and tell the shell.
    const resize = (): void => {
      fit.fit()
      window.api.terminal.resize({ id, cols: term.cols, rows: term.rows })
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)

    term.focus()

    // 7) Teardown — order matters: stop listeners, kill the shell, dispose xterm.
    //    This prevents listener leaks AND zombie shell processes.
    return () => {
      observer.disconnect()
      onData.dispose()
      offData()
      offExit()
      window.api.terminal.dispose(id)
      term.dispose()
    }
  }, [])

  return <div className="terminal" ref={containerRef} />
}
