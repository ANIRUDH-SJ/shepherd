# M11 — Live workspace project and Git branch

## The goal

The workspace subtitle used to be the static string `~`. It described only the
directory used when the workspace was created, so it did not answer the useful
questions:

- Which project is this workspace currently in?
- Which Git branch is checked out?
- Did either value change after `cd`, `git switch`, or `git checkout`?

M11 replaces that placeholder with two live sidebar rows:

```text
cmux-linux
git: feat/live-workspace-git-metadata
```

Outside a repository, the branch row says `git: no git`. Both values follow the
active terminal in each workspace automatically.

## What changed

| File                                           | Responsibility                                                 |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `src/main/workspaceMetadata.ts`                | Poll active terminals, resolve Git, cache, and publish changes |
| `src/main/workspaceMetadata.test.ts`           | Test project changes, branch changes, caching, and ownership   |
| `src/shared/workspaceMetadata.ts`              | Shared metadata contract, project labels, and runtime guard    |
| `src/main/terminalInspection.ts`               | Include the interactive shell's live cwd in terminal contexts  |
| `src/shared/ipc.ts`                            | Mirror each workspace's active terminal surface to main        |
| `src/main/index.ts`                            | Start, update, and stop the metadata service                   |
| `src/renderer/src/state/appReducer.ts`         | Own live metadata and persist the latest active cwd            |
| `src/renderer/src/App.tsx`                     | Send active surfaces and apply validated metadata pushes       |
| `src/renderer/src/components/Sidebar.tsx`      | Render separate project and Git rows                           |
| `src/renderer/src/components/TerminalHost.tsx` | Start restored/new terminals in the workspace cwd              |

## 1. The shared contract

`WorkspaceMetadata` is deliberately small:

```ts
interface WorkspaceMetadata {
  surfaceId: string
  cwd: string
  projectName: string
  gitRoot: string | null
  gitBranch: string | null
}
```

`surfaceId` is important. A workspace can contain several panes and tabs, each
with a different directory. The renderer accepts metadata only when its
`surfaceId` is still the active terminal for that workspace.

`isWorkspaceMetadata()` validates the main-to-renderer payload at runtime. The
TypeScript interface protects code during compilation; the runtime guard protects
the application boundary after the types have disappeared.

`workspaceProjectName()` uses the repository root basename when Git exists. If
the shell is in `cmux-linux/src/renderer`, the project remains `cmux-linux`.
Outside Git it uses the current directory basename, and the home directory is
shown as `Home` rather than `~` or the account name.

## 2. Choosing which terminal represents a workspace

The renderer already knows this hierarchy:

```text
Workspace
  -> activePaneId
  -> Pane.activeSurfaceId
  -> terminal surface
```

The workspace-sync message now includes the resolved `activeSurfaceId` for each
workspace. Main never guesses from “most recently active” process data; it tracks
the exact surface selected by the renderer.

When the user selects another pane or tab, the reducer clears the old metadata
authority immediately. The next main-process scan fills it from the new active
surface. Agent focus uses the same rule because it can also change the selected
terminal.

## 3. Reading the live cwd

Each terminal inspection record already owns the shell PID created by node-pty.
Linux exposes that process's current directory at:

```text
/proc/<shellPid>/cwd
```

This symbolic link changes when a shell builtin such as `cd` changes directory.
There is no need to parse prompts, shell history, escape sequences, or command
text.

M11 deliberately reads the shell PID rather than the foreground process PID. An
agent or user may run a child command with a temporary cwd. That child should not
rewrite the workspace project; the interactive shell remains the durable
workspace location.

If the process exits between reads, inspection falls back to its last safe cwd.
The next scan naturally stops producing metadata once the terminal registration
is removed.

## 4. Discovering the Git repository

When a cwd is new, main runs Git with an argument array:

```text
git -C <cwd> rev-parse --show-toplevel --absolute-git-dir
```

There is no shell interpolation. The process has a 1.5-second timeout and an
8-KiB output limit. Both returned paths must be absolute and at most 4096
characters.

The two paths serve different purposes:

- `--show-toplevel` supplies the stable project root;
- `--absolute-git-dir` finds the real Git metadata directory, including linked
  worktrees whose `.git` entry is a file.

If Git returns an error, the cwd is treated as a normal non-Git directory.

## 5. Detecting branch changes cheaply

Running Git for every workspace every 750 ms would work, but it would create many
short-lived processes. Instead, the service caches the repository root and Git
directory after the first successful probe.

