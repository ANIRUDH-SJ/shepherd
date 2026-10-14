import { app, BrowserWindow, ipcMain, Notification } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import {
  DEFAULT_NOTIFICATION_POLICY,
  parseNotificationPolicy,
  pruneClosedWorkspaceRoutes,
  shouldShowDesktopNotification,
  type NotificationPolicy
} from '../shared/notificationPolicy'
import { writeSessionSnapshot } from './sessionFile'

let cachedPolicy: NotificationPolicy | null = null

function policyPath(): string {
  return join(app.getPath('userData'), 'notification-policy.json')
}

export function getNotificationPolicy(): NotificationPolicy {
  if (cachedPolicy) return cachedPolicy
  try {
    cachedPolicy =
      parseNotificationPolicy(JSON.parse(readFileSync(policyPath(), 'utf8'))) ??
      DEFAULT_NOTIFICATION_POLICY
  } catch {
    cachedPolicy = DEFAULT_NOTIFICATION_POLICY
  }
  return cachedPolicy
}

export function setNotificationPolicy(value: unknown): NotificationPolicy {
  const parsed = parseNotificationPolicy(value)
  if (!parsed) throw new Error('Invalid notification policy')
  writeSessionSnapshot(policyPath(), parsed)
  cachedPolicy = parsed
  return parsed
}

export function pruneNotificationPolicyWorkspaces(workspaceIds: ReadonlySet<string>): void {
  const current = getNotificationPolicy()
  const next = pruneClosedWorkspaceRoutes(current, workspaceIds)
  if (next === current) return
  try {
    writeSessionSnapshot(policyPath(), next)
    cachedPolicy = next
  } catch (error) {
    console.error('[notifications] could not prune closed workspace routes:', error)
  }
}

export function registerNotificationPolicyIpc(): void {
  ipcMain.handle(IPC.NOTIFICATION_POLICY_GET, () => getNotificationPolicy())
  ipcMain.handle(IPC.NOTIFICATION_POLICY_SET, (_event, value: unknown) =>
    setNotificationPolicy(value)
  )
}

function safeText(value: string, limit: number): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0
      return code <= 31 || code === 127 ? ' ' : character
    })
    .join('')
    .trim()
    .slice(0, limit)
}

export function showDesktopNotification(input: {
  workspaceId: string | null
  activeWorkspaceId: string | null
  title: string
  body: string
}): void {
  if (!Notification.isSupported()) return
  const now = new Date()
  if (
    !shouldShowDesktopNotification(getNotificationPolicy(), {
      workspaceId: input.workspaceId,
      activeWorkspaceId: input.activeWorkspaceId,
      windowFocused: BrowserWindow.getFocusedWindow() !== null,
      localMinute: now.getHours() * 60 + now.getMinutes()
    })
  )
    return
  const notification = new Notification({
    title: safeText(input.title, 120) || 'Shepherd',
    body: safeText(input.body, 500)
  })
  notification.on('click', () => {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    if (input.workspaceId) {
      window.webContents.send(IPC.SOCKET_COMMAND, {
        method: 'select-workspace',
        workspaceId: input.workspaceId,
        params: {}
      })
    }
  })
  notification.show()
}
