import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'

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
    title: 'cmux-linux',
    backgroundColor: '#0d0d0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // sandbox:false is required so the preload can later load native modules
      // (e.g. node-pty). contextIsolation stays ON — the secure default.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Show only once the page is painted — avoids a white flash on launch.
  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Open target=_blank / external links in the user's browser, not a new window.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // In dev, electron-vite serves the renderer and sets ELECTRON_RENDERER_URL.
  // In production, load the built HTML file from disk.
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  // macOS convention (harmless on Linux): re-open a window if none are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
