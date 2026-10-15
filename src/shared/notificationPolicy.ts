export const NOTIFICATION_POLICY_VERSION = 1 as const
export const MAX_NOTIFICATION_WORKSPACE_OVERRIDES = 128

export type DesktopNotificationMode = 'all' | 'background' | 'off'
export type WorkspaceNotificationRoute = 'desktop' | 'inbox-only'

export interface NotificationPolicy {
  version: typeof NOTIFICATION_POLICY_VERSION
  desktopMode: DesktopNotificationMode
  quietHours: {
    enabled: boolean
    startMinute: number
    endMinute: number
  }
  workspaceRoutes: Record<string, WorkspaceNotificationRoute>
}

export const DEFAULT_NOTIFICATION_POLICY: NotificationPolicy = {
  version: NOTIFICATION_POLICY_VERSION,
  desktopMode: 'all',
  quietHours: { enabled: false, startMinute: 22 * 60, endMinute: 8 * 60 },
  workspaceRoutes: {}
}

function isMinute(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1440
}

export function parseNotificationPolicy(value: unknown): NotificationPolicy | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<NotificationPolicy>
  if (candidate.version !== NOTIFICATION_POLICY_VERSION) return null
  if (!['all', 'background', 'off'].includes(candidate.desktopMode ?? '')) return null
  const quiet = candidate.quietHours
  if (
    !quiet ||
    typeof quiet.enabled !== 'boolean' ||
    !isMinute(quiet.startMinute) ||
    !isMinute(quiet.endMinute)
  )
    return null
  const routes = candidate.workspaceRoutes
  if (!routes || typeof routes !== 'object' || Array.isArray(routes)) return null
  const entries = Object.entries(routes)
  if (entries.length > MAX_NOTIFICATION_WORKSPACE_OVERRIDES) return null
  const workspaceRoutes: Record<string, WorkspaceNotificationRoute> = Object.create(null)
  for (const [id, route] of entries) {
    if (!/^ws-[a-zA-Z0-9-]{1,150}$/.test(id) || (route !== 'desktop' && route !== 'inbox-only'))
      return null
    workspaceRoutes[id] = route
  }
  return {
    version: NOTIFICATION_POLICY_VERSION,
    desktopMode: candidate.desktopMode as DesktopNotificationMode,
    quietHours: { ...quiet },
    workspaceRoutes
  }
}

export function minuteFromTimeInput(value: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(value)) return null
  const hour = Number(value.slice(0, 2))
  const minute = Number(value.slice(3, 5))
  return hour < 24 && minute < 60 ? hour * 60 + minute : null
}

export function timeInputFromMinute(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

export function quietHoursActive(
  quietHours: NotificationPolicy['quietHours'],
  localMinute: number
): boolean {
  if (!quietHours.enabled || !isMinute(localMinute)) return false
  const { startMinute, endMinute } = quietHours
  if (startMinute === endMinute) return true
  return startMinute < endMinute
    ? localMinute >= startMinute && localMinute < endMinute
    : localMinute >= startMinute || localMinute < endMinute
}

export interface NotificationRouteContext {
  workspaceId: string | null
  activeWorkspaceId: string | null
  windowFocused: boolean
  localMinute: number
}

/** The inbox is always written independently; this decision controls OS toasts only. */
export function shouldShowDesktopNotification(
  policy: NotificationPolicy,
  context: NotificationRouteContext
): boolean {
  if (quietHoursActive(policy.quietHours, context.localMinute)) return false
  const workspaceRoute = context.workspaceId
    ? policy.workspaceRoutes[context.workspaceId]
    : undefined
  if (workspaceRoute === 'inbox-only') return false
  if (workspaceRoute === 'desktop') return true
  if (policy.desktopMode === 'off') return false
  if (policy.desktopMode === 'all') return true
  return !context.windowFocused || context.workspaceId !== context.activeWorkspaceId
}

export function pruneClosedWorkspaceRoutes(
  policy: NotificationPolicy,
  openWorkspaceIds: ReadonlySet<string>
): NotificationPolicy {
  const routes = Object.entries(policy.workspaceRoutes).filter(([id]) => openWorkspaceIds.has(id))
  return routes.length === Object.keys(policy.workspaceRoutes).length
    ? policy
    : { ...policy, workspaceRoutes: Object.fromEntries(routes) }
}
