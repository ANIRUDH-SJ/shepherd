# 39 — Terminal-Derived Theming for Desktop Multiplexers

A terminal multiplexer has two visual systems: application chrome and terminal
content. A convincing terminal-first interface does not style these as unrelated
products. It treats the terminal theme as the environmental background and lets
navigation, tabs, and dividers sit quietly around it.

## 1. Start with backdrop ownership

The most important question is not “which gray should the sidebar use?” It is
“which component owns the window backdrop?” If the terminal uses one dark color,
the sidebar another, the tab bar a third, and the native window briefly paints a
fourth, the user sees nested rectangles even when every individual color is
reasonable.

A terminal-derived system chooses one anchor:

```text
terminal theme background
        ├── window first-paint color
        ├── application canvas
        ├── sidebar base
        └── permanent tab/header chrome
```

Hover, popover, and input surfaces may move one or two luminance steps away from
the anchor. Permanent regions should not create depth without a functional
reason.

## 2. Coordinate contracts without coupling runtimes

An xterm theme is a TypeScript object applied to a canvas renderer. Application
chrome is CSS. They have different consumers, lifecycle rules, and extension
needs, so directly reading CSS variables inside the terminal renderer creates an
unhelpful dependency.

Instead, coordinate the default outputs:

```text
validated theme specification
        ├── semantic CSS role map
        └── frozen xterm ITheme
```

The current fixed theme writes those outputs as two reviewed constants. A future
runtime theme loader should introduce the shared validated specification and two
pure adapters rather than making either consumer reach into the other.

## 3. Use contrast as an event

Low-chroma backgrounds make small contrast changes powerful. An interaction role
should answer a concrete question: “where am I?” or “which pane needs me?”

A compact system can use contrast for:

- the selected workspace;
- a one-pixel active-tab edge;
- keyboard focus; and
- bounded unread or attention feedback.

This is different from tinting permanent panels, cards, and borders. Shepherd's
accepted default uses graphite selection, neutral focus and tab edges, and amber
attention. Other products may use a saturated accent, but it should appear at
state transitions and selected destinations rather than as atmosphere.

Red, amber, and green remain semantic. Text, icons, and accessible names must
carry the same state because color alone cannot explain whether an agent is
working, blocked, idle, or finished.

## 4. Build a measured text ladder

Terminal-first themes often fail by making every label bright white. A small
foreground ladder produces depth without adding containers:

```text
primary       active labels and dialog titles
secondary     ordinary labels and terminal foreground
muted         metadata and toolbar icons
subdued       tertiary descriptions
faint         disabled controls and quiet separators
```

Contrast tests should cover each foreground against the surface where it is
actually used. Selected-row text needs separate review because a vivid medium
blue may have less white-text contrast than expected. Native products sometimes
accept lower contrast for short selected labels; cross-platform applications
should pair that visual target with focus structure and accessible naming.

## 5. Terminal selection and ANSI color

Background and foreground alone do not define a terminal theme. Cursor fill,
cursor text, selection, and all sixteen ANSI colors participate in daily output.
Leaving them to another renderer's defaults can introduce highly saturated colors
that do not belong to the surrounding product.

A complete theme specifies:

- background and default foreground;
- cursor and cursor foreground;
- selection background and foreground behavior; and
- normal and bright ANSI 0–15 colors.

Selection can use a translucent neutral role so text remains visible while
keeping selected output connected to the app's navigation language. ANSI blue
and cyan are a separate content contract: terminal programs may request them even
when the application chrome has no blue interaction state.

## 6. First paint is part of the theme

Electron creates a native window before React and xterm are ready. Its configured
background is visible during startup, renderer reloads, and occasional GPU
surface transitions. Matching that color to the terminal anchor prevents a flash
that otherwise makes a polished theme feel assembled from layers.

This setting belongs in the main process because it is a BrowserWindow property,
not renderer CSS.

## 7. Testing strategy

Static regressions can prove:

- required semantic roles exist and are consumed;
- permanent surfaces share the intended anchor;
- component rules do not bypass tokens with literals;
- selection owns one contrast role without redundant indicators;
- active tabs remain flat;
- text pairs meet chosen contrast thresholds; and
- the xterm theme is complete, frozen, and independent of CSS strings.

They cannot prove that the whole window feels balanced. Live review must inspect
empty terminals, dense output, multiple tabs, split dividers, selected workspaces,
hover, focus, semantic agent states, narrow sidebars, and startup paint.

## 8. Alternatives and tradeoffs

Using independent sidebar and terminal themes offers more customization, but the
default can feel fragmented. Matching only the sidebar to the terminal helps,
yet leaves tabs and first paint outside the system. Loading arbitrary CSS is
flexible but unsafe and makes contrast, layout, and obscured-control behavior
unbounded.

A validated theme schema is the durable extension. It should accept bounded color
formats, reject CSS fragments, calculate readable foregrounds, and fall back
atomically if any required role is invalid.

## 9. Operational and security boundaries

Static colors add no process, filesystem, IPC, or network authority. Runtime
theme discovery does: it reads user-controlled files and turns their data into
rendered output. Parsing must bound file size, accepted keys, value formats, and
fallback behavior. Theme changes should never interpolate terminal output into
CSS or allow values that create images, URLs, filters, or arbitrary declarations.

## Checkpoint

1. What does backdrop ownership solve that extra surface colors do not?
2. Why should CSS roles and xterm themes share a source but not read each other?
3. Which states justify the accent color?
4. Why is BrowserWindow first paint part of the theme contract?
5. Which checks still require a live application rather than static tests?
