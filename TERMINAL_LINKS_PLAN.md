# Clickable Terminal Links Plan

## Status and scope

Status: implementation, verification, and documentation complete in PR #46.

Branch: `feat/clickable-terminal-links`

Baseline: `d281071b96eb96f6c00c4c8aeb3c4654f12bdc4a`

This feature makes link-like terminal output actionable without turning terminal
text into a privileged execution channel. Shepherd will support plain HTTP(S)
URLs, application-emitted OSC 8 HTTP(S) and local-file hyperlinks, and existing
local file references such as `src/main/index.ts:42:7`. On Linux, Ctrl-click
opens a target; Meta-click is accepted for terminal conventions on other
platforms. An ordinary click continues to focus or select terminal text.

Shepherd has no built-in editor yet, so a file opens in the operating system's
default application. Parsed line and column metadata are preserved in the
contract for a future editor integration but are not claimed as implemented
navigation in this milestone.

## Goals

- Make `http://` and `https://` output clickable, including wrapped URLs.
- Honor safe OSC 8 links without using xterm.js's browser-confirm fallback.
- Detect common absolute, home-relative, dot-relative, and project-relative file
  references with optional line and column suffixes.
- Show file links only after Electron main confirms that the target currently
  exists relative to the owning terminal's live shell working directory.
- Revalidate every activation before asking the operating system to open it.
- Preserve terminal selection, focus, keyboard input, output flow control, and
  WebGL fallback behavior.

## Security and trust boundary

Terminal output is untrusted. It may contain text produced by a repository,
remote host, build script, or agent. The renderer therefore identifies only
bounded candidates and sends them through the preload bridge.

Electron main will:

- require the requesting renderer to own the referenced terminal;
- bound candidate counts and string lengths and reject control characters;
- accept only `http:` and `https:` external URLs;
- accept `file:` URLs only for local hosts;
- resolve relative paths from `/proc/<shell-pid>/cwd`, not renderer state;
- require a target to exist and be a regular file or directory;
- use Electron `shell.openExternal` or `shell.openPath` with no shell command or
  interpolation;
- return structured failures without writing attacker-controlled text into the
  terminal.

## Implementation checklist

1. [x] Add pure terminal-link candidate parsing and range tests.
2. [x] Add shared bounded IPC request/result contracts and validators.
3. [x] Add main-process resolution and activation handlers tied to terminal
       ownership and the shell's live cwd.
4. [x] Add the official xterm.js WebLinks addon, a file-link provider, and a strict
       OSC 8 handler in `TerminalHost`.
5. [x] Add visual runtime smoke coverage for URL, file, invalid-path, and OSC 8,
       plus focused ordinary-click behavior coverage.
6. [x] Write the completed code walkthrough and textbook chapter, then synchronize
       the roadmap, feature matrix, indexes, glossary, and relevant xterm chapter.

## Planned commit sequence

1. `docs: plan clickable terminal links`
2. `links: parse terminal file references`
3. `ipc: define terminal link contract`
4. `main: open validated terminal links`
5. `renderer: activate clickable terminal links`
6. `docs: explain clickable terminal links`
7. focused review and verification fixes, if needed

## Verification

- Focused parser, IPC-validator, ownership, path-resolution, and activation tests.
- Renderer tests for character-to-cell ranges, modifier activation, and stale
  asynchronous provider results.
- Isolated Electron smoke using a real existing file, an HTTP URL, a nonexistent
  path, and OSC 8 output; focused tests keep ordinary click non-activating.
- Visual proof showing URL and file-link hover treatment.
- Final `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, and
  `git diff --check`.

## Documentation checklist

- [x] Add a code-focused walkthrough under `learning/` after behavior settles.
- [x] Add a textbook chapter covering terminal protocols, xterm link providers,
      IPC boundaries, filesystem resolution, security, tradeoffs, and extensions.
- [x] Update `ROADMAP.md`, `FEATURES.md`, learning/textbook indexes, glossary, and
      the xterm.js chapter.
- [x] Keep all examples aligned with the final implementation.

## Delivery checklist

- [x] Implement and test candidate parsing.
- [x] Implement and test bounded link IPC contracts.
- [x] Resolve links against the owning terminal's live cwd.
- [x] Add safe URL, OSC 8, and file-link activation.
- [x] Complete focused and full verification.
- [x] Capture visible runtime evidence.
- [x] Complete learning and textbook documentation.
- [x] Open and code-review the dedicated PR (#46).
