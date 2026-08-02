# 25 — Semantic design tokens for a desktop terminal UI

Design tokens are named values that sit between design intent and component CSS.
They turn “this exact blue” into “the selection role” and “6 pixels” into “the
medium radius.” That indirection matters in a terminal application because many
compact controls must communicate hierarchy without competing with terminal
content.

## 1. The problem with literal styling

A stylesheet that repeats literals is valid CSS:

```css
.workspace:hover {
  background: #1d1f27;
}
.agent:hover {
  background: #1d1f27;
}
.tab:hover {
  background: #1d1f27;
}
```

The problem is ownership. Each component now owns a copy of a design decision.
Changing the hover surface means finding every copy, and a new component can pick
a value that is almost—but not quite—the same.

Repeated colors create a second problem: identical values do not always mean
identical roles. A blue used for focus, selection, information, and completion
cannot be changed safely as one global search-and-replace.

## 2. Semantic tokens versus primitive tokens

Primitive tokens describe a value:

```css
--blue-500: #6d9eff;
--gray-900: #101010;
```

Semantic tokens describe intent:

```css
--color-sidebar: #101010;
--color-focus: #8db5ff;
--color-selection: #1f4678;
--color-info: #6c9ee8;
```

Shepherd uses semantic tokens directly because the UI is still one dark theme.
A larger multi-theme system could add primitives underneath and map semantic
roles to different primitives per theme.

The crucial rule is that components consume semantic roles. A blocked agent asks
for `--color-danger`; it does not ask for red by shade number.

## 3. Token taxonomy

The root boundary separates six concerns:

| Group          | Examples                                         | Purpose                        |
| -------------- | ------------------------------------------------ | ------------------------------ |
| Typography     | `--font-ui`, `--font-mono`                       | Stable interface and data text |
| Surfaces       | canvas, sidebar, hover, raised, borders          | Depth without excessive cards  |
| Content        | primary, secondary, muted, subdued, faint        | Reading hierarchy              |
| Interaction    | accent, selection, focus, overlays               | Pointer and keyboard feedback  |
| Semantic state | working, attention, danger, success, info, Git   | Meaning that stays consistent  |
| Geometry       | spacing, radii, popover shadow, transition speed | Rhythm and control consistency |

This taxonomy prevents two common failures. First, semantic states do not borrow
arbitrary surface colors. Second, muted content is not implemented with global
opacity, which can accidentally reduce child contrast and focus indicators.

## 4. Why CSS custom properties

CSS custom properties are native to Chromium, inherit through the DOM, and are
resolved at render time:

```css
:root {
  --color-border: #292929;
}
.pane {
  border-color: var(--color-border);
}
```

They need no runtime library, bundler plugin, React context, or generated class
names. Electron 43 provides a modern Chromium engine, so `color-mix()` can derive
transparent rings and selection colors while the source role remains explicit.

Alternatives have costs:

- Sass variables disappear at compile time and do not support runtime theme
  switching without duplicate bundles.
- JavaScript theme objects require plumbing values into style props or a CSS-in-JS
  library and can delay first paint.
- utility classes provide consistency but add a dependency and do not by
  themselves define semantic meaning.

For one renderer stylesheet, native custom properties are the smallest durable
boundary.

## 5. The cascade is part of the architecture

Declaring tokens in `:root` makes them available to the entire renderer. A future
theme can override the same contract on an ancestor:

```css
[data-theme='high-contrast'] {
  --color-border: #707684;
  --color-text-muted: #c1c5ce;
}
```

Components remain unchanged because the cascade supplies a different value for
the same role. This is dependency inversion in CSS: components depend on a token
interface, not on a concrete palette.

Token names therefore form an API. Renaming one should be reviewed like renaming
a shared TypeScript field; adding several overlapping names weakens the contract.

## 6. Designing hierarchy for terminal software

The terminal canvas contains dense, high-contrast text that users stare at for
long periods. Chrome should be quieter:

- near-black canvas and sidebar surfaces reduce glare;
- small luminance steps create depth without card borders everywhere;
- primary text is bright enough for labels, while metadata uses explicit muted
  roles;
- the accent is reserved for selection and keyboard focus;
- amber, red, green, and info blue communicate state rather than decoration.

Color alone is not sufficient. Agent rows still include text labels and state
dots; workspace attention still has structure and accessible names. Tokens make
color consistent, not independently accessible.

## 7. Spacing and radius tokens

Compact interfaces often drift by one or two pixels because each control is tuned
in isolation. A small even-numbered scale provides enough choices:

