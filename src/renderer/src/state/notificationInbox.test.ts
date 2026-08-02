import {
  NOTIFICATION_DEDUPE_WINDOW_MS,
  NOTIFICATION_INBOX_LIMIT,
  addInboxNotification,
  clearResolvedNotifications,
  latestUnreadNotification,
  markWorkspaceNotificationsRead,
  pendingNotifications,
  resolveNotification,
  workspaceNotificationCounts,
  type InboxNotification,
  type NotificationInput
} from './notificationInbox'

let failures = 0
function assert(condition: unknown, label: string): void {
  if (condition) console.log(`  ok: ${label}`)
  else {
    console.error(`FAIL: ${label}`)
    failures++
  }
}

function input(overrides: Partial<NotificationInput> = {}): NotificationInput {
  return {
    id: 'notice-1',
    workspaceId: 'ws-1',
    surfaceId: 'term-1',
    title: 'Build',
    body: 'Waiting for approval',
    source: 'socket',
    severity: 'attention',
    createdAt: 1_000,
    ...overrides
  }
}

let inbox: InboxNotification[] = []
inbox = addInboxNotification(inbox, input())
assert(inbox.length === 1, 'adds one notification')
assert(inbox[0].unread, 'a new notification is unread')
assert(!inbox[0].resolved, 'a new notification is unresolved')
assert(inbox[0].occurrences === 1, 'a new notification has one occurrence')

inbox = addInboxNotification(
  inbox,
  input({ id: 'notice-2', title: 'Terminal', source: 'osc', createdAt: 1_500 })
)
assert(inbox.length === 1, 'deduplicates equivalent socket and OSC events')
assert(inbox[0].id === 'notice-1', 'deduplication retains stable identity')
assert(inbox[0].occurrences === 2, 'deduplication records occurrence count')
assert(inbox[0].sources.join(',') === 'socket,osc', 'deduplication records every source')

inbox = markWorkspaceNotificationsRead(inbox, 'ws-1')
assert(!inbox[0].unread && !inbox[0].resolved, 'reading preserves unresolved state')
inbox = addInboxNotification(
  inbox,
  input({ id: 'notice-3', source: 'agent', createdAt: 1_800 })
)
assert(inbox[0].unread, 'a repeated unresolved event becomes unread again')
assert(inbox[0].sources.includes('agent'), 'agent lifecycle can deduplicate with another source')

inbox = addInboxNotification(
  inbox,
  input({ id: 'notice-late', createdAt: 1_000 + NOTIFICATION_DEDUPE_WINDOW_MS + 1 })
)
assert(inbox.length === 2, 'an event outside the deduplication window stays distinct')
assert(inbox[0].id === 'notice-late', 'the inbox is newest first')

inbox = resolveNotification(inbox, 'notice-late')
assert(inbox[0].resolved && !inbox[0].unread, 'resolving also acknowledges a notification')
assert(pendingNotifications(inbox).length === 1, 'pending excludes resolved notifications')
assert(latestUnreadNotification(inbox)?.id === 'notice-1', 'finds the newest unread pending item')
assert(
  workspaceNotificationCounts(inbox, 'ws-1').pending === 1 &&
    workspaceNotificationCounts(inbox, 'ws-1').unread === 1,
  'derives workspace pending and unread counts'
)
inbox = clearResolvedNotifications(inbox)
assert(inbox.length === 1 && inbox[0].id === 'notice-1', 'clears only resolved history')

const unsafe = addInboxNotification(
  [],
  input({ title: `\u0000${'T'.repeat(200)}`, body: `line\n${'B'.repeat(800)}` })
)[0]
assert(!unsafe.title.includes('\u0000') && unsafe.title.length <= 120, 'bounds notification titles')
assert(!unsafe.body.includes('\n') && unsafe.body.length <= 500, 'normalizes and bounds bodies')

let bounded: InboxNotification[] = []
for (let index = 0; index < NOTIFICATION_INBOX_LIMIT + 8; index++) {
  bounded = addInboxNotification(
    bounded,
    input({
      id: `bounded-${index}`,
      body: `event-${index}`,
      createdAt: 10_000 + index
    })
  )
}
assert(bounded.length === NOTIFICATION_INBOX_LIMIT, 'keeps a hard inbox limit')
assert(bounded[0].id === `bounded-${NOTIFICATION_INBOX_LIMIT + 7}`, 'keeps newest records')
assert(bounded.at(-1)?.id === 'bounded-8', 'drops oldest records first')

console.log(
  failures === 0 ? '\n✅ ALL NOTIFICATION INBOX TESTS PASS' : `\n❌ ${failures} FAILURE(S)`
)
if (failures > 0) throw new Error(`${failures} notification inbox test(s) failed`)
