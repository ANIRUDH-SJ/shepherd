# 27 — Designing accessible terminal tabs and pane chrome

A split terminal has two nested selection systems: the active pane among many
rectangles and the active tab inside each pane. Good chrome must communicate both
levels, support pointer and keyboard input consistently, and avoid stealing space
or attention from terminal content.

## 1. Model the two selection levels

Consider a workspace with three panes and two tabs per pane:

```text
workspace.activePaneId
  -> pane.activeSurfaceId
       -> terminal panel
```

The active pane answers “where will workspace-level actions apply?” Each pane's
active surface answers “which terminal is visible in this rectangle?” Inactive
panes still have active tabs; they simply do not own workspace focus.

Using one visual treatment for both levels makes the interface ambiguous. A
small underline is enough for the visible tab in every pane. A stronger border
or top edge identifies the one active pane.

## 2. Use the ARIA tabs contract

The semantic relationship has three parts:

```text
tablist
  tab aria-selected=true aria-controls=panel-id
  tab aria-selected=false aria-controls=other-panel-id

tabpanel id=panel-id aria-labelledby=tab-id
```

These roles do not add behavior by themselves. They expose the relationship to
assistive technology; application code must still change state, visibility, and
focus.

Controls such as “new tab,” “split right,” and “close pane” are not tabs. Keep
them beside the tablist rather than giving the entire toolbar `role="tablist"`.
This prevents a screen reader from treating unrelated actions as navigation
choices.

## 3. Roving tabindex

If every tab has `tabIndex=0`, pressing Tab walks through every terminal before
reaching the next control. The standard tabs pattern uses a roving tab stop:

- active tab: `tabIndex=0`;
- inactive tabs: `tabIndex=-1`;
- Left/Right: move and wrap;
- Home/End: jump to the boundary.

After state changes, focus moves to the selected tab. This creates one Tab stop
for the whole set while keeping every tab programmatically focusable.

A pure navigation function should operate on ordered ids, not DOM nodes. That
makes wrap behavior testable and leaves React responsible only for dispatch and
focus timing.

## 4. Keep pointer and keyboard transitions equivalent

Pointer input often activates a pane through a parent capture handler before a
child tab handles its own event. A keyboard event on the same tab bypasses mouse
capture entirely. If tab selection updates only `activeSurfaceId`, keyboard users
can see one terminal while workspace commands still target another pane.

The durable fix belongs in state semantics:

```text
select surface(paneId, surfaceId)
  validate pane
  select surface in pane
  set activePaneId = paneId
```

Centralizing the invariant makes pointer, keyboard, automation, and future
command-palette paths agree. Repeating a second “activate pane” dispatch in one
component would fix only that caller and create an observable intermediate state.

## 5. Preserve terminal lifetime

An inactive terminal should be hidden, not unmounted. Unmounting disposes xterm,
kills the PTY through cleanup, loses scrollback, and changes process identity.

The HTML `hidden` attribute removes a panel from layout and the accessibility
tree while React keeps the component mounted. When the panel becomes active,
xterm must be refitted because its previous hidden width and height were zero.
The application then resizes the PTY so shell rows and columns match the canvas.

This is why terminal tab visibility is operational behavior, not merely CSS.

## 6. Context that survives a collapsed sidebar

Users frequently collapse a sidebar to maximize terminal width. A thin context
strip can preserve the minimum orientation information:

- workspace/project identity;
- Git branch or explicit non-Git state;
- active pane and terminal numbers.

This repeats some sidebar data intentionally. Redundancy is useful when the main
source can be hidden and the repeated form is compact. The strip should not grow
into another toolbar: full paths, counts, and explanations can remain in titles.

At narrow widths, remove secondary positional context before project identity or
Git state. Flex children that truncate need `min-width: 0`; otherwise a long
branch can push the active-terminal label off screen.

## 7. Discoverable actions without permanent noise

Pane actions are low-frequency compared with typing. Fully opaque controls in
every split create a grid of repeated icons. Completely hidden controls are hard
to discover and disappear for keyboard users.

A balanced rule is:

```text
inactive/resting pane -> actions faintly visible
active pane           -> actions moderately visible
pane hover/focus      -> actions fully visible
```

Use `:focus-within` alongside hover so tabbing to any pane control reveals the
whole group. Every icon-only button still needs a title and accessible label.
Opacity is presentation only; controls remain in the keyboard order.

## 8. Disable impossible actions

If the reducer refuses to close the final pane, an enabled button that silently
does nothing lies about capability. Native `disabled` communicates the state to
the browser, assistive technology, pointer input, and keyboard input together.

The capability rule is derived from current structure:

```text
can close pane     = workspace has more than one pane
can close surface  = pane has more than one tab OR pane can close
```

The disabled title should explain the invariant. Do not rely only on low opacity,
because color/opacity alone does not expose semantics.

## 9. Stable numbering and derived labels

Pane and terminal numbers are presentation values derived from layout order.
They are easy to scan but change after closing or restructuring the tree. Stable
ids remain the keys for reducers, PTYs, DOM relationships, and socket targeting.

This separation prevents visible numbering from becoming persistent identity.
The context helper can safely return `Pane 3 · Terminal 3` while the state keeps
opaque generated ids.

## 10. Layout boundary

The workspace context strip changes the available pane rectangle. The correct
structure is a column:

```text
workspace view (flex column)
  context strip (fixed height)
  pane layer (flexes, position: relative)
```

Pane percentages and dividers remain relative to the pane layer, not the entire
window. This preserves the tiling algorithm; no geometry formulas need to know
about the strip height.

## 11. Security and failure handling

Terminal chrome adds no OS, filesystem, network, IPC, or PTY authority. DOM ids
derive only from application-generated surface ids. Icons come from a closed
static union. Workspace/path/branch strings are rendered as React text and native
titles, not HTML or CSS.

Navigation helpers return no target for unknown keys or empty lists. Reducer
selection validates the pane and returns the original state for an invalid id.
These fail-closed rules avoid moving focus to a nonexistent panel or storing an
invalid active pane.

## 12. Testing strategy

Pure tests should cover:

- Left/Right wrap and Home/End boundaries;
- non-navigation keys and empty lists;
- tab/panel id agreement;
- surface selection activating its pane;
- invalid target rejection;
- pane/terminal label numbering and pluralization.

Visual smoke tests complement them with split geometry, focus hierarchy, icon
alignment, truncation, enabled/disabled states, xterm fitting, and narrow-window
behavior. A single-pane case and a nested multi-pane case exercise different
capability and layout paths.

## 13. Alternatives and tradeoffs

A generic tab component library could supply keyboard behavior, but integrating
close buttons, xterm lifetime, and pane capture would still require custom state
work. Keeping all actions permanently bright is simpler but visually overwhelms
dense splits. Hiding actions completely is cleaner but harms discovery.

A breadcrumb inside every pane would repeat workspace context excessively. One
workspace-level strip preserves orientation without reducing each terminal's
vertical area independently.

The chosen design adds explicit DOM and focus code, but keeps runtime contracts
unchanged and makes interaction semantics testable.

## Checkpoint

1. What is the difference between an active pane and an active tab?
2. Why should the reducer, rather than only React, enforce pane activation?
3. What does roving `tabIndex` improve?
4. Why must a newly visible xterm be refitted?
5. When is redundant workspace context justified?
