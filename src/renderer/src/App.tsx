import Workspace from './components/Workspace'

// The root React component. M2: a placeholder sidebar + a workspace of tiled,
// tabbed, resizable terminals. The real workspace sidebar arrives in M3.

export default function App(): React.JSX.Element {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">cmux-linux</div>
        <div className="hint">workspace sidebar — arrives in M3</div>
        <div className="shortcuts">
          <div className="shortcuts-title">shortcuts</div>
          <div><kbd>Ctrl+Shift+D</kbd> split right</div>
          <div><kbd>Ctrl+Shift+E</kbd> split down</div>
          <div><kbd>Ctrl+Shift+T</kbd> new tab</div>
          <div><kbd>Ctrl+Shift+W</kbd> close</div>
        </div>
      </aside>

      <main className="workarea">
        <Workspace />
      </main>
    </div>
  )
}
