import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './App.css'

// Renderer entry point. Mounts the React app into #root in index.html.
// See textbook/08-react-in-this-app.md.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
