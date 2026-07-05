import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type CmuxApi,
  type TermCreateOptions,
  type TermInput,
  type TermResize,
  type TermData,
  type TermExit
} from '../shared/ipc'

// ─────────────────────────────────────────────────────────────────────────────
// PRELOAD  (the secure bridge between main and renderer)
// Wraps ipcRenderer into a tidy, typed `window.api`. The renderer NEVER touches
// ipcRenderer directly — only this surface. See textbook/05.
// ─────────────────────────────────────────────────────────────────────────────

const api: CmuxApi = {
  version: '0.0.1',
  terminal: {
    create: (opts: TermCreateOptions) => ipcRenderer.invoke(IPC.TERM_CREATE, opts),

    input: (msg: TermInput) => ipcRenderer.send(IPC.TERM_INPUT, msg),

    resize: (msg: TermResize) => ipcRenderer.send(IPC.TERM_RESIZE, msg),

    dispose: (id: string) => ipcRenderer.send(IPC.TERM_DISPOSE, id),

    // Subscribe to output for ONE terminal id. We filter here so each
    // TerminalView only hears about its own shell. Returns an unsubscribe fn
    // (used by React's useEffect cleanup — see textbook/08).
    onData: (id, cb) => {
      const listener = (_e: IpcRendererEvent, msg: TermData): void => {
        if (msg.id === id) cb(msg.data)
      }
      ipcRenderer.on(IPC.TERM_DATA, listener)
      return () => {
        ipcRenderer.removeListener(IPC.TERM_DATA, listener)
      }
    },

    onExit: (id, cb) => {
      const listener = (_e: IpcRendererEvent, msg: TermExit): void => {
        if (msg.id === id) cb(msg.exitCode)
      }
      ipcRenderer.on(IPC.TERM_EXIT, listener)
      return () => {
        ipcRenderer.removeListener(IPC.TERM_EXIT, listener)
      }
    }
  }
}

try {
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error('[preload] exposeInMainWorld failed:', error)
}
