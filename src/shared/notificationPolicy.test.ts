import { strict as assert } from 'node:assert'
import {
  DEFAULT_NOTIFICATION_POLICY,
  minuteFromTimeInput,
  parseNotificationPolicy,
  pruneClosedWorkspaceRoutes,
  quietHoursActive,
  shouldShowDesktopNotification,
  timeInputFromMinute
} from './notificationPolicy'

const workspaceId = 'ws-123'
const context = {
  workspaceId,
  activeWorkspaceId: workspaceId,
  windowFocused: true,
  localMinute: 12 * 60
}
assert.equal(shouldShowDesktopNotification(DEFAULT_NOTIFICATION_POLICY, context), true)
assert.equal(
  shouldShowDesktopNotification(
    { ...DEFAULT_NOTIFICATION_POLICY, desktopMode: 'background' },
    context
  ),
  false
)
assert.equal(
  shouldShowDesktopNotification(
    { ...DEFAULT_NOTIFICATION_POLICY, desktopMode: 'background' },
    { ...context, windowFocused: false }
  ),
  true
)
assert.equal(
  shouldShowDesktopNotification(
    {
      ...DEFAULT_NOTIFICATION_POLICY,
      desktopMode: 'off',
      workspaceRoutes: { [workspaceId]: 'desktop' }
    },
    context
  ),
  true
)
assert.equal(
  shouldShowDesktopNotification(
    { ...DEFAULT_NOTIFICATION_POLICY, workspaceRoutes: { [workspaceId]: 'inbox-only' } },
    context
  ),
  false
)
const quiet = { enabled: true, startMinute: 22 * 60, endMinute: 8 * 60 }
assert.equal(quietHoursActive(quiet, 23 * 60), true)
assert.equal(quietHoursActive(quiet, 7 * 60), true)
assert.equal(quietHoursActive(quiet, 12 * 60), false)
assert.equal(quietHoursActive({ ...quiet, startMinute: 9 * 60, endMinute: 17 * 60 }, 12 * 60), true)
assert.equal(quietHoursActive({ ...quiet, startMinute: 9 * 60, endMinute: 9 * 60 }, 12 * 60), true)
assert.equal(
  shouldShowDesktopNotification(
    {
      ...DEFAULT_NOTIFICATION_POLICY,
      quietHours: quiet,
      workspaceRoutes: { [workspaceId]: 'desktop' }
    },
    { ...context, localMinute: 23 * 60 }
  ),
  false
)
assert.equal(minuteFromTimeInput('22:30'), 1350)
assert.equal(minuteFromTimeInput('24:00'), null)
assert.equal(timeInputFromMinute(8 * 60 + 5), '08:05')
assert.equal(parseNotificationPolicy(DEFAULT_NOTIFICATION_POLICY)?.desktopMode, 'all')
assert.equal(parseNotificationPolicy({ ...DEFAULT_NOTIFICATION_POLICY, version: 2 }), null)
assert.equal(
  parseNotificationPolicy({
    ...DEFAULT_NOTIFICATION_POLICY,
    workspaceRoutes: { 'bad-id': 'desktop' }
  }),
  null
)
assert.equal(
  parseNotificationPolicy({
    ...DEFAULT_NOTIFICATION_POLICY,
    quietHours: { ...quiet, endMinute: 1440 }
  }),
  null
)
const withClosedRoute = {
  ...DEFAULT_NOTIFICATION_POLICY,
  workspaceRoutes: { [workspaceId]: 'desktop' as const, 'ws-closed': 'inbox-only' as const }
}
assert.deepEqual(
  pruneClosedWorkspaceRoutes(withClosedRoute, new Set([workspaceId])).workspaceRoutes,
  { [workspaceId]: 'desktop' }
)
console.log('✅ ALL NOTIFICATION POLICY TESTS PASS')
