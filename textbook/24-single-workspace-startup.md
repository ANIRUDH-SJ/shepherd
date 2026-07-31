# 24 — Designing a single-workspace startup boundary

Session persistence and startup policy are related, but they are not the same
decision. Persistence answers:

> What durable state can the application serialize safely?

Startup policy answers:

> How much of that state should become live application state on launch?

Shepherd allows many workspaces during a running session, while deliberately
starting each new process with exactly one. This chapter explains why the policy
belongs in the renderer state boundary, how it stays compatible with older
snapshots, and what is gained and lost by selecting the previously active
workspace.

## 1. Cardinality is part of the product contract

A reducer can support `Workspace[]` without requiring every saved workspace to
be restored. These are independent cardinalities:

```text
runtime cardinality:  one or more workspaces
startup cardinality:  exactly one workspace
snapshot cardinality: exactly one workspace
```

The runtime remains flexible: users can open workspaces, worktrees, panes, and
tabs as needed. The process boundary is predictable: relaunch resumes one context
instead of reopening every context accumulated previously.

This distinction prevents a misleading diagnosis. If fresh construction returns
one workspace but startup displays two, the second workspace may be durable state,
not a duplicate constructor call.

## 2. Trace every initialization source first

Before changing state code, enumerate all paths that can create or recover the
top-level model:

```text
no valid snapshot                          valid snapshot
       |                                         |
       v                                         v
initialApp()                              sanitizeRestored(raw)
       |                                         |
       +------------------- ?? ------------------+
                            |
                            v
                    useReducer initial state
```

The nullish-coalescing expression chooses one source. It does not concatenate
fresh and restored arrays. Other creation paths—keyboard shortcuts, sidebar
buttons, and socket commands—run after startup in response to explicit events.

This is a useful debugging method beyond Shepherd: distinguish initialization,
rehydration, and later event handling before assuming a UI framework mounted
twice.

## 3. Why the renderer reducer owns the policy

Electron main reads opaque JSON from the application data directory. The preload
bridge transports it. Neither layer understands workspace selection, layout-tree
validity, or transient renderer fields.

The renderer's `appReducer.ts` already owns:

- the `AppState` and `Workspace` types;
- the invariant that at least one workspace exists;
- recursive layout validation;
- active-workspace selection;
- transient-state reset; and
- projection to a serializable layout snapshot.

Putting startup cardinality there keeps main and preload generic. It also makes
the behavior a pure transformation that can be tested without Electron, a
filesystem, or a live PTY.

## 4. Normalize first, project second

An older snapshot may contain several workspaces. The safe flow is:

```text
unknown JSON
   |
   v
validate container and every layout tree
   |
   v
normalize durable fields and reset transients
   |
   v
resolve activeWorkspaceId (or first valid fallback)
   |
   v
project to [activeWorkspace]
```

Why validate all entries if only one will be used? A strict session boundary has
simple semantics: a malformed snapshot is rejected as a unit. Silently skipping
bad inactive records could hide corruption and make behavior depend on which
workspace happened to be selected at shutdown.

The final projection is small:

```ts
const startupWorkspace = workspaces.find((workspace) => workspace.id === active) ?? workspaces[0]

return {
  workspaces: [startupWorkspace],
  activeWorkspaceId: startupWorkspace.id,
  agents: []
}
```

The active ID and array cannot disagree because both are derived from the same
object. This avoids a common normalization bug: filtering an array but leaving a
top-level selection ID pointing to a removed record.

## 5. Save and restore must agree

Applying a one-workspace rule only while loading is incomplete. Every launch
would keep parsing extra legacy entries, and another client reading the snapshot
would see a different contract from the application.

The serializer therefore performs the matching projection:

```ts
const workspace =
  state.workspaces.find((candidate) => candidate.id === state.activeWorkspaceId) ??
  state.workspaces[0]

return {
  workspaces: [
    {
      id: workspace.id,
      name: workspace.name,
      cwd: workspace.cwd,
      root: workspace.root,
      activePaneId: workspace.activePaneId
    }
  ],
  activeWorkspaceId: workspace.id
}
```

The snapshot remains structurally compatible with the previous format: it still
contains a `workspaces` array and `activeWorkspaceId`. Older multi-workspace files
load without migration, while the next save converges them to the new invariant.

## 6. What survives the process boundary

The selected workspace retains the durable recipe needed to reconstruct its UI:

| Preserved                    | Re-derived or reset                         |
| ---------------------------- | ------------------------------------------- |
| workspace ID and name        | live PTY processes                          |
| latest active cwd            | agent records and activity                  |
| panes, tabs, and split sizes | unread/attention flags                      |
| active pane/surface IDs      | token usage                                 |
|                              | project name, Git root, and branch metadata |

