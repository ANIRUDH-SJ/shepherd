import ReactDOM from 'react-dom/client'
import App from './App'
import './App.css'
import { initializeAppearance } from './appearance'

initializeAppearance()

if (window.api.performance.enabled) window.api.performance.mark('renderer-bootstrap')

// Renderer entry point. Mounts the React app into #root in index.html.
//
// NOTE: React.StrictMode is intentionally OFF. Its dev-only double-mount of effects
// double-creates/-disposes pty shells over async IPC, which can race and leave a
// terminal dead/untypeable. Our reducers are already pure (the checks StrictMode
// would add), so we skip it here.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />)

if (window.api.performance.enabled) {
  window.requestAnimationFrame(() => window.api.performance.mark('renderer-mounted'))
}
