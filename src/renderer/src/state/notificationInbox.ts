export const NOTIFICATION_INBOX_LIMIT = 100
export const NOTIFICATION_DEDUPE_WINDOW_MS = 5_000

const MAX_TITLE_LENGTH = 120
const MAX_BODY_LENGTH = 500

export type NotificationSource = 'socket' | 'osc' | 'agent'
export type NotificationSeverity = 'attention' | 'info'

export interface NotificationInput {
  id: string
  workspaceId: string
  surfaceId: string | null
  subjectId: string | null
  title: string
  body: string
  source: NotificationSource
  severity: NotificationSeverity
  createdAt: number
}

export interface InboxNotification {
  id: string
  workspaceId: string
  surfaceId: string | null
  subjectId: string | null
  title: string
  body: string
  sources: NotificationSource[]
  severity: NotificationSeverity
  createdAt: number
  unread: boolean
  resolved: boolean
  occurrences: number
  dedupeKey: string
}

export interface WorkspaceNotificationCounts {
  unread: number
  pending: number
}

function normalizeText(value: string, limit: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

function fingerprint(input: Pick<NotificationInput, 'workspaceId' | 'surfaceId' | 'title' | 'body'>): string {
  const meaningfulText = normalizeText(input.body || input.title, MAX_BODY_LENGTH).toLocaleLowerCase()
  return `${input.workspaceId}\u0000${input.surfaceId ?? ''}\u0000${meaningfulText}`
}

function newestFirst(a: InboxNotification, b: InboxNotification): number {
  return b.createdAt - a.createdAt || a.id.localeCompare(b.id)
}

export function addInboxNotification(
  inbox: readonly InboxNotification[],
  input: NotificationInput
): InboxNotification[] {
  const title = normalizeText(input.title, MAX_TITLE_LENGTH) || 'Shepherd'
  const body = normalizeText(input.body, MAX_BODY_LENGTH) || 'Needs your attention'
  const normalized = { ...input, title, body }
  const dedupeKey = fingerprint(normalized)
  const duplicateIndex = inbox.findIndex(
    (notification) =>
      !notification.resolved &&
      notification.dedupeKey === dedupeKey &&
      Math.abs(input.createdAt - notification.createdAt) <= NOTIFICATION_DEDUPE_WINDOW_MS
  )

  const next = [...inbox]
  if (duplicateIndex >= 0) {
    const duplicate = inbox[duplicateIndex]
    next[duplicateIndex] = {
      ...duplicate,
      title,
      body,
      severity:
        duplicate.severity === 'attention' || input.severity === 'attention' ? 'attention' : 'info',
      sources: duplicate.sources.includes(input.source)
        ? duplicate.sources
        : [...duplicate.sources, input.source],
      createdAt: Math.max(duplicate.createdAt, input.createdAt),
      unread: true,
      occurrences: duplicate.occurrences + 1
    }
  } else {
    next.push({
      ...normalized,
      sources: [input.source],
      unread: true,
      resolved: false,
      occurrences: 1,
      dedupeKey
    })
  }

  return next.sort(newestFirst).slice(0, NOTIFICATION_INBOX_LIMIT)
}

export function markWorkspaceNotificationsRead(
  inbox: readonly InboxNotification[],
  workspaceId: string
): InboxNotification[] {
  return inbox.map((notification) =>
    notification.workspaceId === workspaceId && notification.unread
      ? { ...notification, unread: false }
      : notification
  )
}

export function resolveNotification(
  inbox: readonly InboxNotification[],
  id: string
): InboxNotification[] {
  return inbox.map((notification) =>
    notification.id === id
      ? { ...notification, unread: false, resolved: true }
      : notification
  )
}

export function clearResolvedNotifications(
  inbox: readonly InboxNotification[]
): InboxNotification[] {
  return inbox.filter((notification) => !notification.resolved)
}

export function pendingNotifications(
  inbox: readonly InboxNotification[]
): InboxNotification[] {
  return inbox.filter((notification) => !notification.resolved).sort(newestFirst)
}

export function latestUnreadNotification(
  inbox: readonly InboxNotification[]
): InboxNotification | null {
  return [...inbox]
    .filter((notification) => notification.unread && !notification.resolved)
    .sort(newestFirst)[0] ?? null
}

export function workspaceNotificationCounts(
  inbox: readonly InboxNotification[],
  workspaceId: string
): WorkspaceNotificationCounts {
  let unread = 0
  let pending = 0
  for (const notification of inbox) {
    if (notification.workspaceId !== workspaceId || notification.resolved) continue
    pending++
    if (notification.unread) unread++
  }
  return { unread, pending }
}

export function resolveNotificationsForSubject(
  inbox: readonly InboxNotification[],
  subjectId: string
): InboxNotification[] {
  return inbox.map((notification) =>
    notification.subjectId === subjectId && !notification.resolved
      ? { ...notification, unread: false, resolved: true }
      : notification
  )
}

const notificationSources = new Set<NotificationSource>(['socket', 'osc', 'agent'])
const notificationSeverities = new Set<NotificationSeverity>(['attention', 'info'])

export function sanitizeNotificationInbox(
  raw: unknown,
  allowedWorkspaceIds: ReadonlySet<string>
): InboxNotification[] {
  if (!Array.isArray(raw)) return []
  const sanitized: InboxNotification[] = []
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue
    const item = value as Partial<InboxNotification>
    if (
      typeof item.id !== 'string' ||
      !item.id ||
      typeof item.workspaceId !== 'string' ||
      !allowedWorkspaceIds.has(item.workspaceId) ||
      (item.surfaceId !== null && typeof item.surfaceId !== 'string') ||
      (item.subjectId !== null && typeof item.subjectId !== 'string') ||
      typeof item.title !== 'string' ||
      typeof item.body !== 'string' ||
      !Array.isArray(item.sources) ||
      item.sources.length === 0 ||
      !item.sources.every((source) => notificationSources.has(source)) ||
      !notificationSeverities.has(item.severity as NotificationSeverity) ||
      typeof item.createdAt !== 'number' ||
      !Number.isFinite(item.createdAt) ||
      typeof item.unread !== 'boolean' ||
      typeof item.resolved !== 'boolean' ||
      typeof item.occurrences !== 'number' ||
      !Number.isSafeInteger(item.occurrences) ||
      item.occurrences < 1
    ) {
      continue
    }
    const normalizedInput: NotificationInput = {
      id: item.id.slice(0, 160),
      workspaceId: item.workspaceId,
      surfaceId: item.surfaceId,
      subjectId: item.subjectId,
      title: item.title,
      body: item.body,
      source: item.sources[0],
      severity: item.severity as NotificationSeverity,
      createdAt: item.createdAt
    }
    const title = normalizeText(normalizedInput.title, MAX_TITLE_LENGTH) || 'Shepherd'
    const body = normalizeText(normalizedInput.body, MAX_BODY_LENGTH) || 'Needs your attention'
    sanitized.push({
      ...normalizedInput,
      title,
      body,
      sources: [...new Set(item.sources)],
      unread: item.unread,
      resolved: item.resolved,
      occurrences: item.occurrences,
      dedupeKey: fingerprint({ ...normalizedInput, title, body })
    })
  }
  return sanitized.sort(newestFirst).slice(0, NOTIFICATION_INBOX_LIMIT)
}
