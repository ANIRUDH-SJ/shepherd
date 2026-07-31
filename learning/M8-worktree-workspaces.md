# M8 — Git Worktree Workspaces: What We Actually Built

> This is the implementation diary for creating a Git worktree and opening it as
> a live Shepherd workspace in one command. For Git/worktree architecture,
> safety boundaries, alternatives, and tradeoffs, read
> `../textbook/20-worktree-workspaces.md`.

## 1. The goal

An agent should not switch the branch underneath another running agent. A Git
worktree gives each task its own directory, branch, terminal cwd, dependencies,
and uncommitted state while sharing one repository object database.

M8 adds:

```bash
shepherd new-worktree \
  --repo /projects/app \
  --path /projects/app-feature-login \
  --new-branch feat/login \
  --start-point main \
  --name login
```

The command mutates Git first. Only after Git succeeds does it create a workspace
whose initial terminal starts in the new worktree.

## 2. The complete flow

```text
bin/shepherd.js parses flags
  → socket.ts receives new-worktree
  → normalizeWorktreeRequest validates paths, branch mode, refs, and name
  → createGitWorktree runs bounded git child processes without a shell
  → socket routes new-workspace {name, cwd}
  → App.tsx calls createWorkspaceAction(name, cwd)
  → appReducer creates the layout with that cwd
  → TerminalHost asks main to spawn node-pty in the worktree directory
```

## 3. `src/main/worktree.ts` — validation and mutation

`normalizeWorktreeRequest()` requires:

- absolute repository and target paths, each bounded to 4,096 characters;
- exactly one of `branch` (attach existing) or `newBranch` (create new);
- `startPoint` only with `newBranch`;
- bounded, control-free branch/ref/name strings;
- a workspace name, defaulting to the branch.

`createGitWorktree()` then:

1. proves the repository directory exists;
2. rejects an already-existing target path;
3. asks Git for the canonical top-level repository;
4. asks Git to validate the branch with `check-ref-format --branch`;
5. runs either `git worktree add -- <path> <branch>` or
   `git worktree add -b <newBranch> -- <path> <startPoint>`;
6. returns canonical repo/path, branch, and whether it created the branch.

Every Git process uses `execFile`, an argv array, a 30-second timeout, and a 1 MiB
output cap. No value is interpolated into a shell command. Git remains the final
authority for branch occupancy, ref existence, repository locks, and races.

## 4. `src/main/socket.ts` and `bin/shepherd.js` — orchestration

The CLI exposes both branch modes:

```bash
# New branch from HEAD (or --start-point REF)
shepherd new-worktree --repo /repo --path /worktrees/task --new-branch feat/task

# Existing branch that is not checked out elsewhere
shepherd new-worktree --repo /repo --path /worktrees/review --branch review/topic
```

The socket validates before mutation. A Git failure returns an error and does not
create a workspace. On success it routes the existing `new-workspace` action with
the worktree path as `cwd`, then returns the worktree metadata to the caller.

The filesystem operation is not rolled back if the renderer disappears in the
small interval after Git succeeds. Automatic deletion could destroy legitimate
work, so cleanup stays an explicit Git operation.

## 5. Renderer cwd propagation

`makeWorkspace(name, cwd)` and `createWorkspaceAction(name, cwd)` now accept an
optional initial directory. Normal UI creation still defaults to `~`.

`App.tsx` reads the trusted `cwd` from the main-process socket command. The
workspace stores it in the same field already used by `WorkspaceView` and
`TerminalHost`, so no special worktree terminal path exists: the normal PTY spawn
flow simply receives the new cwd.

## 6. Tests

`src/main/worktree.test.ts` creates a disposable real Git repository and proves:

- new-branch creation from `HEAD`;
- existing-branch attachment;
- canonical path/result metadata;
- actual worktree `.git` metadata;
- absolute-path validation;
- mutually exclusive branch modes;
- start-point restrictions;
- forced cleanup after success or failure.

Reducer coverage proves explicit cwd propagation. Socket coverage proves invalid
requests fail before mutation, and the CLI process test proves every flag maps to
the expected wire keys.

## 7. Intentionally deferred

- automatic worktree deletion when a workspace closes;
- branch deletion or force operations;
- selecting a target directory in a GUI;
- opening a diff/review panel after creation;
- remote repositories or cloning;
- automatic dependency installation.

Those operations have different destructive or network consequences and should
not be hidden inside workspace close/create.

## Checkpoint

1. Why does the command require absolute repository and target paths?
2. Why use `execFile` instead of a shell command string?
3. Why does Git still validate after our own input validation?
4. Why is the workspace created only after `git worktree add` succeeds?
5. Why does renderer loss after Git success not trigger automatic deletion?
6. How does the new cwd reach node-pty without a worktree-specific terminal path?
