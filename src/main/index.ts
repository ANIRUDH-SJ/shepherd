import { app, BrowserWindow, ipcMain } from 'electron'
import { performance } from 'node:perf_hooks'
import { join } from 'path'
import { registerPtyIpc, killAllTerminals } from './pty'
import { startSocketServer, stopSocketServer, updateWorkspaceMirror } from './socket'
import { startAutomaticAgentDiscovery } from './agentDiscovery'
import { DeferredBackgroundServices } from './deferredBackgroundServices'
import { startWorkspaceMetadataDiscovery } from './workspaceMetadata'
import { RuntimePerformanceRecorder } from './runtimePerformance'
import { configureProductIdentity } from './productIdentity'
import { configurePreviewHost, configurePreviewSecurity } from './previewSecurity'
import { loadSession, saveSession } from './session'
import { IPC, type SocketApply, type WorkspacesSync } from '../shared/ipc'
import { PRODUCT_NAME } from '../shared/product'
import {
  isRendererRuntimePerformanceMarkName,
  runtimePerformanceDiagnosticsEnabled
} from '../shared/runtimePerformance'

configureProductIdentity(app)

let deferredBackgroundServices: DeferredBackgroundServices | null = null
const runtimePerformance = new RuntimePerformanceRecorder({
  enabled: runtimePerformanceDiagnosticsEnabled(process.env),
  now: () => performance.now()
})
runtimePerformance.mark('main-process-start', 0)
runtimePerformance.mark('main-module-loaded')

function sendSocketCommand(cmd: SocketApply): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.SOCKET_COMMAND, cmd)
  }
}

function backgroundServicesVisible(): boolean {
  return BrowserWindow.getAllWindows().some(
    (window) => !window.isDestroyed() && window.isVisible() && !window.isMinimized()
  )
}

function syncBackgroundServiceVisibility(): void {
  deferredBackgroundServices?.setVisible(backgroundServicesVisible())
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PROCESS  (the "backend" — full Node.js + OS access)
// For M0 its only job is to open one window and load the React renderer into it.
// Later milestones add: node-pty shells, the unix-socket API, session restore.
// See textbook/03-electron-architecture.md.
// ─────────────────────────────────────────────────────────────────────────────

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    title: PRODUCT_NAME,
    backgroundColor: '#272823',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // sandbox:false is required so the preload can later load native modules
      // (e.g. node-pty). contextIsolation stays ON — the secure default.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })
  runtimePerformance.mark('window-created')

  // Show only once the page is painted — avoids a white flash on launch.
  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    runtimePerformance.mark('window-visible')
  })
  mainWindow.on('show', syncBackgroundServiceVisibility)
  mainWindow.on('hide', syncBackgroundServiceVisibility)
  mainWindow.on('minimize', syncBackgroundServiceVisibility)
  mainWindow.on('restore', syncBackgroundServiceVisibility)
  mainWindow.on('closed', syncBackgroundServiceVisibility)

  // Browser guests are opt-in localhost previews; the application renderer never
  // gets an ambient target=_blank path to the OS browser.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  configurePreviewHost(mainWindow.webContents)

  // In dev, electron-vite serves the renderer and sets ELECTRON_RENDERER_URL.
  // In production, load the built HTML file from disk.
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  runtimePerformance.mark('electron-ready')
  // Wire up the terminal IPC handlers before any window loads.
  configurePreviewSecurity()
  registerPtyIpc(runtimePerformance.enabled ? (name) => runtimePerformance.mark(name) : undefined)
  ipcMain.on(IPC.PERFORMANCE_MARK, (_event, name: unknown) => {
    if (isRendererRuntimePerformanceMarkName(name)) runtimePerformance.mark(name)
  })

  // Socket server: route incoming commands to the renderer to update app state.
  startSocketServer(sendSocketCommand)
  deferredBackgroundServices = new DeferredBackgroundServices({
    startAgentDiscovery: () => startAutomaticAgentDiscovery(sendSocketCommand),
    startWorkspaceMetadata: () => startWorkspaceMetadataDiscovery(sendSocketCommand),
    onServiceStarted: (service) => {
      runtimePerformance.mark(
        service === 'agent-discovery' ? 'agent-discovery-started' : 'workspace-metadata-started'
      )
    },
    onReady: () => runtimePerformance.mark('background-services-started'),
    onError: (service, error) => console.error(`[startup] ${service} failed to start:`, error)
  })
  deferredBackgroundServices.setVisible(false)
  ipcMain.on(IPC.STARTUP_FIRST_TERMINAL_READY, () => {
    runtimePerformance.mark('first-terminal-ready')
    deferredBackgroundServices?.firstTerminalReady()
  })
  // Renderer mirrors its workspace list here so the socket can resolve ids/names.
  ipcMain.on(IPC.WORKSPACES_SYNC, (_e, sync: WorkspacesSync) => {
    updateWorkspaceMirror(sync)
    deferredBackgroundServices?.update(sync)
  })

  // Session persistence: load synchronously at startup, save (debounced) on change.
  ipcMain.on(IPC.SESSION_LOAD_SYNC, (e) => {
    e.returnValue = loadSession()
  })
  ipcMain.on(IPC.SESSION_SAVE, (_e, state) => saveSession(state))
  runtimePerformance.mark('backend-services-started')

  createWindow()

  // macOS convention (harmless on Linux): re-open a window if none are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  killAllTerminals()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Extra safety: kill shells + close the socket if the app quits some other way too.
app.on('before-quit', () => {
  runtimePerformance.flush()
  deferredBackgroundServices?.stop()
  deferredBackgroundServices = null
  killAllTerminals()
  stopSocketServer()
})
