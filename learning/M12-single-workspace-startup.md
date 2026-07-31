# M12 — Single-workspace startup

## The goal

The application already created one workspace for a brand-new session, but it
could reopen several workspaces from `session.json`. That made a relaunch look as
though startup had created duplicates. M12 makes the startup contract explicit:

> Every app launch begins with exactly one workspace.

The previously active workspace is the one resumed. Its name, latest cwd, pane
tree, tabs, split sizes, and active pane remain intact. Other workspaces still
work normally during the current process, but they are not replayed on the next
launch.

## What changed

| File                                              | Responsibility                                      |
| ------------------------------------------------- | --------------------------------------------------- |
| `src/renderer/src/state/appReducer.ts`            | Select and persist one active startup workspace     |
| `src/renderer/src/state/appReducer.test.ts`       | Regress legacy restore and new snapshot cardinality |
| `learning/M12-single-workspace-startup.md`        | Walk through the repository implementation          |
| `textbook/24-single-workspace-startup.md`         | Explain the architecture and design tradeoffs       |
| `README.md`, `ROADMAP.md`, `FEATURES.md`, indexes | Publish the settled startup contract                |

No main-process, preload, IPC, PTY, or component changes were needed. The
renderer already owns workspace state and session normalization, so the policy
belongs at that boundary.

## 1. Finding the real cause

`initialApp()` has always minted one workspace:

```ts
export function initialApp(): AppState {
  const ws = makeWorkspace()
  return { workspaces: [ws], activeWorkspaceId: ws.id, agents: [] }
}
```

`App.tsx` does not append that workspace to restored state. It chooses one source
or the other:

```ts
const INITIAL_APP = sanitizeRestored(window.api?.session?.loadSync?.() ?? null) ?? initialApp()
```

An isolated launch with a new `SHEPHERD_SESSION_PATH` produced a one-workspace
snapshot. The multi-row startup therefore came from a valid saved snapshot, not
React mounting twice or two workspace-creation actions.

## 2. Restoring the active workspace only

`sanitizeRestored()` still validates every stored workspace recursively. That
keeps the existing fail-closed behavior: malformed layout trees do not enter the
application merely because they are inactive.

After normalization, it resolves the saved `activeWorkspaceId`, falling back to
the first valid workspace when necessary. The final step now selects that record:

```ts
const startupWorkspace = workspaces.find((workspace) => workspace.id === active) ?? workspaces[0]

return {
  workspaces: [startupWorkspace],
  activeWorkspaceId: startupWorkspace.id,
  agents: []
}
```

This also accepts older multi-workspace snapshots without a schema migration.
Transient agent state, attention flags, Git metadata, and usage telemetry remain
reset exactly as before.

## 3. Persisting the same policy

Fixing only restore would repeatedly read old extra workspaces. Therefore
`toLayoutSnapshot()` now resolves the active workspace and serializes a one-item
array. It preserves that workspace's durable fields:

- stable workspace ID and custom name;
- latest active cwd;
- pane/surface layout tree;
- active pane ID.

The existing 500 ms save effect in `App.tsx` remains unchanged. It still depends
only on serialized layout JSON, so agent-status churn cannot cause extra writes.

## 4. Regression coverage

`appReducer.test.ts` now constructs a two-workspace legacy snapshot whose second
workspace is active. It verifies that restore:

1. accepts the old shape;
2. returns exactly one workspace;
3. chooses the saved active workspace; and
4. preserves its cwd.

A second assertion checks that serializing a live multi-workspace state writes
only the active workspace. Existing tests still cover fresh startup, malformed
trees, transient resets, workspace creation, selection, and closure.

## 5. Operational behavior and limits

Creating several workspaces remains useful for parallel work during one app run.
Closing the app is now an intentional boundary: only the workspace selected at
shutdown resumes. Its shells are still newly spawned processes; persistence
restores layout and cwd, not command execution or terminal memory.

This policy trades full multi-workspace recovery for deterministic startup. A
future settings screen can offer “resume all workspaces” without moving session
ownership out of the reducer; it would parameterize the final selection and
snapshot projection.

## Checkpoint

1. Why could `initialApp()` not be the source of the observed second workspace?
2. Why does restore validate every legacy workspace before selecting the active one?
3. Why must save and restore enforce the same cardinality policy?
4. Which workspace data survives, and which transient data is deliberately reset?
