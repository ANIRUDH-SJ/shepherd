# 23 — Live workspace metadata

A terminal workspace is more useful when its sidebar answers two questions at a
glance:

```text
Where am I working?
Which version of the code am I changing?
```

On a Git project, those answers are the project root and checked-out branch. This
chapter develops the architecture behind live workspace metadata in cmux-linux:
how terminal state maps to UI state, how Linux exposes shell cwd, how to inspect
Git without excessive subprocesses, how to handle multiple terminals, and how to
persist useful state without restoring stale state.

## 1. Four related values that are not interchangeable

It is tempting to call everything “the cwd,” but the feature has four different
values:

| Value        | Example                     | Meaning                                                |
| ------------ | --------------------------- | ------------------------------------------------------ |
| Shell cwd    | `/work/cmux-linux/src/main` | Current directory of the interactive shell             |
| Git root     | `/work/cmux-linux`          | Top-level directory of the current repository/worktree |
| Project name | `cmux-linux`                | Compact label derived from Git root or shell cwd       |
| Git branch   | `feat/sidebar`              | Symbolic branch referenced by Git `HEAD`               |

The shell cwd changes when the user runs `cd`. The Git root normally remains
stable while moving within a repository. The branch can change without the cwd
changing at all.

Keeping these concepts separate avoids two common UI errors:

- showing `src` as the project because it is the cwd basename;
- missing `git switch` because the cwd did not change.

## 2. A workspace can own several directories

The application model is:

```text
Workspace
  -> split panes
     -> tabbed surfaces
        -> terminal processes
```

Two terminals in one workspace can legitimately be in different repositories.
There is no single directory that describes all of them.

cmux-linux defines the sidebar metadata as the context of the workspace's active
terminal:

```text
Workspace.activePaneId
  -> Pane.activeSurfaceId
  -> active terminal surface
  -> live shell cwd
  -> Git/project metadata
```

This rule is deterministic, easy to explain, and gives the sidebar an exact
navigation relationship. Clicking another pane or tab changes the metadata source.

Alternatives are weaker:

- “most recently active terminal” needs separate focus timestamps and can disagree
  with the visible selection;
- “workspace creation directory” becomes stale after `cd`;
- “first terminal in tree order” ignores the user's current focus.

## 3. Why Electron main owns discovery

The renderer knows which surface is selected, but it runs in Chromium with
context isolation. It should not read `/proc`, spawn Git, or traverse filesystem
metadata.

Electron main already owns node-pty and the terminal PID registry, so it has the
required operating-system authority. The responsibility split is:

```text
RENDERER                                  MAIN
------------------------------------      ---------------------------------
select pane/tab
resolve activeSurfaceId
        |
        +---- workspace sync ----------> target map
                                           |
                                           +-> shell cwd from /proc
                                           +-> bounded Git discovery
                                           +-> cached HEAD observation
        <--- workspace metadata -----------+
validate surface ownership
update reducer
render project + branch
```

No new preload filesystem method is needed. Main publishes an internal command
through the existing main-to-renderer bridge.

## 4. Linux exposes cwd as process state

Every Linux process has a symbolic cwd entry:

```text
/proc/<pid>/cwd
```

Reading the link returns the kernel's current path for that process. For a shell,
the link changes when `cd` succeeds because `cd` changes the shell process itself.

This is better than parsing a prompt:

- prompt formats are user-configurable;
- prompts may abbreviate or omit the cwd;
- output can contain old prompts from scrollback;
- shell themes add control sequences;
- a program can print text that resembles a prompt; and
- parsing terminal prose risks retaining user content.

The kernel link is structured state, not presentation.

## 5. Shell cwd versus foreground-process cwd

A PTY has an interactive shell and a foreground process group. They often have
the same cwd, but not always:

```text
zsh cwd=/work/project
└── agent
    └── build tool cwd=/tmp/generated
```

The foreground tool's cwd is valuable for agent inspection, but it is not the
durable location chosen by the user. If the sidebar followed the foreground PID,
it could flash between projects during a tool call.

Workspace metadata therefore reads `/proc/<shellPid>/cwd`. The shell PID was
recorded when node-pty created the terminal and remains the ownership anchor for
the surface.

The operation is race-prone by nature: a terminal can exit between registry
lookup and `readlink`. The code catches the failure and uses its inspected or
initial cwd as a bounded fallback. Process exit later removes the registration.

## 6. Git repository discovery

Given a cwd, we need two Git paths:

```text
worktree root
absolute Git directory
```

The worktree root supplies the project label. The Git directory contains `HEAD`.
These are not always `<root>/.git`; linked worktrees use a `.git` file that points
into the primary repository's metadata.

