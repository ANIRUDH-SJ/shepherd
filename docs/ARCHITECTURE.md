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

Session persistence stores the active workspace recipe, pane tree, safe preview
URLs, and working directories. Restoring a session creates fresh PTYs; it does
not serialize a running process or retain ephemeral agent and usage telemetry.

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

## Workspace metadata

The main process inspects only the active terminal target for each workspace. It
reads the interactive shell's working directory, resolves its Git root and HEAD,
queries an optional GitHub pull request with bounded output, and discovers TCP
listeners owned by descendant processes.

Metadata polling is adaptive and cached. Changing terminal surfaces invalidates
the surface-specific Git probe and requests an immediate reconciliation. Ports
are normalized, bounded, and associated only with the process tree that owns
them.

## Appearance

Renderer preferences use a versioned local-storage record. Migration accepts the
older standalone font-size keys and produces one validated `RendererPreferences`
object containing terminal font size, application appearance mode, and terminal
palette identifier.

Application appearance and terminal colors are intentionally independent. The
main process applies `system`, `light`, or `dark` to Electron `nativeTheme` and
reports the resolved mode. Semantic CSS tokens style application chrome. xterm
receives a separate immutable ANSI palette, currently Graphite.

## Security boundaries

- Context isolation and sandboxing stay enabled for renderer-facing content.
- IPC, socket, agent, usage, workspace, link, and preview payloads are validated.
- Terminal links allow HTTP(S) and existing local files; they never invoke a
  shell command.
- Preview surfaces accept loopback destinations only and use an ephemeral guest
  partition with remote requests, popups, downloads, and permissions blocked.
- Agent inspection returns bounded plain text and safe process identity rather
  than arbitrary process memory or environment contents.
- Generated bundles and packages are excluded from Git and rebuilt for releases.

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
