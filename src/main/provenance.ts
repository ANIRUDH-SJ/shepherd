import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import {
  deriveAuditEvents,
  MAX_AUDIT_ENTRIES,
  sanitizeAuditEntries,
  sessionExport,
  type AuditEntry,
  type AuditEvent
} from '../shared/provenance'
import { writeSessionSnapshot } from './sessionFile'

const MAX_EXPORT_BYTES = 5 * 1024 * 1024
let cachedHistory: AuditEntry[] | null = null

function historyPath(): string {
  return join(app.getPath('userData'), 'provenance.json')
}

export function auditHistory(): AuditEntry[] {
  if (cachedHistory) return cachedHistory
  try {
    cachedHistory = sanitizeAuditEntries(JSON.parse(readFileSync(historyPath(), 'utf8')))
  } catch {
    cachedHistory = []
  }
  return cachedHistory
}

function appendAudit(entries: AuditEntry[]): void {
  if (entries.length === 0) return
  const next = [...auditHistory(), ...entries].slice(-MAX_AUDIT_ENTRIES)
  writeSessionSnapshot(historyPath(), next)
  cachedHistory = next
}

function stamp(events: AuditEvent[]): AuditEntry[] {
  const at = Date.now()
  return events.map((event) => ({ ...event, id: randomUUID(), at }))
}

export function recordSessionChanges(previous: unknown, next: unknown): void {
  appendAudit(stamp(deriveAuditEvents(previous, next)))
}

/** Export is explicit and read-only. It never restarts shells or imports a session. */
export async function exportSessionArchive(snapshot: unknown): Promise<{ path: string } | null> {
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    !Array.isArray((snapshot as { workspaces?: unknown }).workspaces) ||
    typeof (snapshot as { activeWorkspaceId?: unknown }).activeWorkspaceId !== 'string'
  )
    throw new Error('Invalid session snapshot')

  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options = {
    title: 'Export Shepherd session',
    defaultPath: 'shepherd-session.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null

  const exportedAt = Date.now()
  const exportEntry = stamp([
    {
      kind: 'session-exported',
      workspaceId: null,
      workspaceName: null,
      detail: 'Session exported'
    }
  ])[0]
  const archive = sessionExport(
    snapshot,
    [...auditHistory(), exportEntry].slice(-MAX_AUDIT_ENTRIES),
    exportedAt
  )
  if (Buffer.byteLength(JSON.stringify(archive), 'utf8') > MAX_EXPORT_BYTES)
    throw new Error('Session export exceeds the 5 MB limit')
  writeSessionSnapshot(result.filePath, archive)
  try {
    appendAudit([exportEntry])
  } catch (error) {
    console.error('[provenance] export recorded only in archive:', error)
  }
  return { path: result.filePath }
}

export function registerProvenanceIpc(): void {
  ipcMain.handle(IPC.PROVENANCE_LIST, () => auditHistory())
  ipcMain.handle(IPC.SESSION_EXPORT, (_event, snapshot: unknown) => exportSessionArchive(snapshot))
}
