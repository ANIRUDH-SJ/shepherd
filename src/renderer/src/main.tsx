import ReactDOM from 'react-dom/client'
import App from './App'
import './App.css'

// Renderer entry point. Mounts the React app into #root in index.html.
//
// NOTE: React.StrictMode is intentionally OFF. Its dev-only double-mount of effects
// double-creates/-disposes pty shells over async IPC, which can race and leave a
// terminal dead/untypeable. Our reducers are already pure (the checks StrictMode
// would add), so we skip it here. See textbook/08 and learning/M3.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />)
