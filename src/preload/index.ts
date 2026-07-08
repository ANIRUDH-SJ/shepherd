import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type CmuxApi,
  type TermData,
  type TermExit,
  type SocketApply
} from '../shared/ipc'

// ─────────────────────────────────────────────────────────────────────────────
// PRELOAD  (the secure bridge between main and renderer)
// Wraps ipcRenderer into a tidy, typed `window.api`. The renderer NEVER touches
// ipcRenderer directly — only this surface. See textbook/05.
// ─────────────────────────────────────────────────────────────────────────────

const api: CmuxApi = {
  version: '0.0.1',

  terminal: {
    create: (opts) => ipcRenderer.invoke(IPC.TERM_CREATE, opts),
    input: (msg) => ipcRenderer.send(IPC.TERM_INPUT, msg),
    resize: (msg) => ipcRenderer.send(IPC.TERM_RESIZE, msg),
    dispose: (id) => ipcRenderer.send(IPC.TERM_DISPOSE, id),

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
  },

  socket: {
    syncWorkspaces: (sync) => ipcRenderer.send(IPC.WORKSPACES_SYNC, sync),

    onCommand: (cb) => {
      const listener = (_e: IpcRendererEvent, cmd: SocketApply): void => cb(cmd)
      ipcRenderer.on(IPC.SOCKET_COMMAND, listener)
      return () => {
        ipcRenderer.removeListener(IPC.SOCKET_COMMAND, listener)
      }
    }
  },

  session: {
    loadSync: () => ipcRenderer.sendSync(IPC.SESSION_LOAD_SYNC),
    save: (state) => ipcRenderer.send(IPC.SESSION_SAVE, state)
  }
}

try {
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error('[preload] exposeInMainWorld failed:', error)
}
