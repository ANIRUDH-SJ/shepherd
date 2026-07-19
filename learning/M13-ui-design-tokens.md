# M13 — Semantic UI design tokens

## The goal

The renderer stylesheet had grown feature by feature. The same background,
border, text, and accent values were repeated across workspace rows, agent rows,
popover controls, tabs, panes, and dividers. Small visual changes therefore
required editing unrelated selectors and made semantic state colors easy to
drift.

M13 creates one vocabulary for the UI without changing React state or component
ownership. It also gives the sidebar and terminal refinement work a stable base.

## What changed

| File                                        | Responsibility                                      |
| ------------------------------------------- | --------------------------------------------------- |
| `src/renderer/src/App.css`                  | Declare and consume the semantic token system       |
| `src/renderer/src/themeTokens.test.ts`      | Enforce token presence, use, and color encapsulation |
| `package.json`                              | Run the theme regression in the full test suite     |
| `UI_REFINEMENT_PLAN.md`                     | Track the dependency-ordered UI PR series           |
| `textbook/25-semantic-ui-tokens.md`         | Teach the architecture and design decisions         |

## 1. The root token boundary

All raw color values now live in the `:root` block. Selectors consume roles such
as `--color-canvas`, `--color-text-muted`, and `--color-attention` rather than
knowing a hexadecimal value.

The tokens are grouped by purpose:

- typography: UI and terminal-friendly mono stacks;
- surfaces: canvas, sidebar, raised controls, and borders;
- content: primary through faint text emphasis;
- interaction: accent, selection, focus, and overlays;
- semantic state: working, attention, danger, success, info, and Git context;
- geometry: the spacing scale, radii, shadow, and fast transition.

This is a semantic layer, not a list of color names. `--color-danger` can change
without searching for every blocked-agent selector.

## 2. Component consumption

`App.css` now uses `var(...)` throughout the sidebar and terminal chrome. The
same border role separates the sidebar, agent section, tab bar, panes, keyboard
hints, and dividers. The same focus/accent roles cover rows, context-menu actions,
pane selection, and resize handles.

Repeated fonts and common geometry also use tokens. This keeps later component
work from inventing another 5 px radius or slightly different mono stack.

The palette moved toward calmer near-black surfaces and higher-contrast primary
text. Selection remains blue, but actionable amber/red/green/info colors now have
stable meanings.

## 3. Global interaction details

The stylesheet adds three small cross-component rules:

1. text selection blends the accent color with transparency;
2. scrollbars use the strong-border role and stay visually quiet; and
3. buttons and button-like rows share a short transition for color, background,
   border, and opacity.

The existing `prefers-reduced-motion` rule remains authoritative for repeating
attention and working animations. Short state transitions do not encode meaning
or block interaction.

## 4. The regression test

`themeTokens.test.ts` reads the stylesheet and checks three invariants:

- required semantic tokens are declared;
- every required token is actually consumed; and
- raw hexadecimal/RGB colors do not escape the `:root` boundary.

It also checks that reduced-motion support remains present. The local Node type
reference lets this renderer-adjacent test read CSS while keeping the web
TypeScript project strict.

## 5. What did not change

No component markup, reducer state, IPC, PTY behavior, socket protocol, or
dependencies changed. Design tokens are intentionally the first PR: sidebar and
terminal improvements can now reuse established roles instead of bundling a
second palette refactor into their feature diffs.

## Checkpoint

1. Why is `--color-attention` safer than a token named `--yellow-500` here?
2. Why does the regression permit raw colors in `:root` but reject them elsewhere?
3. Which UI changes belong in later PRs rather than the token foundation?
