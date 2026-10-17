# Architecture

Shepherd separates privileged terminal and operating-system work from its React
interface. Shared TypeScript contracts keep both sides explicit.

## Process boundaries

```text
React renderer
  │ typed, restricted IPC
  ▼
preload bridge
  │ allowlisted channels and payloads
  ▼
Electron main process
  ├── node-pty shells
  ├── Unix-socket automation server
  ├── Linux process, Git, PR, and port inspection
  ├── session persistence and native appearance
  └── notifications, worktrees, links, and preview policy
```

`src/main/` owns authority. It creates and supervises PTYs, batches terminal
output, validates socket requests, probes process context, persists the session,
and performs operating-system actions. The renderer never receives Node.js or
Electron primitives directly.

`src/preload/` exposes the smallest IPC bridge needed by the interface. The
renderer in `src/renderer/src/` owns view state, pure reducers, pane layout, and
xterm presentation. Cross-process payloads live in `src/shared/` and are
validated at their trust boundary.

## Terminal data flow

```text
keyboard → xterm → preload → PTY input
PTY output → bounded main-process batcher → preload → xterm
```

Every terminal surface has an ownership record. The main process queues bounded
output, tracks acknowledgements, pauses PTY reads at the high-water mark, and
releases ownership on renderer teardown or process exit. The renderer owns xterm
construction and disposal so React lifecycle changes cannot leak terminal
instances.

## Workspace state

The top-level renderer reducer owns a list of workspaces and an active workspace
identifier. A workspace contains live contextual fields plus a pure pane tree.
Pane actions—split, resize, add surface, select tab, close surface, and close
pane—are delegated to the workspace reducer.

Terminal and preview panels use a discriminated union. This keeps terminal-only
operations, such as input and search, from being applied to a preview while
allowing both panel types to share tabs, panes, layout, and persistence.

Session persistence stores every workspace's pane tree, safe preview URLs,
working directory, active selection, and bounded notification inbox. The
renderer debounces writes and flushes its latest snapshot before unloading;
the main process replaces the session file atomically. Restoring a session
creates fresh PTYs. It does not serialize a running process or retain
ephemeral agent and usage telemetry.

After a successful session write, the main process compares the previous and
next snapshots and appends metadata-only events to a separate, atomic local
`provenance.json` file. The log is capped at 500 records. It never reads PTY
output or inbox bodies and does not persist repository paths; workspace names
remain user data.
Settings obtains the history through a read-only preload method. Export is a
separate explicit IPC action: the renderer supplies its current snapshot, the
main process shows a native save dialog, caps the serialized file at 5 MiB,
and writes a versioned JSON envelope with the snapshot and history. The file
is created with owner-only permissions. There is no import or process-resume
path for an export.

Multi-repository workspaces additionally persist a bounded list of canonical
Git roots and a stable original directory. Terminal surfaces can carry their
own validated absolute cwd; live metadata updates only the active terminal's
saved cwd. New tabs inherit the selected terminal's directory, and restoring
the layout starts each shell in its own saved directory. The main process
resolves folder-picker selections with `git rev-parse --show-toplevel` before
the renderer links them. Unlinking a root never disposes a PTY.

Workspace templates live in a separate versioned local-storage record. The
renderer validates and caps their names, directories, and single-line commands;
only a template identifier is associated with a workspace snapshot. Setup and
Run create a new terminal surface on explicit user action. The pending command
is held outside persisted layout state, and the renderer sends it only after
the new PTY creation succeeds. No command is replayed when the session restores.
The native directory picker is exposed through one preload IPC method.

Where a system tray is available, closing the window hides it instead of
destroying its renderer. The same window and PTYs continue running in the
background, and Show restores them. Explicit Quit destroys the window and
stops all PTYs. On desktops without a tray, closing the window quits normally.
This is window-detached execution within the Electron process, not a daemon
that survives app exit or crash.

## Agent and attention flow

Agent state can come from automatic Linux process discovery or an explicit
provider lifecycle report through the socket API:

```text
process discovery or provider hook
  → normalized AgentReport
  → validated ownership and revision rules
  → renderer AgentRecord
  → workspace rollup, Attention item, notification, and exact focus target
```

Reports distinguish semantic state (`working`, `blocked`, `done`, `idle`, or
`unknown`) from details such as testing, web search, approval, or external wait.
Revisions, stale times, and expiry times prevent old or abandoned reports from
remaining authoritative.

Attention is derived in the renderer. It is not a second source of truth:
actionable blocks and unseen completion records are selected from current agent
and notification state. Focusing an item reuses the stored workspace, pane,
surface, and agent identifiers.

## Notification routing

