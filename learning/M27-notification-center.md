# M27 — Notification Center and Meaningful Attention

## Goal

M27 turns Shepherd's old transient `unread` and indefinitely flashing workspace
flags into a bounded notification model. New attention gets one short ring on the
active pane. What remains is a quiet counted workspace badge and a compact pending
popover—not a permanent dashboard.

## Inbox domain model

`src/renderer/src/state/notificationInbox.ts` owns a pure collection of
`InboxNotification` records. Each record carries stable identity, workspace and
optional terminal ownership, optional lifecycle subject ownership, bounded title
and body text, source set, semantic severity, timestamp, occurrence count, and two
independent booleans:

```text
unread=true,  resolved=false  → new pending work; counted badge
unread=false, resolved=false  → seen but still pending
unread=false, resolved=true   → cleared history; no pending badge
removed                        → cleared from retained history
```

The inbox keeps at most 100 newest records. Titles are limited to 120 characters,
bodies to 500, and control/extra whitespace is normalized before storage.

## Cross-source deduplication

Socket `notify`, OSC 9/99/777, and provider blocked/done transitions all call
`addInboxNotification()`. The fingerprint combines workspace, terminal, and the
normalized meaningful body. Equivalent unresolved events inside a five-second
window retain the first id, update the latest timestamp/content, merge their
source labels, increment `occurrences`, and become unread again.

This prevents one underlying event reported by a tool hook and a terminal escape
sequence from creating two competing rows. Events outside the window remain
distinct, and resolved history is never silently resurrected as the same record.

## Reducer integration and lifecycle

`AppState.notifications` is updated only by pure `appReducer` actions:

- `receiveNotification` validates the target, inserts/deduplicates, increments a
  one-shot attention-pulse revision, and derives the workspace badge;
- `focusNotification` selects the exact workspace, pane, and terminal when the
  surface still exists, then marks only that item read;
- `markWorkspaceNotificationsRead` acknowledges every item in the current
  workspace without resolving it;
- `resolveNotification` clears one pending condition;
- `clearResolvedNotifications` removes resolved history;
- agent working/idle/clear/stale/expiry resolves notifications owned by that
  lifecycle subject; and
- terminal, pane, or workspace cleanup resolves or removes records whose targets
  no longer exist.

Selecting a workspace is navigation, not acknowledgement. This keeps unread state
stable until the user deliberately opens an item, marks the current workspace
read, or uses `Ctrl+Shift+U` to jump to the latest unread item. `Ctrl+Shift+M`
marks the current workspace read.

## Sources and process boundaries

The socket server still validates and resolves the target workspace, forwards the
command, and preserves the existing Electron desktop toast. `pty.ts` annotates OSC
notifications with their exact terminal id, source, and ingestion time before
forwarding the same command shape. It continues observing a copy of PTY output;
xterm receives the original bytes unchanged.

Provider lifecycle reports remain current-state records in `agents`, while only
meaningful blocked/done transitions produce historical notification records.
Moving back to working/idle or clearing the agent resolves its subject-owned item.

## Persistence

Notifications for the one workspace selected for startup are included in
`toLayoutSnapshot()`. `sanitizeNotificationInbox()` accepts only records owned by
that restored workspace, revalidates enums and numeric fields, re-normalizes text,
recomputes fingerprints, sorts newest first, and reapplies the 100-item limit.

Agent records, transient pulse revisions, usage, status, and derived metadata are
still reset. The restored inbox then rebuilds its counted unread marker rather than
trusting a stored workspace boolean.

## Accessible popover

`NotificationCenter.tsx` adds one bell button to the existing sidebar toolbar. It
uses an indexed workspace-name map, a labelled non-modal dialog, a labelled pending
list, native disabled actions, descriptive item labels, semantic time elements,
and a polite count status. Opening moves focus into the first notification; Escape
closes and restores focus to the bell. Pointer dismissal does not steal terminal
focus.

The popover offers jump-to-unread, mark-current-read, per-item resolve, clear
resolved, and Close actions. An empty inbox says `No notifications`; a fully
resolved inbox says `All pending notifications cleared`, so cleared and absent
state do not look identical.

## Meaningful visual signals

Each workspace row shows a small amber count, capped visually at `99+`. It remains
after the one-shot animation ends. `PaneView` remounts a pointer-transparent ring
only when `attentionPulse` increments; CSS runs exactly one 1.2-second animation.
There is no infinite flashing row. Under `prefers-reduced-motion: reduce`, the ring
is not displayed and the stable badge/text provide the equivalent signal.

## Verification

Focused tests cover bounds, ordering, text normalization, cross-source
deduplication, read/resolved/clear transitions, lifecycle resolution, target
cleanup, exact navigation, session sanitization, and restored marker derivation.

The isolated Electron review proved three populated pending items, all initially
unread; socket+OSC coalescing with `×2`; focus entering the dialog; Escape restoring
the trigger; a 340px popover without viewport overflow; jump-to-unread selecting
the exact Build workspace and terminal; explicit mark-read; five-item resolution;
the cleared and empty messages; and badge removal. The normal ring measured one
1.2-second iteration. Reduced-motion emulation measured `animation-name: none`,
`display: none`, and a surviving counted badge.

![M27 notification center with pending deduplicated items](../docs/images/notification-center.svg)

## Checkpoint

1. Why are `unread` and `resolved` separate fields?
2. Which fields form the deduplication fingerprint, and why is the window bounded?
3. Why does selecting a workspace not acknowledge its inbox automatically?
4. How does a provider lifecycle transition resolve historical attention?
5. What remains visible when reduced motion removes the pane pulse?
