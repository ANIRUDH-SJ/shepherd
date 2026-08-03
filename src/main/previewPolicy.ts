import { normalizePreviewUrl, PREVIEW_PARTITION } from '../shared/preview'

export type PreviewPreferences = Record<string, unknown>

export function hardenPreviewPreferences(preferences: PreviewPreferences): void {
  delete preferences.preload
  Object.assign(preferences, {
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    devTools: false,
    experimentalFeatures: false,
    navigateOnDragDrop: false,
    disableDialogs: true,
    autoplayPolicy: 'document-user-activation-required',
    backgroundThrottling: true
  })
}

export function previewAttachAllowed(params: Record<string, string | undefined>): boolean {
  return params.partition === PREVIEW_PARTITION && normalizePreviewUrl(params.src).ok
}

export function previewNavigationAllowed(url: string): boolean {
  return normalizePreviewUrl(url).ok
}

export function previewWindowOpenHandler(): { action: 'deny' } {
  return { action: 'deny' }
}

export function previewPermissionAllowed(): false {
  return false
}
