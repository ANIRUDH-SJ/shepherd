# Appearance and Terminal Themes

Shepherd separates application chrome from terminal ANSI colors. Changing the
window from dark to light does not rewrite terminal output colors, and changing
a terminal palette does not redefine buttons, dialogs, or workspace state.

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

Graphite is the shipped terminal palette. It defines xterm foreground,
background, cursor, selection, and ANSI colors independently from the application
mode. A light Shepherd window can therefore contain the same predictable
Graphite terminal used in dark mode.

Settings displays the palette and an ANSI preview. Unsupported or corrupt
palette identifiers fall back to Graphite during preference validation.

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
default geometry is restrained and the interface uses one neutral accent family.

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
  version: 1
  terminalFontSize: number
  appearanceMode: 'system' | 'light' | 'dark'
  terminalPaletteId: 'graphite'
}
```

Older Shepherd and compatibility font-size keys migrate automatically. Invalid
JSON, unsupported modes, non-finite font sizes, and unknown palette identifiers
fall back to validated defaults rather than reaching xterm or native theme APIs.
