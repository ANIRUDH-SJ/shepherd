import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell,
  type WebContents,
  type WebPreferences
} from 'electron'
import { IPC, type PreviewOpenExternalResult } from '../shared/ipc'
import { normalizePreviewUrl, PREVIEW_PARTITION, previewRequestAllowed } from '../shared/preview'
import {
  hardenPreviewPreferences,
  previewAttachAllowed,
  previewNavigationAllowed,
  previewPermissionAllowed,
  previewWindowOpenHandler
} from './previewPolicy'

let configured = false

function configurePreviewGuest(contents: WebContents): void {
  contents.setWindowOpenHandler(previewWindowOpenHandler)
  contents.on('will-frame-navigate', (event) => {
    if (!previewNavigationAllowed(event.url)) event.preventDefault()
  })
  contents.on('will-navigate', (event) => {
    if (!previewNavigationAllowed(event.url)) event.preventDefault()
  })
  contents.on('will-redirect', (event) => {
    if (!previewNavigationAllowed(event.url)) event.preventDefault()
  })
  contents.on('will-prevent-unload', (event) => event.preventDefault())
  contents.on('devtools-opened', () => contents.closeDevTools())
}

export function configurePreviewHost(contents: WebContents): void {
  contents.on(
    'will-attach-webview',
    (event, webPreferences: WebPreferences, params: Record<string, string>) => {
      if (!previewAttachAllowed(params)) {
        event.preventDefault()
        return
      }
      delete params.preload
      delete params.allowpopups
      hardenPreviewPreferences(webPreferences as unknown as Record<string, unknown>)
    }
  )
}

export function configurePreviewSecurity(): void {
  if (configured) return
  configured = true
  const previewSession = session.fromPartition(PREVIEW_PARTITION)
  previewSession.setPermissionCheckHandler(() => previewPermissionAllowed())
  previewSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(previewPermissionAllowed())
  })
  previewSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: !previewRequestAllowed(details.url, details.resourceType) })
  })
  previewSession.on('will-download', (event) => event.preventDefault())

  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() === 'webview') configurePreviewGuest(contents)
  })

  ipcMain.handle(
    IPC.PREVIEW_OPEN_EXTERNAL,
    async (event, value: unknown): Promise<PreviewOpenExternalResult> => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const normalized = normalizePreviewUrl(value)
      if (!window || !normalized.ok || !normalized.url) {
        return { ok: false, error: normalized.error ?? 'Preview request is not owned by a window' }
      }
      try {
        await shell.openExternal(normalized.url)
        return { ok: true }
      } catch {
        return { ok: false, error: 'The system browser could not open this preview URL' }
      }
    }
  )
}
