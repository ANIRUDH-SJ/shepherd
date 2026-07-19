# M15 — Terminal tabs, pane focus, and workspace context

## The goal

The terminal area supported tabs and splits, but its controls were mouse-first.
Tabs were clickable `div` elements, selecting a tab by keyboard would not
activate its pane, split actions used font-dependent glyphs, and a single pane
showed close actions that silently did nothing. Workspace identity also vanished
when the sidebar was collapsed.

M15 makes the existing terminal model understandable and keyboard-operable
without changing PTY ownership or the layout tree.

## What changed

| File                                            | Responsibility                                          |
| ----------------------------------------------- | ------------------------------------------------------- |
| `src/renderer/src/terminalChrome.ts`            | Tab navigation, DOM ids, and context summaries          |
| `src/renderer/src/state/workspaceReducer.ts`    | Activate the owning pane with a selected tab            |
| `src/renderer/src/components/TabBar.tsx`        | Semantic tabs and pane controls                         |
| `src/renderer/src/components/TerminalHost.tsx`  | Link visible terminal panels to their tabs              |
| `src/renderer/src/components/WorkspaceView.tsx` | Render the context strip and numbered panes             |
| `src/renderer/src/components/PaneView.tsx`      | Expose pane identity and close capability               |
| `src/renderer/src/components/Icon.tsx`          | Draw terminal and split controls locally                |
| `src/renderer/src/App.css`                      | Style hierarchy, focus, actions, and responsive context |

## 1. Tab keyboard model

`tabNavigationTarget()` is a pure circular-navigation helper. Left and Right
move between adjacent surface ids and wrap at either end. Home and End select the
first and last ids. Other keys return no target.

`TabBar` renders a labelled `tablist`. Each surface gets a real button with
`role="tab"`, `aria-selected`, an `aria-controls` link, and roving `tabIndex`: only
the active tab is in the normal Tab sequence. After an arrow/Home/End selection,
the component focuses the newly active tab on the next animation frame.

New-tab and pane-action buttons are siblings of the tablist, so unrelated
controls are not announced as tabs. Tab close remains attached visually to its
tab and has a complete accessible label.

## 2. Matching pointer and keyboard state

Mouse events already reached `PaneView`'s capture handler before a tab stopped
propagation, which made the clicked pane active. Keyboard events have no mouse
capture path.

The `setActiveSurface` reducer case now validates the pane, updates that pane's
active surface, and assigns `activePaneId` in one transition. This makes socket,
keyboard, and pointer selection agree. `workspaceReducer.test.ts` proves both the
successful transition and the fail-closed invalid-pane case.

## 3. Tab panels and xterm

`terminalTabId()` and `terminalPanelId()` derive stable DOM ids from generated
surface ids. `TerminalHost` renders `role="tabpanel"`, points back with
`aria-labelledby`, and uses the native `hidden` attribute for inactive panels.

This does not destroy a terminal. Every `TerminalHost` remains mounted, its xterm
and PTY remain alive, and the existing active effect refits the terminal when it
becomes visible again.

## 4. Workspace context strip

`App` passes the workspace position into `WorkspaceView`, which reuses the M14
`workspaceIdentity()` rule. A compact strip now shows:

- custom name or live project, with positional/project context;
- Git branch or explicit `No Git`; and
- the active `Pane N · Terminal N` label.

The focus label comes from `terminalContextSummary()`. Its title contains total
pane and terminal counts. Full identity, context, cwd, and branch remain in
titles when visible text truncates. Narrow windows hide secondary context before
primary identity or Git state.

## 5. Pane and action hierarchy

`WorkspaceView` numbers panes in computed layout order and tells every `PaneView`
whether another pane exists. `PaneView` exposes that number as an accessible
group label and passes close capability to `TabBar`.

The last pane and its last terminal cannot be closed by the reducer, so their
buttons are now disabled and explain why. When more panes or tabs exist, the
same controls become enabled. Split-right, split-down, terminal, and close icons
come from the closed local SVG set.

CSS distinguishes two selection levels:

- every pane marks its active tab with a short underline;
- only the workspace's active pane gets the accent border/top edge.

Pane actions remain faintly visible, grow clear on pane hover, and become fully
visible under `:focus-within`. Focus outlines do not depend on hover or color
fills.

## Verification

`terminalChrome.test.ts` covers wrapping, Home/End, ignored keys, DOM ids,
context focus, counts, pluralization, and empty input. The reducer regression
covers keyboard state parity. Existing layout and theme tests protect geometry
and the semantic CSS boundary.

Live Electron smoke testing covered a fresh single pane and a three-pane nested
right/down split at 1100×720. It verified context renumbering, enabled/disabled
close states, active-pane/tab distinction, dividers, xterm fitting, and shell
focus.

No main-process, preload, IPC, socket, persistence, discovery, or PTY protocol
changed.

## Checkpoint

1. Why must `setActiveSurface` also select its owning pane?
2. How does roving `tabIndex` keep a large tab list keyboard-efficient?
3. Why does `hidden` not destroy the inactive xterm instance?
4. Which visual signal belongs to an active tab versus an active pane?
