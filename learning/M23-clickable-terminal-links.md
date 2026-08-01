# M23 — Clickable Terminal Links

## Goal

This milestone makes terminal output actionable without trusting it. Ctrl-click
on Linux, or Meta-click on platforms that use that convention, opens an HTTP(S)
URL, an OSC 8 HTTP(S)/local-file hyperlink, or an existing local path such as
`src/main/index.ts:42:7`. A normal click still focuses the terminal or begins a
selection.

Shepherd does not contain an editor, so line and column values are retained for
a future editor integration while the operating system's default application
opens the file today.

## The completed flow

```text
terminal output
  → xterm URL, OSC 8, or file-link provider
  → preload's typed terminal API
  → main validates renderer ownership and the request
  → main reads /proc/<shell-pid>/cwd
  → Electron shell.openExternal or shell.openPath
```

The renderer recognizes candidates and supplies hover ranges. Electron main
owns every filesystem and operating-system decision.

## Shared contract and preload bridge

`src/shared/terminalLinks.ts` defines the plain-data boundary:

- `TerminalFileReference` carries `path`, optional `line`, and optional `column`.
- `TerminalLinkTarget` is a discriminated union of `url` and `file` targets.
- `ResolveTerminalFileLinksRequest` batches hover candidates.
- `OpenTerminalLinkRequest` activates exactly one target.
- `OpenTerminalLinkResult` returns a bounded error category instead of throwing
  attacker-controlled terminal text across the boundary.

The validators limit a hover to 16 candidates, path text to 1,024 characters,
URLs to 2,048 characters, terminal IDs to 256 characters, and positions to
1,000,000. They reject control characters, invalid object shapes, column values
without a line, and malformed numeric positions.

`src/shared/ipc.ts` adds `terminal:resolve-file-links` and
`terminal:open-link`. `src/preload/index.ts` exposes only
`window.api.terminal.resolveFileLinks` and `openLink`; the renderer never
receives Electron's `ipcRenderer` or `shell` object.

## Parsing and exact xterm ranges

`src/renderer/src/terminalLinks.ts` contains the renderer logic. The pure
`findTerminalFileLinks` parser recognizes:

- absolute paths: `/tmp/project/result.json`;
- home paths: `~/notes/todo.md`;
- dot-relative paths: `./src/index.ts` and `../shared/types.ts`;
- project-relative paths: `src/main/index.ts`;
- common bare files: `README.md` and `.env`;
- optional locations: `file.ts:42` and `file.ts:42:7`.

It deliberately skips HTTP(S), which the official xterm WebLinks addon handles,
and stops after the shared candidate limit.

JavaScript string offsets are not terminal columns. A CJK glyph can occupy two
xterm cells, a continuation cell has width zero, and one cell can contain a
combined character sequence. `snapshotTerminalLine` records both UTF-16 offsets
and physical cell boundaries. `terminalFileLinkRange` then converts a parser
match into xterm's one-based inclusive range. This prevents the underline from
shifting after wide or combined characters.

`TerminalFileLinkProvider` reads only the physical line xterm asks about. It
parses candidates, asks main which ones exist, and returns `ILink` objects only
for confirmed targets. A sequence counter and disposal flag discard late async
results after a newer hover or terminal teardown. Before decorating, the
provider snapshots the current row again and rejects the result if its text or
cell geometry changed while main was checking the filesystem.

## URL and OSC 8 integration

`TerminalHost.tsx` loads `@xterm/addon-web-links`, which already handles wrapped
HTTP(S) URLs and maps them across xterm rows. Its activation handler does nothing
unless Ctrl or Meta is pressed, then sends a URL target over the bridge.

xterm's built-in OSC 8 provider uses the terminal's `linkHandler`. Shepherd sets
`allowNonHttpProtocols` so local `file:` payloads can reach its handler, but
`terminalOscLinkTarget` forwards only `http:`, `https:`, and `file:`. Main still
performs the authoritative validation. Protocols such as `javascript:` are
ignored.

The custom file provider is registered beside these providers and disposed
before the terminal. All three paths call the same small `openLink` function.

## Main-process validation and opening

`src/main/terminalLinks.ts` contains testable OS-boundary helpers:

- `normalizeTerminalExternalUrl` accepts only credential-free HTTP(S) URLs.
- `readTerminalShellCwd` reads the interactive shell's live Linux cwd from
  `/proc/<pid>/cwd`.
- `resolveTerminalFileReference` handles absolute, relative, home, and local
  `file:` references, rejects remote file hosts/query/hash data, resolves a
  bounded absolute path, and requires a regular file or directory.
- `terminalFileReferencesExist` supports lazy hover confirmation.
- `openTerminalLinkTarget` calls injected openers and converts failure into the
  shared result type.

`src/main/pty.ts` wires these helpers to IPC. `TerminalOwnershipRegistry.getOwned`
requires the requesting `WebContents` to own the referenced PTY. Relative paths
use the shell cwd, not persisted renderer state. Activation repeats the lookup
and existence check because the cwd or file can change between hover and click.
Electron receives the final value through `shell.openExternal` or
`shell.openPath`; no command string or shell interpolation exists.

## Regression and live proof

The renderer tests cover candidate syntax, punctuation, bounds, modifiers, OSC
protocol filtering, wide-character range mapping, nonexistent filtering,
ordinary-click behavior, Ctrl-click activation, and late provider results.
Shared tests cover every request shape and bound. Main tests cover URL policy,
credentials, home/relative/file URL resolution, missing targets, live cwd reads,
and success/failure opening with injected fakes.

An isolated production-bundle Electron run used private XDG and socket paths. It
rendered an HTTP URL, `README.md:12`, a nonexistent file, and an OSC 8 URL. CDP
inspection confirmed pointer and underline styling for the URL, existing file,
and OSC 8 link, while the missing path retained the text cursor and no
decoration. The captured proof is `docs/images/clickable-terminal-links.png`.
