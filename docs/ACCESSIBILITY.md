# Accessibility Notes

Shepherd's workbench is designed for keyboard operation and semantic state
communication. This document describes current behavior rather than a future
conformance claim.

## Keyboard paths

- Global shortcuts create workspaces, tabs, and splits; toggle the rail; open
  settings, help, search, and the command palette; and navigate unread work.
- Workspace rows support Arrow keys, Home, End, Enter, Space, and F2.
- Focused terminal tabs support Left, Right, Home, End, and Delete.
- Dialogs, menus, the notification center, terminal search, and the workspace
  inspector close with Escape and restore their opening focus where appropriate.
- Selecting an Attention or inspector agent item moves focus into that agent's
  actual xterm input, not merely its surrounding pane.

The complete global shortcut table is in the main [README](../README.md#keyboard-and-mouse).

## Names and roles

Workspaces, panes, tab lists, tabs, panels, dialogs, menus, search forms, buttons,
and inspector sections expose native or ARIA roles and accessible names. Tab and
panel identifiers are stable per surface. Icon-only controls carry action names
and tooltips.

The workspace inspector is a labelled non-modal dialog. Its initial focus lands
on the close control. Escape closes it; ordinary close restores the opener,
while preview and agent actions intentionally hand focus to their destination.

## State is not color-only

Workspace rows use words such as `needs you`, `working`, `waiting`, `finished`,
and `quiet`. Attention items state the provider, workspace, semantic state, and
detail in their accessible label. Blocked and completed states use distinct color
markers as a secondary cue.

Focus uses a dedicated high-contrast semantic token. Active workspaces and panes
have both structural and color cues. Empty, loading, unavailable, and error
states use text rather than an unlabeled spinner or decorative status graph.

## Readability and scaling

Application controls use system UI typography; terminal and technical data use a
monospace stack. Dark and light token tests check primary, secondary, muted, and
focus contrast. The terminal font can be adjusted with Settings or
`Ctrl+Shift+=`, `Ctrl+Shift+-`, and `Ctrl+Shift+0`.

The workbench and inspector avoid document-level horizontal overflow at narrow
window sizes. The interface has also been exercised at 200% page scale; scrollable
dialogs and inspector content remain reachable.

## Motion

Shepherd honors `prefers-reduced-motion`. There are no continuous attention
animations, glow effects, decorative charts, or fake progress indicators. The
only pane-attention animation is brief and event-triggered.

## Known platform behavior

Terminal content is rendered by xterm.js, so terminal application accessibility
depends partly on xterm's screen-reader behavior and on the application running
inside the PTY. Electron webviews used for localhost previews are separate guest
documents and expose the accessibility tree of the previewed local page.
