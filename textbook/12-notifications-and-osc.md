# Chapter 12 — Notifications, OSC, and the bounded inbox

Notifications connect terminal output, local automation, provider lifecycle state,
desktop toasts, and renderer interaction. The hard part is not drawing a bell. It
is giving several producers one bounded state model without corrupting PTY output,
duplicating the same event, or turning every workspace into a flashing dashboard.

This chapter describes the implementation completed in M27.

## 12.1 The three producers

Shepherd accepts meaningful notification events from three paths:

1. An explicit `shepherd notify` request crosses the local Unix socket.
2. A program inside a PTY emits OSC 9, 99, or 777.
3. A provider lifecycle report changes an agent to `blocked` or `done`.

They have different transport and authority, but converge on
`addInboxNotification()` in the renderer's pure state layer.

```text
shepherd notify ─→ socket validation ─────────────┐
                                                  │
PTY bytes ─→ copy-only OSC scan ─→ SocketApply ──┼─→ receiveNotification
                                                  │       │
agent-report ─→ normalize/authorize ─→ reducer ───┘       ▼
                                             bounded InboxNotification[]
                                                       │
                  ┌────────────────────────────────────┼────────────────────┐
                  ▼                                    ▼                    ▼
          counted workspace badge            pending popover       one-shot pane ring
```

The socket and OSC paths can also produce an Electron desktop toast in main.
Native toasts are an output side effect; they do not own inbox state.

## 12.2 OSC is an inline terminal protocol

An Operating System Command begins with `ESC ]`, contains a numeric command and
payload, and ends with BEL or ST:

```text
ESC ] 9 ; Build complete BEL
ESC ] 777 ; notify ; Build ; Complete ST
ESC ] 99 ; metadata ; Complete ST
```

Shepherd recognizes:

| Code    | Shape                       | Result                            |
| ------- | --------------------------- | --------------------------------- |
| OSC 9   | `9;<body>`                  | title `Terminal`, payload as body |
| OSC 777 | `777;notify;<title>;<body>` | explicit title and body           |
| OSC 99  | `99;<metadata>;<body>`      | metadata ignored, body retained   |

Other OSC commands remain terminal data. OSC 8 hyperlinks, OSC 0 titles, colors,
clipboard commands, and unsupported 777 subcommands do not become notifications.

## 12.3 Observe PTY output; never consume it

`src/main/pty.ts` sends every PTY output batch to xterm unchanged. It also passes
a copy of the text through `parseOsc()`:

```text
node-pty output
  ├─→ bounded output queue → IPC → xterm.write(original bytes)
  └─→ parseOsc(previous tail + current chunk)
          ├─ complete notification records
          └─ incomplete bounded tail for the next chunk
```

This is an observation boundary. Stripping the OSC sequence would change what the
terminal emulator receives and could break protocols xterm understands better
than Shepherd. Reordering or delaying bytes would also violate the terminal output
flow described in Chapter 31.

Each terminal record owns its own OSC tail because escape sequences can be split
across arbitrary `onData` chunks. The parser accepts BEL and ST terminators,
handles multiple sequences in one chunk, ignores unrelated OSC, and caps the
unterminated tail at 8192 characters. The cap prevents a stray introducer in
binary output from retaining unbounded memory.

When a notification is found, `sniffOsc()` forwards:

```ts
{
  method: 'notify',
  workspaceId,
  params: {
    title,
    body,
    surfaceId,
    notificationSource: 'osc',
    createdAt
  }
}
```

The exact surface id makes later navigation precise.

## 12.4 Socket and desktop boundaries

`src/main/socket.ts` resolves a requested workspace against the renderer mirror
before forwarding `notify`. The socket is local, but payload text is still
untrusted. The renderer therefore normalizes and bounds it before retention.

Main preserves the existing native-toast behavior:

```text
if Electron Notification is supported
  → show title/body through the OS notification service
otherwise
  → continue with the in-app event
```

An unsupported desktop notification service does not reject the socket request or
drop the in-app notification. Inbox state is renderer-owned because it must update
atomically with workspace navigation and agent lifecycle reducers.

## 12.5 Inbox record and invariants

`src/renderer/src/state/notificationInbox.ts` defines the collection:

