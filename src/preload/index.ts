import { contextBridge } from 'electron'

// ─────────────────────────────────────────────────────────────────────────────
// PRELOAD  (the secure bridge between main and renderer)
// It runs before the web page and exposes a tidy, minimal `window.api`.
// The renderer NEVER touches ipcRenderer directly — only this surface.
// See textbook/05-preload-and-context-isolation.md.
// ─────────────────────────────────────────────────────────────────────────────

// M0: just a version probe so we can confirm the bridge works end-to-end.
// This object grows in later milestones (sendInput, onPtyData, onWorkspaceUpdate…).
const api = {
  version: '0.0.1'
}

try {
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error('[preload] exposeInMainWorld failed:', error)
}

export type CmuxApi = typeof api
