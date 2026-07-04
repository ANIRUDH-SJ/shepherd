// The root React component. For M0 it's a static shell: a placeholder sidebar
// and a work area. It proves Electron + React + TypeScript + the preload bridge
// are all wired together. Real panes/terminals arrive in M1–M2.

export default function App() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">cmux-linux</div>
        <div className="hint">workspace sidebar — arrives in M3</div>
      </aside>

      <main className="workarea">
        <h1>M0 ✓ — the app shell is alive</h1>
        <p>
          This window is Electron + React + TypeScript, bundled by electron-vite.
          The preload bridge reports <code>window.api.version = {window.api?.version ?? 'n/a'}</code>,
          which means main → preload → renderer are all connected.
        </p>
        <p className="next">Next milestone → M1: a real terminal running in this pane.</p>
      </main>
    </div>
  )
}
