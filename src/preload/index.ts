import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type ShepherdApi,
  type TermData,
  type TermDataAck,
  type TermExit,
  type SocketApply
} from '../shared/ipc'
import { runtimePerformanceDiagnosticsEnabled } from '../shared/runtimePerformance'

// ─────────────────────────────────────────────────────────────────────────────
// PRELOAD  (the secure bridge between main and renderer)
// Wraps ipcRenderer into a tidy, typed `window.api`. The renderer NEVER touches
// ipcRenderer directly — only this surface. See textbook/05.
// ─────────────────────────────────────────────────────────────────────────────

const performanceDiagnosticsEnabled = runtimePerformanceDiagnosticsEnabled(process.env)
let firstTerminalReadyReported = false

const api: ShepherdApi = {
  version: '0.0.1',

  terminal: {
    create: (opts) => ipcRenderer.invoke(IPC.TERM_CREATE, opts),
    input: (msg) => ipcRenderer.send(IPC.TERM_INPUT, msg),
    resize: (msg) => ipcRenderer.send(IPC.TERM_RESIZE, msg),
    resolveFileLinks: (request) => ipcRenderer.invoke(IPC.TERM_RESOLVE_FILE_LINKS, request),
    openLink: (request) => ipcRenderer.invoke(IPC.TERM_OPEN_LINK, request),
    dispose: (id) => ipcRenderer.send(IPC.TERM_DISPOSE, id),

    onData: (id, cb) => {
      const listener = (_e: IpcRendererEvent, msg: TermData): void => {
        if (msg.id !== id) return
        let acknowledged = false
        cb(msg.data, () => {
          if (acknowledged || !Number.isSafeInteger(msg.sequence)) return
          acknowledged = true
          const acknowledgement: TermDataAck = { id, sequence: msg.sequence! }
          ipcRenderer.send(IPC.TERM_DATA_ACK, acknowledgement)
        })
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

  preview: {
    openExternal: (url) => ipcRenderer.invoke(IPC.PREVIEW_OPEN_EXTERNAL, url)
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
  },

  startup: {
    firstTerminalReady: () => {
      if (firstTerminalReadyReported) return
      firstTerminalReadyReported = true
      ipcRenderer.send(IPC.STARTUP_FIRST_TERMINAL_READY)
    }
  },

  performance: {
    enabled: performanceDiagnosticsEnabled,
    mark: (name) => {
      if (performanceDiagnosticsEnabled) ipcRenderer.send(IPC.PERFORMANCE_MARK, name)
    }
  }
}

try {
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error('[shepherd:preload] exposeInMainWorld failed:', error)
}
