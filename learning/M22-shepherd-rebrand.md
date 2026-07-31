# M22 — Shepherd Rebrand

## Goal

This milestone changed the application from an old working name to the complete
Shepherd product identity without treating a rebrand as a search-and-replace.
The finished code preserves existing sessions, scripts, socket clients, pane
environment variables, and managed agent integrations while making every new
installation and command Shepherd-first.

## The identity contract

`src/shared/product.ts` is the source of truth. It exports the visible name,
current and legacy slugs, both default socket paths, and every current/legacy
environment key. Two helpers enforce consistent precedence:

- `productEnvironmentValue` chooses a non-empty `SHEPHERD_*` value before its
  legacy alias.
- `productDiagnosticsEnabled` lets an explicit current value win, including
  `"0"` disabling a legacy `"1"`.
- `productSocketPaths` returns one explicit override or both default migration
  sockets.

`src/shared/product.test.ts` covers these rules directly. This matters because
the CLI, PTY environment, session path, diagnostics, and socket server must all
make the same choice.

## Existing state at startup

`src/main/productIdentity.ts` runs before Electron creates a window. It sets the
application name and selects the user-data path:

1. New installations use `<appData>/shepherd`.
2. If that location has no app-owned state but the old location contains
   `session.json` or `Local Storage`, Shepherd uses the old location.
3. If both contain state, the new Shepherd location wins.

No directory is copied, merged, deleted, or broadly inspected. `session.ts`
similarly prefers `SHEPHERD_SESSION_PATH`, accepts the legacy override, and then
uses the selected Electron user-data directory.

## Socket and pane migration

`src/main/socket.ts` now owns an array of servers instead of one server. With no
override it listens on `/tmp/shepherd.sock` and the previous default path. Each
server uses the same framed request handler, workspace mirror, subscriber set,
limits, and shutdown cleanup. An explicit current or legacy socket override
creates only one endpoint.

`src/main/pty.ts` injects `SHEPHERD_SURFACE_ID`,
`SHEPHERD_WORKSPACE_ID`, `SHEPHERD_SOCKET_PATH`, and
`SHEPHERD_ELECTRON`. It also injects matching compatibility aliases so an old
hook launched inside a new pane still targets the correct terminal.

## CLI and managed integrations

`bin/shepherd` is the primary shell launcher and `bin/shepherd.js` contains the
CommonJS client. It prefers current environment variables and uses
`/tmp/shepherd.sock` by default. `bin/cmux` and `bin/cmux.js` are intentionally
small compatibility entry points.

The integration installers perform narrow migrations:

- Codex and Claude settings replace only the exact generated legacy hook
  command, preserving every other hook and setting.
- New OpenCode installs use `shepherd-agent.js`.
- An existing marker-owned legacy OpenCode plugin is updated at its existing
  path so OpenCode does not load two reporters.
- An unmarked plugin is never overwritten.

`agent-events.js` and the generated OpenCode plugin prefer current terminal
identity but accept legacy aliases for session cleanup.

## Renderer, protocol, and diagnostics

The window, HTML title, sidebar brand, preload type (`ShepherdApi`), and agent
schema ID now publish Shepherd. Renderer-only events live in
`src/renderer/src/events.ts`, avoiding repeated string literals.

`settings.ts` writes `shepherd.fontSize`. When the current key is absent, it
validates the old value, normalizes it, and writes the new key. Invalid or
out-of-range legacy values are not migrated.

Runtime diagnostics use `SHEPHERD_PERF_DIAGNOSTICS`,
`SHEPHERD_MEMORY_DIAGNOSTICS`, `[shepherd:perf]`, and
`[shepherd:memory]`. Their old opt-ins remain accepted through the shared
identity rules.

## Packaging and benchmark changes

`package.json`, `package-lock.json`, and `electron-builder.yml` now produce the
`shepherd` package, `dev.anirudhsj.shepherd` app ID, `Shepherd` desktop entry,
and `shepherd` executable. Both CLI launchers are bundled as resources.

The benchmark subject mode is now `shepherd`; old saved `cmux` modes normalize
to it. Worker variables, private socket names, examples, process fixtures, and
diagnostic parsing use the new identity. Historical result reports remain
unchanged because they describe binaries measured before the rename.

## Regression coverage

Focused tests prove product precedence, state-path selection, both socket
endpoints, both CLI names, old pane variables, exact hook migration, OpenCode
deduplication, setting migration, schema identity, diagnostic compatibility,
benchmark normalization, and package compilation. A real unpacked production
build confirms the executable and bundled launchers are named and runnable as
designed.