The selected command is:

```text
git -C <cwd> rev-parse --show-toplevel --absolute-git-dir
```

### Why invoke Git?

Walking parent directories for `.git` handles ordinary repositories but must
reimplement `.git` pointer files, worktrees, unusual layouts, and Git's own path
rules. Git is already required for the repository features and is the authority
on its storage model.

### Why `execFile` rather than a shell?

The cwd is process-derived data. Passing it as one argv value means characters
such as spaces, quotes, or semicolons are data, not shell syntax:

```ts
execFile('git', ['-C', cwd, 'rev-parse', ...])
```

No string command is constructed. The child has a 1.5-second timeout and an
8-KiB output bound. Output is accepted only when exactly two bounded absolute
paths are returned.

Failure means “not a Git repository” for this observation. It does not crash the
main process or block other workspaces.

## 7. A hybrid polling strategy

Live state needs polling because ordinary `cd` does not emit an event to the
Electron application. A naive design might run Git on every poll:

```text
workspaces x scans per second x Git processes
```

That scales poorly. The implementation separates location discovery from branch
observation.

### 7.1 Location discovery is cached

After a successful Git probe, the service caches:

```ts
{
  root: '/work/cmux-linux',
  gitDir: '/work/cmux-linux/.git'
}
```

As long as the shell cwd remains inside `root`, moving between subdirectories
does not require another Git process.

Leaving the root invalidates the location and triggers a new probe. A non-Git
directory is also cached; it is retried every five seconds so `git init` is
eventually discovered without spawning Git every 750 ms.

### 7.2 Branch observation reads `HEAD`

For a normal branch, `<gitDir>/HEAD` contains:

```text
ref: refs/heads/feat/sidebar
```

Removing the prefix yields `feat/sidebar`. `git switch` and `git checkout`
rewrite this file, so the next scan sees the change without spawning Git.

A detached checkout stores a commit object ID directly:

```text
0123456789abcdef...
```

The UI reports a bounded `detached@0123456` label. This is more truthful than
calling the branch `HEAD`.

If cached `HEAD` becomes unreadable, the previous observation is not blindly
replaced with malformed data. After the retry interval, Git location is probed
again.

## 8. Poll interval and fixed bounds

The scan interval is 750 ms. That is fast enough for the sidebar to feel live
after the shell prompt returns without turning state observation into a busy loop.

Per scan, the fixed work is approximately:

```text
one /proc shell-cwd read per registered terminal context
+ one HEAD read per active Git workspace
+ Git only for an invalidated or retry-eligible location
```

Other bounds include:

- one active surface per workspace;
- no overlapping metadata scans;
- 1.5-second Git timeout;
- 8-KiB Git stdout cap;
- 4096-character path cap;
- compact project-name cap; and
- deduplicated renderer emissions.

These bounds matter because the service runs for the lifetime of the application.

## 9. Async races and authority

Git discovery is asynchronous. During one probe, the user can select a different
tab. Publishing the old result would create a brief but incorrect sidebar state.

The service therefore treats the selected surface as an authority token:

```text
capture target surface
  -> inspect cwd
  -> await Git
  -> compare target surface again
  -> publish only if unchanged
```

The renderer performs a second check. Its reducer looks up the current active
surface and rejects metadata with another `surfaceId`.

This is defense in depth across an asynchronous IPC boundary:

- main prevents known-stale work;
- renderer protects the state owner from any late or malformed update.

## 10. Runtime validation

TypeScript types do not exist in the packaged JavaScript. The renderer uses a
runtime guard before dispatching metadata. It requires:

- a non-empty surface ID;
- an absolute cwd;
- a non-empty project name;
- an absolute or null Git root; and
- a string or null branch.

This is an internal channel, but validating it keeps the reducer's invariants
explicit and limits damage from version skew or a programming mistake.

## 11. Reducer state and persistence

The renderer workspace owns both durable and derived fields:

```ts
cwd: string // durable
projectName: string // derived
gitRoot: string | null // derived
gitBranch: string | null // derived
metadataSurfaceId: string | null // authority
```

When valid metadata arrives, `cwd` becomes the active shell's live cwd. The
existing layout snapshot already persists cwd, so relaunching starts the
workspace in the directory where the user left it.

Project, root, branch, and authority are deliberately not persisted. A branch can
change while the application is closed. Restoring yesterday's branch label would
be misleading, so derived values reset and are re-observed from Git.

The snapshot dependency is a serialized layout string. A branch-only reducer
update recomputes that string but produces the same value, so React does not run
the debounced save effect. A real cwd change does alter the snapshot and is saved.

