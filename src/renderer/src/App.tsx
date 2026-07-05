import TerminalView from './components/TerminalView'

// The root React component. For M1 it's the sidebar (still a placeholder) plus a
// single real terminal in the work area. Multiple terminals, tabs, and splits
// arrive in M2; the live workspace sidebar in M3.

export default function App(): React.JSX.Element {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">cmux-linux</div>
        <div className="hint">workspace sidebar — arrives in M3</div>
      </aside>

      <main className="workarea">
        <TerminalView />
      </main>
    </div>
  )
}
