# M26 — Neutral Terminal-First Theme

## Goal

M26 introduced the semantic token boundary and removed the blue-purple dashboard
palette from Shepherd's permanent shell. M31 later coordinated those roles with
the terminal backdrop: permanent surfaces remain low-chroma, while one deliberate
blue marks selection, focus, and attention. See
[`M31-cmux-terminal-derived-theme.md`](./M31-cmux-terminal-derived-theme.md) for
the current values and complete implementation. Its final acceptance correction
keeps all Shepherd-owned interaction roles free of blue.

This milestone changes presentation boundaries only. Workspace reducers, layout
geometry, agent reports, PTY ownership, terminal links, socket automation, and
session persistence retain their existing contracts.

## The token boundary

`src/renderer/src/App.css` owns the renderer's semantic design contract in
`:root`. The important groups are:

```text
neutral surfaces  canvas → sidebar → surface → hover → raised
neutral borders   border → strong border
content           primary → secondary → muted → subdued → faint
interaction       accent, selection, focus
state             attention, danger, success, info, working, Git
geometry          3px / 4px / 6px radii, spacing, popover-only shadow
```

Components ask for roles rather than literal colors. Ordinary hover consumes a
neutral surface. The selected workspace, active terminal edge, and keyboard focus
consume distinct neutral contrast roles. A blocked agent consumes danger; working
consumes amber; idle consumes success; done consumes a subdued informational
role.

The default shell therefore has no decorative blue cards or permanent accent
rings. Its largest and highest-contrast region is still the terminal canvas.

## Semantic interaction states

M26 deliberately separates state from decoration:

- graphite means explicit selection and keyboard focus;
- green means idle/ready success;
- amber means working, waiting, or attention;
- red means blocked or failed;
- gray means Git or secondary metadata;
- repeating motion belongs only to attention and disappears under
  `prefers-reduced-motion: reduce`.

Text and accessible labels carry the same meaning, so color and animation are
never the sole state signal. A shared `button:focus-visible` and
`input:focus-visible` rule keeps every native control on the accessible focus
token instead of allowing Chromium's platform-default ring to leak through.

## Terminal colors are a separate contract

`src/renderer/src/terminalTheme.ts` exports `TERMINAL_THEME`, a frozen xterm
theme object. `TerminalHost.tsx` passes it directly to the xterm constructor.

This is intentionally not derived from the shell's CSS variables, even though
M31 coordinates the reviewed defaults from one measured visual specification:

```text
App.css semantic UI tokens ──→ React/Electron chrome
terminalTheme.ts            ──→ xterm canvas, cursor, selection
```

A later terminal-theme setting can replace the xterm object without repainting
navigation semantics. Conversely, changing a sidebar surface cannot silently
alter ANSI output, cursor visibility, or terminal selection.

## Regression coverage

`src/renderer/src/themeTokens.test.ts` reads the token boundary and component
CSS. It verifies that required roles exist and are consumed, raw colors remain
inside `:root`, every shell surface is neutral, radius geometry is restrained,
ordinary hover is neutral, semantic states own their intended roles, uppercase
navigation styling is absent, and native controls use the focus token.

The same test computes WCAG-style contrast ratios for the key foreground and
background pairs. It requires strong primary and secondary contrast, readable
muted sidebar text, and a clearly visible focus color.

`src/renderer/src/terminalTheme.test.ts` proves that the terminal theme is
frozen, complete, and independent from CSS token names. Adding the test to the
repository `npm test` chain prevents that architectural boundary from becoming
an untested convention.

## Live acceptance proof

The isolated Electron/Xvfb review covered the final post-M30 shell. Browser
assertions measured:

- canvas, sidebar, permanent surface, and terminal at `rgb(39, 40, 35)`;
- active workspace at `rgb(57, 58, 52)` with no redundant rail;
- a transparent active tab with one `rgb(82, 83, 79)` edge;
- a neutral focus token at `rgb(189, 191, 180)`;
- no duplicate product name in the sidebar toolbar; and
- a complete coordinated xterm cursor, selection, and ANSI palette.

![Current neutral terminal-derived shell](../docs/images/cmux-neutral-interactions.png)

## M31 terminal-derived refinement

The interim post-M30 correction removed every blue interaction. Research against
current cmux source and the official screenshot showed that the result missed
cmux's real organizing principle: unified terminal-derived backdrops and sparse
state contrast. Shepherd's final accepted mapping keeps that structure without
blue application chrome.

1. `App.css` maps permanent shell surfaces to the terminal's `#272823` anchor.
2. The active workspace uses one graphite fill; the active tab uses one neutral edge.
3. `terminalTheme.ts` supplies the matching background, foreground, selection,
   cursor, and full ANSI palette.
4. BrowserWindow uses the same anchor during first paint.
5. Token regressions reject backdrop drift and redundant active indicators.

## Failure behavior and boundaries

An undefined CSS variable invalidates only the declaration that consumes it, so
the structural token test catches missing or unused roles before a subtle visual
fallback reaches users. Static tokens and a frozen terminal theme add no IPC,
filesystem, process, or network authority.

Future user themes must validate a bounded set of values rather than loading
arbitrary CSS. High-contrast mappings should override semantic roles, and
terminal palettes should continue through the dedicated xterm boundary.

## Checkpoint

1. Why do permanent surfaces share a backdrop while selection uses blue?
2. Why does `TERMINAL_THEME` not read values from `App.css`?
3. Which assertions can a token test prove, and which still require visual review?
4. Why are semantic states represented by text as well as color?
5. What did the narrow and reduced-motion live checks protect against?