## 12. Terminal startup propagation

Persistence is only useful if a restored terminal consumes the saved cwd. The
complete path is:

```text
Workspace.cwd
  -> WorkspaceView prop
  -> PaneView prop
  -> TerminalHost prop
  -> TermCreateOptions.cwd
  -> node-pty spawn option
```

The historical display value `~` is expanded to the operating-system home path
in main before node-pty receives it. Existing terminals do not restart when the
workspace cwd changes because the terminal creation effect is keyed by stable
surface identity. A newly created tab receives the latest workspace cwd.

This also completes cwd propagation for worktree-created workspaces.

## 13. UI and accessibility design

At the default sidebar width, a project and branch often cannot share one line.
The final layout uses two rows:

```text
workspace 1
cmux-linux
git: feat/sidebar
```

Each row truncates visually with an ellipsis and exposes the full value in a
tooltip. Project and branch use a monospace treatment that aligns with the
terminal context, while active-workspace colors maintain contrast.

The workspace's accessible label includes:

- display name;
- project name;
- exact branch or “not a Git repository”;
- active state; and
- agent rollup when present.

Existing status text remains a separate row. Project context no longer disappears
when an agent publishes a status.

## 14. Failure semantics

| Failure                         | Behavior                                      |
| ------------------------------- | --------------------------------------------- |
| Shell exits during cwd read     | Use bounded fallback; registration disappears |
| cwd is not a Git repository     | Show directory project and `git: no git`      |
| Git command times out           | Treat this probe as non-Git, retry later      |
| Git output is malformed         | Reject it; do not expose arbitrary text       |
| `HEAD` is detached              | Show `detached@<short-id>`                    |
| Active tab changes during probe | Drop the old result                           |
| Metadata payload is invalid     | Renderer ignores it                           |
| App shuts down                  | Cancel interval before terminal teardown      |

Errors are local to one observation. The sidebar, terminals, and other workspaces
continue operating.

## 15. Alternatives considered

### Parse shell prompts

Rejected because prompts are presentation, vary by shell/theme, and mix with
untrusted terminal content.

### Inject a shell hook after every command

Shell hooks can be immediate but require modifying user shell configuration or
wrapping prompts across Bash, Zsh, Fish, and others. `/proc` is zero-configuration
for the Linux target.

### Watch every repository file

Watching `.git/HEAD` requires first discovering the Git directory and managing
watcher lifecycle across cwd changes and worktrees. A bounded 750-ms read is
simpler, predictable, and already below the human interaction timescale.

### Run `git status` continuously

It provides extra information but can be expensive in large repositories and is
unnecessary for branch identity. Reading `HEAD` is narrower.

### Store one context per terminal in renderer state

That could make tab switching instantaneous, but it expands persistent state and
IPC traffic. The current requirement is the active terminal, so one authoritative
record per workspace is enough. Per-surface caching can be added later behind the
same metadata contract if measurements justify it.

## 16. Testing strategy

Pure helpers cover project-name rules, metadata equality, runtime validation,
Git output parsing, and `HEAD` parsing.

The discovery class accepts injected Git and `HEAD` readers. Its test can control
time and process contexts to prove:

- initial Git probing;
- cache reuse;
- no duplicate emissions;
- branch updates with no new Git process;
- cwd changes outside a repository; and
- active-surface ownership.

Reducer tests prove that valid metadata changes the workspace, invalid surface
ownership is ignored, and selecting a new surface clears stale branch data.

Finally, the visual smoke test crosses the real boundaries:

```text
node-pty shell
  -> /proc cwd
  -> real Git repository
  -> main scanner
  -> IPC command bridge
  -> React reducer
  -> sidebar CSS
```

Both `cd` and `git switch` were observed in an isolated Electron window.

## 17. Safe extension points

The same architecture can later add:

- dirty/clean state with a slower, separately bounded Git query;
- ahead/behind counts from Git status metadata;
- remote repository identity;
- pull-request status from an explicitly authenticated provider; or
- per-surface metadata caches for instant tab changes.

Each should remain derived, source-bounded, and independently refreshable. Branch
identity should not become coupled to slow network metadata.

## Checkpoint

1. Why are shell cwd and Git root separate fields?
2. Why does `/proc/<shellPid>/cwd` remain stable during a foreground tool call?
3. Why does the service need both Git root and absolute Git directory?
4. How does reading `HEAD` reduce subprocess churn?
5. Which checks protect against an async active-tab race?
6. Why is cwd persisted while branch is derived after restore?
7. What fixed limits keep this lifetime service predictable?