New PTYs spawn from the retained cwd. Git context is inspected again because the
repository or branch may have changed while the app was closed. Process-derived
agent state cannot be trusted across process lifetimes.

## 7. Technology choices

### Pure TypeScript transformation

The policy uses array lookup and object projection in a pure reducer module. No
React hook, Electron API, or filesystem mock is required in tests. Pure boundaries
make compatibility cases cheap to enumerate.

### Existing synchronous load

The preload still uses `sendSync` for the small startup snapshot. This avoids a
flash where a temporary workspace mounts and spawns a shell before restored state
arrives. The change reduces restored state size rather than introducing another
IPC exchange.

### Existing debounced save

`App.tsx` continues to serialize the layout and save after 500 ms. Agent updates
are absent from the projection, so activity polling cannot continuously restart
the timer. Changing cardinality does not require changing write scheduling.

## 8. Alternatives considered

### Restore every workspace

This maximizes continuity and was the previous behavior. It conflicts with the
new deterministic one-workspace startup requirement and can reopen a large set of
stale contexts.

### Always create a blank workspace

Ignoring the snapshot guarantees one workspace but discards useful layout and cwd
continuity. Resuming the active workspace satisfies the cardinality requirement
while retaining the context the user most recently selected.

### Deduplicate “similar” workspaces

Comparing names, cwd values, or layout shapes is unsafe. Two intentional
workspaces can point at the same repository and still host independent agents.
Identity-based deduplication cannot explain which ID should win. A product rule is
clearer than a heuristic.

### Prompt on every launch

A restore dialog can preserve a choice between one and many workspaces, but it
adds an Electron-window startup state machine and a repeated interaction. It is a
reasonable future setting, not necessary for a deterministic default.

### Store a scalar instead of an array

Changing the on-disk schema to `workspace: {...}` would express cardinality more
directly but force migration and duplicate serialization types. Keeping the
one-item array is backward-compatible and leaves room for a future “resume all”
setting.

## 9. Security and data boundaries

The policy does not add filesystem access, subprocess execution, shell parsing,
or IPC methods. Existing security properties remain important:

- input begins as `unknown` and is validated before use;
- layout trees are recursively checked before functions traverse them;
- environment variables, terminal text, and process arguments are not persisted;
- agent state and token usage are reset rather than trusted across launches; and
- the renderer receives only the same bounded layout fields as before.

Selecting one record also bounds the number of PTYs spawned during restore. That
reduces startup resource amplification from a large but otherwise valid snapshot.

## 10. Failure handling

The normal fallback ladder remains:

1. missing, unreadable, empty, or malformed snapshot returns `null`;
2. `App.tsx` falls back to `initialApp()`;
3. `initialApp()` creates exactly one default workspace;
4. a valid snapshot with a missing active ID selects its first valid workspace;
5. a valid multi-workspace snapshot selects its valid active workspace.

No failure path produces zero workspaces, and none appends a default workspace to
restored state.

## 11. Testing strategy

The regression test should use an old multi-workspace shape, not only the new
serializer. Otherwise save and load could share the same mistake and still pass.

The test therefore constructs two durable workspace records and marks the second
active. It asserts that restore returns one item with the second ID and cwd. A
separate assertion feeds live multi-workspace state into the serializer and
checks that its output also contains only the active record.

Existing tests continue to prove:

- fresh construction starts with one workspace;
- runtime creation can produce several workspaces;
- the last workspace cannot be closed;
- malformed trees fail closed; and
- transient runtime state is removed on restore.

Together these tests distinguish runtime flexibility from startup cardinality.

## 12. Tradeoffs and extension points

The deliberate cost is that inactive runtime workspaces are not reconstructed
after shutdown. Their live programs could not have survived anyway, but their
layout and cwd recipes previously did. The selected active workspace retains its
complete recipe.

A future startup setting can support both policies without changing main or
preload. Pass a policy into the pure projection:

```ts
type StartupPolicy = 'active-only' | 'resume-all'
```

`sanitizeRestored()` would choose either `[startupWorkspace]` or `workspaces`, and
the serializer would mirror that choice. If product requirements later demand a
recoverable previous-session archive, that belongs in the main-process storage
layer and should use atomic writes and explicit retention limits.

## Checkpoint

1. Why is a duplicate-looking startup row not necessarily a duplicate creation?
2. Why should normalization resolve one workspace object and derive both the array and active ID from it?
3. What compatibility advantage comes from retaining a one-item `workspaces` array?
4. Why is cwd durable while Git branch and agent activity are re-derived?
5. Which alternative best preserves continuity, and why was it not selected here?