```css
--space-1: 2px;
--space-2: 4px;
--space-3: 6px;
--space-4: 8px;
```

The scale is not a command to replace every numeric value. Typography, icon
optical alignment, and divider hit targets can require deliberate exceptions.
Tokens cover repeated rhythm; exceptional geometry stays local and reviewable.

Radii follow the same rule but stay deliberately restrained: 3px for compact
rows, 4px for normal controls, and 6px for the rare larger container. Terminal
panes remain square. Shadows belong to transient popovers, not permanent shell
surfaces. This avoids the “every element is a different rounded card” look.

## 8. Motion and reduced motion

Motion has two categories:

1. short transitions that make hover/focus changes legible; and
2. repeating animations that request attention.

Shepherd uses a shared fast transition for controls. Repeating workspace and
agent animations are disabled under `prefers-reduced-motion: reduce`. Important
states retain color, text, and structure when animation is removed.

Animations should never be the only signal, and tokenizing duration should not
encourage animating layout dimensions. Layout animation around xterm can cause
continuous resize work and blurry terminal rendering.

## 9. Validation and regression strategy

Visual systems are difficult to validate through pixel snapshots alone. A
structural test can enforce the architectural boundary:

```text
required token exists
required token is consumed
raw color literals appear only in :root
reduced-motion rule remains present
```

The M26 regression goes further. It parses RGB tokens, asserts that every shell
surface has nearly equal red/green/blue channels, and computes contrast ratios
for primary, secondary, muted, and focus pairs. It also checks semantic ownership:
ordinary hover must use a neutral surface while blocked, working, and idle states
must consume danger, working, and success roles.

These checks prove boundaries and measurable contrast, not that a palette is
beautiful or that every composition is legible. Live screenshots and keyboard
checks remain necessary for hierarchy, clipping, simultaneous states, disabled
controls, and browser focus behavior.

Pixel screenshots remain useful for checking hierarchy, clipping, and accidental
layout changes. They complement rather than replace semantic assertions.

## 10. Security and trust boundaries

Static CSS tokens add no filesystem, IPC, network, or process authority. They do
not interpolate terminal output or user-controlled values into styles. This is
important because allowing arbitrary user strings to become CSS values could
create confusing overlays or content-obscuring UI even without script execution.

Future user themes should validate against a fixed allowlist of token names and
bounded CSS color formats. They should not load arbitrary stylesheets into the
privileged application renderer.

### The terminal palette is a separate trust and ownership boundary

The shell token contract does not own xterm colors. `terminalTheme.ts` exports a
frozen `ITheme`-compatible object for the terminal background, foreground,
cursor, and selection. `TerminalHost.tsx` supplies that object directly when it
constructs xterm.

Keeping these graphs separate prevents a UI theme edit from changing ANSI color
meaning or making the cursor and selection unreadable. It also creates the right
extension seam: a validated terminal-theme setting can replace the xterm object,
while shell themes continue to override semantic CSS roles. Neither path needs
arbitrary stylesheet injection.

## 11. Failure behavior

CSS custom properties fail locally. An undefined token normally makes that
declaration invalid, allowing inheritance or the user-agent default to apply.
That can hide a control without crashing the application, which makes missing
tokens easy to overlook manually.

The required-token test catches missing declarations and unused contract fields.
Keeping raw colors out of component rules also ensures a missing token cannot be
silently masked by an old literal fallback.

## 12. Operational tradeoffs and extensions

The token boundary adds indirection: developers must look up a role rather than
copying a value. That small cost buys consistent changes and clearer reviews.
Semantic names can also be debated; the answer is to keep the vocabulary small
and add roles only when two concepts genuinely need independent evolution.

The architecture enables later work without promising it today:

- high-contrast and light mappings;
- reading Ghostty colors into a validated semantic subset;
- a settings preview that updates an ancestor data attribute;
- automated contrast checks against token pairs; and
- component-scoped overrides for compact or spacious density.

The neutral shell, flat sidebar, and compact terminal chrome now consume this
contract. Notification, metadata, utility, and preview phases can add meaning
without reopening palette ownership: new permanent surfaces stay neutral, and
new colors require a semantic role with accessible non-color context.

## Checkpoint

1. Why should a blocked agent consume `--color-danger` instead of `--red-500`?
2. What advantage do runtime CSS properties have over Sass variables for themes?
3. Why can a structural token test not replace visual review?
4. Which user-theme inputs would require validation, and why?
5. When is a local pixel value preferable to adding another global token?