Socket and terminal OSC notifications always reach the renderer’s bounded inbox.
Only native desktop toasts consult `NotificationPolicy` in the main process. Its
versioned JSON record is atomically replaced under Electron user data; the
renderer edits it through the restricted preload bridge. The pure routing rule
combines global mode, focused-window/workspace context, local-time quiet hours,
and a per-workspace override. Quiet hours have highest precedence. Closed
workspace overrides are pruned from the policy file.

Clicking a desktop toast shows/focuses the existing Electron window and selects
the notification’s workspace when it is still open. No notification content is
persisted in the policy file; the inbox remains part of the bounded session
snapshot.

## Workspace metadata

The main process inspects only the active terminal target for each workspace. It
reads the interactive shell's working directory, resolves its Git root and HEAD,
queries an optional GitHub pull request with bounded output, and discovers TCP
listeners owned by descendant processes.

Metadata polling is adaptive and cached. Changing terminal surfaces invalidates
the surface-specific Git probe and requests an immediate reconciliation. Ports
are normalized, bounded, and associated only with the process tree that owns
them.

## Change review

The review panel is opened from the command palette or workspace inspector. Its
IPC requests identify a terminal surface; the main process accepts them only
when that renderer owns the live PTY. It reads the shell's current directory,
resolves the Git root itself, and rejects subsequent actions if the repository
has changed since the panel loaded. File actions also require an exact path in
the current porcelain status list, and Git receives it after `--` as a pathspec.

The main process bounds status and diff output. The UI keeps staged and working
diffs distinct, stages or unstages whole files, and commits only on an explicit
user action. A configured `npm test` script runs as a bounded child process when
requested. The optional PR diff uses `gh` for the current branch and does not
block local change review if GitHub access is unavailable.

## Appearance

Renderer preferences use a versioned local-storage record. Migration accepts the
older standalone font-size keys and produces one validated `RendererPreferences`
object containing terminal font size, application appearance mode, and a theme
preset identifier. Earlier terminal-only palette identifiers migrate to the
Shepherd preset.

The main process applies `system`, `light`, or `dark` to Electron `nativeTheme`
and reports the resolved mode. Semantic CSS tokens style application chrome, and
xterm receives the matching immutable palette for the selected preset and
resolved appearance. A preference event updates all open terminals when the
preset changes; appearance events select its light or dark variant. Neither
event recreates PTYs. Preset-specific CSS token overrides keep application
chrome coordinated with terminal colors.

Custom theme files cross a narrow native-dialog IPC boundary. Main reads at
most 32 KiB from a regular UTF-8 file and validates the versioned palette
before returning it; export validates again and writes the chosen file
atomically with owner-only permissions. The renderer stores one validated
theme in local storage. It maps its fixed chrome color keys into semantic CSS
tokens and supplies its terminal colors directly to xterm. Imported text,
URLs, selectors, or executable CSS never enter a style sheet. High-contrast
token overrides still apply after custom values. A dedicated event refreshes
open terminals when an imported custom palette replaces another one.

On a fresh profile without a restored session, the renderer waits for the first
shell output and writes `shepherd welcome` to that PTY. The CLI renders the guide
locally without opening the socket API, and local storage prevents it from
running again automatically.

## Security boundaries

- Context isolation and sandboxing stay enabled for renderer-facing content.
- IPC, socket, agent, usage, workspace, link, and preview payloads are validated.
- Terminal links allow HTTP(S) and existing local files; they never invoke a
  shell command.
- Preview surfaces accept loopback destinations only and use an ephemeral guest
  partition with remote requests, popups, downloads, and permissions blocked.
- Agent inspection returns bounded plain text and safe process identity rather
  than arbitrary process memory or environment contents.
- A versioned main-process policy gates `inspect-agent`, `send-text`, and
  `send-key` at the local socket boundary. The renderer can change that policy
  through the restricted preload bridge; socket clients can only query it with
  `agent-permissions`. Provider names in socket reports are claims, not
  authenticated identities. The defaults preserve earlier socket behavior.
- The companion HTTP listener is absent until explicitly started. It binds to
  one user-selected private IPv4 interface on an ephemeral port and serves a
  read-only projection of the renderer's workspace mirror. Its status endpoint
  requires a fresh in-memory access code; host and origin checks, a restrictive
  content security policy, no-store responses, and connection/time limits bound
  the surface. The code is cleared when stopped or on app exit. HTTP is not
  encrypted, so the setting warns against untrusted networks.
- Generated bundles and packages are excluded from Git and rebuilt for releases.
- Session export requires a native file selection. Its JSON intentionally
  includes saved directories and notification text; the UI warns before sharing.

## Verification

Executable `*.test.ts` files cover pure reducers, layout, preference migration,
theme separation, agent state, metadata, socket validation, preview policy,
terminal ownership, batching, and lifecycle behavior. Native Electron passes
exercise the real xterm and webview boundaries. The standard repository gate is:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```
