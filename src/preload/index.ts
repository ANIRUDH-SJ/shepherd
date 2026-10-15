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
// ipcRenderer directly — only this validated surface. See docs/ARCHITECTURE.md.
// ─────────────────────────────────────────────────────────────────────────────

const performanceDiagnosticsEnabled = runtimePerformanceDiagnosticsEnabled(process.env)
let firstTerminalReadyReported = false

const api: ShepherdApi = {
  version: '0.0.1',

  workspace: {
    chooseDirectory: () => ipcRenderer.invoke(IPC.WORKSPACE_CHOOSE_DIRECTORY)
  },

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

  appearance: {
    getSync: () => ipcRenderer.sendSync(IPC.APPEARANCE_GET_SYNC),
    setMode: (mode) => ipcRenderer.invoke(IPC.APPEARANCE_SET, mode),
    onChanged: (cb) => {
      const listener = (_event: IpcRendererEvent, snapshot: Parameters<typeof cb>[0]): void =>
        cb(snapshot)
      ipcRenderer.on(IPC.APPEARANCE_UPDATED, listener)
      return () => ipcRenderer.removeListener(IPC.APPEARANCE_UPDATED, listener)
    }
  },

  notifications: {
    getPolicy: () => ipcRenderer.invoke(IPC.NOTIFICATION_POLICY_GET),
    setPolicy: (policy) => ipcRenderer.invoke(IPC.NOTIFICATION_POLICY_SET, policy)
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
    save: (state) => ipcRenderer.send(IPC.SESSION_SAVE, state),
    saveSync: (state) => {
      ipcRenderer.sendSync(IPC.SESSION_SAVE_SYNC, state)
    }
  },

  review: {
    status: (request) => ipcRenderer.invoke(IPC.REVIEW_STATUS, request),
    diff: (request) => ipcRenderer.invoke(IPC.REVIEW_DIFF, request),
    stage: (request) => ipcRenderer.invoke(IPC.REVIEW_STAGE, request),
    unstage: (request) => ipcRenderer.invoke(IPC.REVIEW_UNSTAGE, request),
    commit: (request) => ipcRenderer.invoke(IPC.REVIEW_COMMIT, request),
    test: (request) => ipcRenderer.invoke(IPC.REVIEW_TEST, request),
    pullRequestDiff: (request) => ipcRenderer.invoke(IPC.REVIEW_PR_DIFF, request)
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