```ts
interface InboxNotification {
  id: string
  workspaceId: string
  surfaceId: string | null
  subjectId: string | null
  title: string
  body: string
  sources: Array<'socket' | 'osc' | 'agent'>
  severity: 'attention' | 'info'
  createdAt: number
  unread: boolean
  resolved: boolean
  occurrences: number
  dedupeKey: string
}
```

The invariants are:

- no more than 100 newest records;
- title length at most 120 characters;
- body length at most 500 characters;
- ASCII control characters become spaces and whitespace collapses;
- records are sorted newest first;
- source and severity values come from closed enums;
- occurrence counts are positive safe integers; and
- every retained record belongs to a live or restored workspace.

The limit bounds memory, serialization cost, rendering work, and hostile input.
One item cannot retain arbitrary terminal output.

## 12.6 Read, unresolved, resolved, and removed

Reading and resolving answer different questions:

| State               | Meaning                  | Visible in pending list | Counted unread |
| ------------------- | ------------------------ | ----------------------- | -------------- |
| unread + unresolved | new pending work         | yes                     | yes            |
| read + unresolved   | seen, still pending      | yes                     | no             |
| read + resolved     | condition cleared        | no                      | no             |
| removed             | resolved history cleared | no                      | no             |

Navigation alone is not acknowledgement. Selecting a workspace leaves its inbox
unchanged. Opening a specific item marks that item read. “Mark current read”
acknowledges all pending items owned by the active workspace without claiming the
work is resolved.

This separation avoids two failure modes: an accidental workspace click cannot
erase unseen work, and merely reading an approval request cannot pretend the
approval is complete.

## 12.7 Cross-source deduplication

Socket, OSC, and provider hooks can describe the same underlying event. The inbox
fingerprint uses:

```text
workspaceId + surfaceId + normalized(body || title)
```

An unresolved match within five seconds is updated instead of appended:

- the original id remains stable;
- the newest title, body, and timestamp win;
- unique sources are merged;
- severity escalates to attention if either event requests it;
- `occurrences` increments; and
- the record becomes unread again.

The window is intentionally short. It coalesces concurrent reports while allowing
a repeated event later in a workflow to remain a distinct occurrence. Resolved
history is not resurrected as the old record.

A provider and an OSC event can deduplicate when they own the same workspace,
surface, and meaningful body. Events for different terminals never collapse just
because their text matches.

## 12.8 Provider lifecycle resolution

Agent state and notification history have different jobs:

- `AgentRecord` answers “what is this agent doing now?”
- `InboxNotification` answers “what meaningful attention event happened?”

Only changed `blocked` and `done` reports create inbox input. The agent id becomes
`subjectId`. A later working, idle, unknown, clear, stale, or expiry transition
resolves every unresolved item for that subject.

Stale sequence revisions are rejected before notification creation, so an old
provider report cannot re-open an inbox item. Reporter source ownership and exact
workspace/surface validation remain the same as Chapter 19.

Terminal exit resolves subject and surface-owned items. Closing a pane resolves
items for removed surfaces. Closing a workspace removes its inbox history because
there is no remaining navigation target.

## 12.9 Reducer integration and exact navigation

`AppState` owns `notifications` beside workspaces and agents. The important
actions are:

| Action                           | Result                                                                      |
| -------------------------------- | --------------------------------------------------------------------------- |
| `receiveNotification`            | validate target, insert/deduplicate, derive badge, increment pulse revision |
| `focusNotification`              | select exact workspace/pane/surface and mark one item read                  |
| `markWorkspaceNotificationsRead` | mark current workspace items read                                           |
| `resolveNotification`            | mark one item resolved and read                                             |
| `clearResolvedNotifications`     | remove resolved history                                                     |

`workspaceNotificationCounts()` derives badge state from the collection. Stored
workspace booleans are not trusted as the source of truth.

Exact focus reuses the existing pure layout lookup and `workspaceReducer` actions.
If a persisted or external item lacks a valid surface, the notification can still
select its workspace. It never invents a pane id. After React selects a valid
surface, a renderer event returns keyboard focus to the owning xterm.

Global shortcuts are deliberately outside terminal Ctrl-only bindings:

- `Ctrl+Shift+U` jumps to the newest unread pending item.
- `Ctrl+Shift+M` marks the active workspace read.

## 12.10 Safe persistence

Shepherd still restores one workspace at startup. Its layout snapshot now includes
only notifications owned by that selected workspace.

`sanitizeNotificationInbox()` treats disk data as untrusted. It:

