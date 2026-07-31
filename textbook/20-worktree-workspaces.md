# Chapter 20 — Git Worktrees as Isolated Agent Workspaces

## 20.1 The coordination problem

One checkout has one working tree and one checked-out branch. If two agents share
it, a branch switch, generated file, dependency update, or half-finished edit from
one task changes the environment underneath the other.

A Git worktree attaches another directory to the same repository:

```text
/projects/app                 main
/projects/app-login           feat/login
/projects/app-review          review/topic
          \________________ shared Git object database ________________/
```

Each directory has independent checked-out files and index state. Git objects and
most repository metadata remain shared, so it is faster and smaller than another
clone. This maps naturally to Shepherd: one worktree becomes one workspace cwd,
and every terminal/agent in that workspace starts inside the isolated directory.

## 20.2 Product contract

The implemented command supports two explicit modes:

```bash
shepherd new-worktree --repo /repo --path /worktrees/task \
  --new-branch feat/task --start-point main --name task

shepherd new-worktree --repo /repo --path /worktrees/review \
  --branch review/topic
```

`--new-branch` creates a branch from `--start-point` (default `HEAD`). `--branch`
attaches an existing branch. They are mutually exclusive because silently
guessing whether a ref should be created makes typos dangerous.

The result is both a Git worktree and a selected Shepherd workspace whose PTY
cwd is the canonical worktree path.

## 20.3 Architecture and sequencing

```text
CLI argv
  │ NDJSON over local Unix socket
  ▼
Electron main
  ├─ normalize request (pure)
  ├─ validate repository/ref with Git
  ├─ git worktree add (filesystem mutation)
  └─ send new-workspace {name, cwd} to renderer
                              │
                              ▼
React reducer → workspace/layout → node-pty spawn(cwd)
```

Git runs in main because the renderer is context-isolated and must not gain
filesystem or process primitives. The renderer still owns canonical workspace and
layout state. The socket handler therefore performs the external mutation, then
reuses the ordinary renderer workspace action.

This order prevents a dead workspace pointing at a path Git failed to create.
The reverse order would require rollback in both renderer and filesystem state.

## 20.4 Validation is defense in depth

The request boundary requires:

- absolute `repo` and `path` values;
- a non-existing target path;
- exactly one branch mode;
- `startPoint` only for a new branch;
- bounded, control-free strings;
- a bounded display name.

Absolute paths remove ambiguity about whether a relative target is based on the
app process, repository, pane cwd, or caller. They do not create a sandbox: the
local caller still chooses where to write, subject to OS permissions.

Application validation improves errors and blocks malformed inputs. Git still
performs authoritative checks:

```text
git -C <repo> rev-parse --show-toplevel
git check-ref-format --branch <branch>
git worktree add ...
```

Only Git knows whether the ref exists, a branch is already checked out, the
repository is locked, or another process won a race after our `exists` check.

## 20.5 Why `execFile` matters

Building this command as one shell string would turn paths and refs into shell
syntax. Quoting every shell and edge case is unnecessary risk.

`execFile('git', argv)` passes an argument array directly to the process:

```ts
await execFileAsync('git', ['worktree', 'add', '-b', branch, '--', path, start])
```

There is no shell interpolation. `--` ends option parsing before the absolute
target path. Execution also has a 30-second timeout and 1 MiB output cap so a
socket request cannot retain an unlimited child process or response buffer.

This prevents command injection; it does not make Git mutation harmless. Access
to the local socket already grants powerful workspace/terminal control, and a
future multi-user model needs restrictive socket permissions or peer credentials.

## 20.6 State ownership and cwd propagation

Main does not write renderer state directly. After Git succeeds it emits:

```ts
{
  method: 'new-workspace',
  workspaceId: null,
  params: { name, cwd: canonicalWorktreePath }
}
```

`App.tsx` creates a normal workspace action. `makeWorkspace(name, cwd)` stores the
directory, and the existing workspace/terminal component path passes it to
`node-pty`. Ordinary workspace creation still defaults to `~`.

Reusing the existing path is important: a “worktree workspace” is not a new
layout type, terminal type, or persistence format. It is a normal workspace with
a deliberately created cwd.

## 20.7 Failure and transaction boundaries

Before Git succeeds, any failure returns a socket error and creates no workspace.
After Git succeeds, the handler sends the renderer command and returns canonical
metadata.

There is a narrow non-transactional boundary: Electron could lose its renderer
after Git creates the directory but before the workspace appears. The code does
not automatically remove the worktree. Deletion may destroy uncommitted work, and
rollback cannot safely infer user intent. The recoverable outcome is an extra
valid worktree that the user can open or remove explicitly.

Likewise, closing a workspace does not delete its worktree or branch. UI lifetime
and source-control lifetime are separate.

## 20.8 Alternatives and tradeoffs

| Approach                        | Benefit                                       | Cost                                                                       |
| ------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------- |
| Switch branches in one checkout | simplest disk layout                          | tasks overwrite each other's working context                               |
| Clone for every task            | strong directory isolation                    | duplicates objects/config and fetch state                                  |
| Git worktree per workspace      | fast, shared objects, independent files/index | Git prevents one branch in two worktrees; lifecycle needs explicit cleanup |
| Let renderer run Git            | direct UI flow                                | breaks context isolation and expands the preload attack surface            |
| Shell command string            | little code                                   | quoting and command-injection risk                                         |
| Auto-delete on workspace close  | convenient cleanup                            | can destroy uncommitted work or a worktree still used elsewhere            |

The chosen design optimizes for explicit source-control mutation and reuse of the
existing workspace/PTY architecture.

## 20.9 Testing strategy

Mocking Git would prove argument construction but not worktree semantics. The
headless test creates a real temporary repository, makes an empty commit, then
proves both new-branch and existing-branch worktrees. Cleanup uses
`git worktree remove --force` inside a `finally` block and removes the temporary
directory.

Separate reducer, socket, and real CLI tests prove cwd propagation, validation
before mutation, and kebab-case flag mapping. The full test/lint/type/build gate
then catches integration and packaging regressions.

## 20.10 Extension points

Safe next layers can build on the returned canonical metadata:

- list registered worktrees and show branch provenance in the sidebar;
- open a bounded diff/review view for that worktree;
- offer explicit prune/remove commands with dirty-state confirmation;
- declare project bootstrap commands without running them implicitly;
- associate an agent session with the worktree path and branch.

Remote cloning, dependency installation, branch deletion, and forced cleanup have
different network/destructive authority and should remain separate commands.

## Checkpoint

1. Why is a worktree usually better than branch switching for concurrent agents?
2. What does a worktree share with the primary checkout, and what stays isolated?
3. Why are `--branch` and `--new-branch` separate?
4. Which validations belong to Shepherd, and which remain Git's authority?
5. What security property does `execFile` provide, and what does it not provide?
6. Why is Git created before renderer workspace state?
7. Why does workspace close not remove the worktree?