Subsequent scans read only `<gitDir>/HEAD`:

```text
ref: refs/heads/main
```

That becomes `main`. A detached HEAD contains a commit hash and becomes a bounded
label such as `detached@0123456`.

The service re-runs Git only when:

- the shell leaves the cached repository;
- a previously non-Git cwd changes;
- a non-Git directory reaches its five-second retry window, allowing `git init`
  to appear; or
- a cached Git `HEAD` becomes unreadable long enough to require revalidation.

Moving between subdirectories in one repository does not spawn Git again.

## 6. Reconciliation and deduplication

`WorkspaceMetadataDiscovery` scans every 750 ms and prevents overlapping scans.
It builds a map of current terminal contexts, then reconciles only the active
surface for each workspace.

Git probing is asynchronous, so the selected surface can change while a probe is
running. Before emitting, the service checks that the workspace still targets the
same surface. Late results from an old tab are discarded.

The cache compares all five metadata fields. An unchanged scan emits nothing, so
React, session persistence, and the renderer-to-main workspace mirror do not
churn.

Updates reuse the existing main-to-renderer command bridge:

```text
workspace-metadata
  -> workspaceId
  -> { metadata }
```

The public socket dispatcher does not accept this as a client command; it is an
internal typed update.

## 7. Reducer ownership and persistence

The renderer `Workspace` now owns:

```ts
projectName: string
gitRoot: string | null
gitBranch: string | null
metadataSurfaceId: string | null
```

The reducer checks that `metadataSurfaceId` matches the active surface before
applying an update. It also replaces `workspace.cwd` with the shell's live cwd.

Only `cwd` enters the existing layout snapshot. Project and branch are derived
runtime data and are reset on restore. This gives two useful properties:

1. relaunching a workspace starts its first shell in the last active directory;
2. stale project or branch text is never restored before Git is inspected.

Branch-only changes do not alter the serialized snapshot, so they do not trigger
unnecessary session writes.

## 8. Correct terminal startup cwd

The workspace model already carried a cwd, including worktree paths created by
M8, but `TerminalHost` did not pass it through every component layer to
`terminal.create`.

M11 completes that path:

```text
Workspace.cwd
  -> WorkspaceView
  -> PaneView
  -> TerminalHost
  -> terminal.create
  -> node-pty cwd
```

The display shorthand `~` is normalized to the real home directory in Electron
main. A new tab starts in the workspace's latest active cwd without remounting
existing terminal processes when metadata changes.

## 9. Sidebar rendering

Each workspace now renders project and branch on separate lines. Separate lines
are intentional: the default sidebar is too narrow for two long values on one
line. Both fields use ellipsis and expose their full values through tooltips.

The row's accessible label includes the project and either the exact branch or
“not a Git repository.” Existing status, usage, unread, attention, and agent
rollup lines remain independent.

## 10. Verification

Automated tests cover:

- home, repository, and non-Git project labels;
- absolute Git path parsing and relative-path rejection;
- normal and detached `HEAD` values;
- initial project/branch publication;
- unchanged-scan deduplication;
- Git-location cache reuse;
- branch changes without another Git process;
- `cd` outside a repository;
- active-surface authority;
- renderer runtime validation;
- reducer cwd/project/branch updates and stale-surface rejection;
- metadata clearing after a pane/surface change; and
- terminal context cwd propagation.

The isolated visual smoke test performed real commands in the app:

```text
cd /tmp/cmux-meta-live-...
git switch -c feat/sidebar-smoke
```

The sidebar first changed from `Home / no git` to the temporary project on
`main`, then changed to `feat/sidebar-smoke` without a reload or manual refresh.

## Intentional limits

- Live cwd discovery uses Linux `/proc`, matching the project's Linux target.
- Metadata represents the active terminal in a workspace. Other tabs can have
  different directories and are shown when selected.
- The sidebar shows the checked-out branch, not dirty state, ahead/behind counts,
  remote name, or pull-request status.
- A deleted or inaccessible cwd keeps its last safe display until the terminal
  exits or another valid update arrives.

## Checkpoint

1. Why does the service inspect the shell cwd instead of the foreground command cwd?
2. Why does the renderer send `activeSurfaceId` to main?
3. When does the service spawn Git, and when does it read only `HEAD`?
4. What prevents a late Git probe from updating the wrong tab?
5. Which metadata is persisted, and why are project/branch derived after restore?
