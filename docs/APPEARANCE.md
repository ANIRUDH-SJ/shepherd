# Appearance and Terminal Themes

Shepherd gives application chrome and terminal content one coordinated light or
dark foundation. Changing appearance updates both the window surfaces and the
xterm foreground, background, cursor, and selection colors. ANSI color roles
remain stable so shell output keeps its meaning across appearances.

## Application appearance

Open Settings with `Ctrl+Shift+,` and choose **Appearance**. Three modes are
available:

- **System** follows the desktop's resolved light or dark appearance.
- **Light** keeps Shepherd chrome light.
- **Dark** keeps Shepherd chrome dark.

The main process applies the requested mode through Electron `nativeTheme` and
reports resolved changes back to the renderer. The document stores the resolved
appearance as a data attribute, allowing every surface to consume one semantic
token contract.

## Terminal palette

System is the shipped terminal palette. Its dark variant uses a `#1e1e1e`
backdrop and its light variant uses `#feffff`, matching the application canvas.
Foreground, cursor, and selection colors follow the resolved appearance while
the ANSI red, green, blue, and other semantic roles remain stable.

Settings displays the palette and an ANSI preview. Unsupported or corrupt
palette identifiers fall back to System during preference validation. Existing
version-one Graphite preferences migrate to System without changing the saved
font size or appearance mode.

## Semantic token contract

Application CSS uses named roles rather than component-specific raw colors. The
roles cover:

- canvas, sidebar, ordinary and raised surfaces;
- primary, secondary, and muted text;
- ordinary and strong borders;
- accent, focus, selection, attention, danger, success, information, and working
  state;
- backdrop, popover shadow, spacing, radii, and transition timing.

Raw color values are kept at the root dark and light token boundaries. Controls,
workspace rows, pane chrome, dialogs, and the inspector consume those roles. The
default geometry is restrained, surfaces remain neutral, and a single blue
accent is reserved for selection, focus, and small identity details.

## Typography and motion

Controls use the system UI stack. Monospace is reserved for terminal content,
paths, ports, commands, and similarly technical values. Essential interface text
is not rendered at decorative sizes.

Transitions are brief and purposeful. When the operating system requests reduced
motion, Shepherd disables non-essential animation and smooth scrolling. Agent
attention does not pulse continuously; a bounded pane ring appears only when a
new actionable event arrives.

## Stored preferences

Renderer preferences are versioned. The current record contains:

```ts
interface RendererPreferences {
  version: 2
  terminalFontSize: number
  appearanceMode: 'system' | 'light' | 'dark'
  terminalPaletteId: 'system'
}
```

Older Shepherd and compatibility font-size keys migrate automatically. Invalid
JSON, unsupported modes, non-finite font sizes, and unknown palette identifiers
fall back to validated defaults rather than reaching xterm or native theme APIs.
