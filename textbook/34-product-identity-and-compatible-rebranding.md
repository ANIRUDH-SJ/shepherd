# Chapter 34 — Product Identity and Compatible Rebranding

A desktop application's name is not one string. It is a distributed contract
shared by users, the operating system, stored state, scripts, protocols,
installers, logs, and third-party configuration. A safe rebrand changes the
public contract while deliberately managing every old identifier that may still
exist outside the repository.

This chapter explains the architecture used to establish Shepherd as an
independent product without resetting existing users or silently breaking their
automation.

## 1. Identity is a matrix

Shepherd has several related but distinct identifiers:

| Boundary               | Identity                         |
| ---------------------- | -------------------------------- |
| Visible product        | `Shepherd`                       |
| npm and Debian package | `shepherd`                       |
| Electron app ID        | `dev.anirudhsj.shepherd`         |
| Linux executable       | `shepherd`                       |
| CLI                    | `shepherd`                       |
| Default control socket | `/tmp/shepherd.sock`             |
| Environment namespace  | `SHEPHERD_*`                     |
| User-data directory    | `~/.config/shepherd`             |
| Agent schema           | `urn:shepherd:agent-protocol:v1` |

These values follow the conventions of their boundary. A display name can use
title case, while executable, package, path, and environment identifiers must be
stable machine-facing tokens.

`src/shared/product.ts` centralizes the runtime portion of this matrix. That
prevents the session loader, PTY manager, socket server, and diagnostics from
inventing slightly different migration rules.

## 2. Precedence is part of the API

During a compatibility window, a process may contain both new and old
environment variables. The rule must be deterministic:

```text
non-empty SHEPHERD value
  → otherwise non-empty legacy value
  → otherwise the Shepherd default
```

Diagnostics need a stricter variant. If the current variable exists, its value
is authoritative even when it is `"0"`. Otherwise an old `"1"` could re-enable
diagnostics after a user explicitly disabled the new setting.

Centralizing precedence also makes it testable. A migration should not rely on
the accidental order in which modules read `process.env`.

## 3. Select state; do not copy it blindly

Changing Electron's product name changes its default user-data directory. A
naive rename therefore looks like data loss even though the old files still
exist.

Shepherd selects a directory before window creation:

```text
new directory has owned state?     use new
else old directory has owned state? use old
else                               use new
```

The probe recognizes only `session.json` and `Local Storage`, the state that this
application owns. It does not copy an entire configuration tree, merge two
databases, delete the old path, or assume every file beneath it belongs to the
app. If both locations contain state, the current Shepherd directory wins.

This selection approach has a tradeoff: an upgraded user can continue using the
old physical directory. That is less cosmetically pure than a copy, but it is
atomic, reversible, and resistant to partial migration.

The renderer uses a smaller version of the same pattern. It reads
`shepherd.fontSize`; if absent, it validates `cmux.fontSize`, normalizes the
number, and writes the current key. Invalid legacy data is ignored rather than
propagated.

## 4. Sockets require live compatibility

A launcher alias is enough for a command name, but it cannot help an already
running process that connects directly to an old socket path. Shepherd therefore
listens on both default paths when no override is supplied.

Both `net.Server` instances share:

- the same newline-delimited JSON parser;
- the same method dispatcher and validation;
- the same workspace and agent mirrors;
- the same subscriber limits and backpressure rules;
- one shutdown path that closes and unlinks every endpoint.

An explicit `SHEPHERD_SOCKET_PATH` or legacy override creates one listener. This
is important for tests, isolated instances, and users who intentionally choose a
private endpoint. Compatibility must not defeat explicit isolation.

Dual listening adds one local filesystem endpoint, not a second authority. Both
paths expose the same local control capability and must use identical request
validation.

## 5. Pane environments bridge old and new processes

Every new terminal receives current variables and matching compatibility
aliases. This solves a subtle version-skew problem:

```text
new Shepherd application
  → launches a terminal with both namespaces
  → an old managed hook reads its old names
  → it still targets the correct workspace, surface, and socket
```

The primary CLI reads current names first. `bin/cmux` is only a small launcher
that delegates to `bin/shepherd`; business logic is not forked. A second
implementation would inevitably drift in flag parsing, validation, and error
behavior.

## 6. Managed configuration needs proof of ownership

Provider integrations live in user-controlled files. Rebranding does not grant
permission to rewrite arbitrary configuration.

Codex and Claude migration matches the exact command previously generated by
the application. Only that command is replaced. Other hook groups, commands,
timeouts, and settings survive.

OpenCode uses an ownership marker. New users receive
`shepherd-agent.js`. When an old marker-owned plugin exists and the new path does
not, the installer updates the old file in place. This avoids loading duplicate
reporters. An unmarked file is treated as user-authored and is never
overwritten.

Atomic temporary-file-plus-rename writes keep a failed update from truncating a
provider configuration.

## 7. Packaging defines operating-system identity

Source labels alone do not rename an installed desktop app.
`electron-builder.yml` controls the application ID, product name, executable,
desktop entry, window class, and artifact filenames. `package.json` controls the
npm and Debian package identity plus repository links.

These must be verified from a production artifact, not inferred from config:

```bash
npm run dist:dir
file release/linux-unpacked/shepherd
release/linux-unpacked/resources/bin/shepherd --help
release/linux-unpacked/resources/bin/cmux --help
```

The compatibility launcher is bundled because the entire `bin/` directory is an
extra resource. The generated `out/` and `release/` directories remain build
outputs and are not committed.

## 8. Protocol identity and compatibility

The agent schema changes its descriptive ID and title to Shepherd, while method
names, envelopes, and protocol version remain stable. This separates branding
from behavior. A version bump would falsely suggest a wire incompatibility.

Likewise, renderer-only event names can change as one atomic bundle because no
external process receives them. Socket paths and environment variables cannot
be treated that way because they cross process and version boundaries.

## 9. Alternatives and tradeoffs

### Hard cutover

Removing every old identifier is simpler but breaks existing hooks, shell
scripts, direct socket clients, and saved state. It is appropriate only when no
released user state exists.

### Copy-on-first-run

Copying the old user-data directory creates a clean new path, but partial writes,
two divergent copies, unknown files, and rollback make it risky. Selection is
safer for the current storage model.

### Symbolic-link socket alias

A symlink seems cheaper than two listeners, but Unix socket lifecycle and stale
filesystem entries become less explicit. Two bounded servers with shared logic
are easier to reason about and test.

### Permanent compatibility

Aliases reduce migration pain but also become maintenance surface. A future
removal should be evidence-driven: announce deprecation, instrument only
content-free alias usage if privacy policy permits, provide a migration command,
and remove aliases in a versioned release.

## 10. Verification strategy

A rebrand test plan should cross boundaries:

1. Pure tests establish precedence and state selection.
2. Socket tests connect through both paths.
3. CLI tests invoke both launchers and both environment namespaces.
4. Integration tests start with legacy managed configuration and assert no
   duplicate or user-authored overwrite.
5. Renderer tests prove setting migration and current event names.
6. Schema and diagnostic tests prove public machine identity.
7. Build validation checks TypeScript, lint, production bundles, and packaging.
8. Runtime smoke tests launch the packaged app with isolated XDG directories,
   exercise both sockets, and verify legacy session restore.

The central lesson is that compatibility must be designed at every external
boundary. Once those boundaries are explicit, a rebrand becomes a controlled
protocol migration instead of a cosmetic rename.