1. requires an array;
2. skips malformed records;
3. rejects records for other workspace ids;
4. validates source, severity, timestamps, flags, and occurrence counts;
5. bounds and normalizes text;
6. recomputes the deduplication key rather than trusting disk;
7. sorts newest first; and
8. reapplies the 100-record limit.

Agent state, usage, status, live attention, pulse revisions, and derived metadata
still reset. After sanitization, unread workspace markers are re-derived from the
restored collection.

Persisting pending work prevents a restart from silently losing an approval or
completion notice. Restricting it to the one restored workspace preserves the
application's single-workspace startup contract.

## 12.11 Accessible compact presentation

`NotificationCenter.tsx` adds one bell to the existing sidebar toolbar. The
popover is a labelled, non-modal dialog containing:

- a polite unread/pending count;
- Jump to unread and Mark current read;
- a labelled pending list;
- one descriptive focus button and one resolve button per item;
- a distinct cleared-state message;
- Clear resolved and Close actions.

Opening focuses the first actionable notification. Escape closes and restores
focus to the bell. Outside pointer dismissal closes without forcing focus away
from the terminal. Native buttons expose disabled state to assistive technology.

Workspace labels are indexed in a memoized map rather than searched once per
notification. The list is still bounded at 100, but the lookup map makes render
cost linear and keeps the component easy to extend.

The popover is 340px at normal size and clamps to the viewport. Its list scrolls
inside a viewport-bounded container, so many items do not push controls off-screen.

## 12.12 Meaningful attention without permanent motion

A new attention event increments `Workspace.attentionPulse`. Only the active pane
receives an overlay keyed by that revision. Remounting the overlay restarts one
1.2-second animation:

```text
new event → revision changes → overlay remounts
          → one amber inset pulse → transparent
```

The overlay is pointer-transparent and absolutely positioned, so it cannot move
terminal geometry, capture selection, or block links. No workspace row animates
indefinitely.

After the pulse, the counted amber badge remains. Under
`prefers-reduced-motion: reduce`, the ring has `animation: none` and
`display: none`; the count, text, and accessible label retain the signal.

## 12.13 Failure handling and tradeoffs

- If a workspace does not exist, reducer input is ignored.
- If a requested surface no longer exists, socket input degrades to workspace
  ownership; cleanup resolves retained stale targets.
- If desktop notifications are unsupported, the inbox still works.
- If persisted data is partially corrupt, valid owned records survive and invalid
  records are skipped.
- If producers repeat the same event after five seconds, users see two items. This
  favors not losing independent work over aggressive fuzzy merging.
- Renderer ownership means a renderer crash can lose unsaved events inside the
  session-save debounce. Moving the inbox to main would reduce that window but
  would duplicate navigation/lifecycle coordination and require a new IPC protocol.
- A 100-item cap can evict old unresolved work during extreme spam. The bound is
  explicit and testable; a future archive would need separate storage and UX.

Alternatives considered included an unbounded array, one boolean per workspace,
main-process-only state, fuzzy text similarity, and repeating animation. The
chosen design is deterministic, bounded, pure, accessible, and consistent with
the terminal-first shell.

## 12.14 Verification strategy

Headless tests cover:

- OSC formats, split chunks, multiple sequences, ignored commands, and tail bounds;
- inbox ordering, limits, text normalization, source merging, deduplication windows,
  read/resolved/clear transitions, subject resolution, and restore sanitization;
- reducer target validation, exact focus, lifecycle ordering, cleanup, and
  single-workspace persistence;
- semantic token ownership, one bounded ring iteration, and no infinite animation.

The isolated Electron review covers what structural tests cannot:

- no-notification, stable unread, populated, resolved, and cleared states;
- keyboard focus entering the dialog and Escape returning it;
- disabled actions and screen-reader labels;
- exact jump to workspace and terminal;
- a 340px popover without viewport overflow;
- one 1.2-second normal animation; and
- reduced motion with no ring and a surviving stable badge.

## Checkpoint

1. Why must the OSC scanner observe rather than strip PTY bytes?
2. Why are unread and unresolved independent?
3. What prevents equivalent socket and OSC events from producing duplicate rows?
4. Why is the deduplication window short and the inbox hard-bounded?
5. Which fields are revalidated during session restore?
6. How does a notification jump preserve exact terminal ownership?
7. What replaces the visual signal when reduced motion disables the ring?
