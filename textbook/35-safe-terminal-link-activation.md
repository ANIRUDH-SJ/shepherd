# Chapter 35 — Safe Terminal Link Activation

Terminal links look like a small UI convenience. Architecturally, they connect
untrusted program output to desktop capabilities: opening a browser, revealing a
file, or launching another application. The important engineering work is not
drawing an underline. It is preserving the terminal interaction model and
building a narrow, validated path across Electron's trust boundary.

This chapter develops that path from terminal protocols through xterm cell
geometry, IPC design, Linux cwd resolution, security, failure handling, and
future editor integration.

## 1. Three kinds of terminal link

A modern terminal can expose links in three different ways.

### Plain HTTP(S) text

A process prints `https://example.com/docs`. The terminal recognizes the text
after rendering it. The bytes contain no special metadata.

### Plain file references

Compilers and agents commonly print `src/main.ts:42:7`. The path is relative to
the shell's current working directory, while the suffix means line 42, column 7.
This is only a syntactic candidate: `version.md` could be text, the file might
not exist, and the shell may have changed directories.

### OSC 8 hyperlinks

OSC 8 lets the producing application explicitly associate visible text with a
target:

```text
ESC ] 8 ; parameters ; URI ST visible text ESC ] 8 ; ; ST
```

The visible text and URI can differ. For example, a program can display
`open report` while linking it to `file:///tmp/report.html`. That expressiveness
also makes OSC 8 untrusted input. A label that looks harmless can carry a custom
scheme or remote file URI.

Shepherd supports all three, but they converge on one activation policy.

## 2. Why modifier-click is the right interaction

A terminal is already a mouse-driven text surface. Dragging selects output;
clicking focuses a pane; terminal applications may enable mouse reporting. If a
normal click opened every detected token, selecting a command or repositioning
focus would become dangerous and frustrating.

Shepherd uses Ctrl-click on Linux and accepts Meta-click for platforms where
that is conventional. Hover shows the pointer and underline, but an ordinary
click remains terminal interaction. This matches the broader integrated-terminal
pattern: the host terminal owns links, while the program running inside it does
not receive a privileged click.

The modifier check belongs in every renderer activation path, not only in the
file parser. Plain URLs, OSC 8 links, and custom file links must behave
consistently.

## 3. Detection is not authorization

The core design rule is:

```text
renderer detects and decorates
main authorizes and opens
```

The renderer must inspect xterm's buffer because it owns display geometry and
mouse interaction. It can cheaply find candidate tokens and calculate hover
ranges. It must not decide that a path is safe or call an operating-system
opener directly.

Electron main owns:

- the PTY registry and exact renderer ownership;
- the shell process ID and live working directory;
- Node filesystem APIs;
- Electron's external URL and file opening APIs.

The preload bridge exposes two purpose-built request functions instead of raw
`ipcRenderer`. This resembles a web application where the browser formats a
request but the server authenticates, validates, and authorizes it.

## 4. Link providers and xterm geometry

xterm link providers receive a one-based buffer line number and asynchronously
return links with one-based, inclusive cell ranges:

```ts
interface ILink {
  text: string
  range: {
    start: { x: number; y: number }
    end: { x: number; y: number }
  }
  activate(event: MouseEvent, text: string): void
}
```

A regular expression returns JavaScript string offsets, not cell positions.
They are different coordinate systems:

- JavaScript indexes UTF-16 code units;
- an ASCII character normally occupies one cell;
- a CJK glyph can occupy two cells;
- the cell following a wide glyph has width zero;
- a combining sequence can contain multiple code units in one cell.

Suppose the line is `界 src/main.ts`. The `s` begins at JavaScript index 2 but
terminal column 3, because `界` occupies columns 0 and 1. Adding one to a regex
index would underline the wrong cells.

Shepherd snapshots each meaningful buffer cell as:

```ts
{
  ;(startIndex, // UTF-16 inclusive
    endIndex, // UTF-16 exclusive
    startColumn,
    endColumn) // cell exclusive
}
```

Continuation cells are skipped. Empty width-one cells become spaces so offsets
remain stable. A candidate's first and final code units are mapped through this
table, then converted to xterm's one-based inclusive range.

The official WebLinks addon handles plain HTTP(S), including links wrapped over
multiple physical rows. Shepherd's custom file provider intentionally handles
one physical row in the first version. This keeps cwd/existence lookups bounded
and the coordinate mapper auditable. Supporting wrapped file paths later should
reuse a tested windowed-line algorithm rather than concatenating rows casually.

## 5. The two-phase file decision

File links use two checks.

### Hover-time resolution

When xterm asks for links on a line, the renderer parses at most 16 candidates
and sends only `{path, line?, column?}` values to main. Main reads
`/proc/<shell-pid>/cwd`, resolves each value, and returns a parallel boolean
array. Only existing files and directories receive decorations.

This prevents every file-looking word from becoming noisy UI and ensures a
project-relative path follows `cd` automatically.

### Activation-time revalidation

Hover is not a durable authorization. Between hover and Ctrl-click:

- the shell can run `cd`;
- a build can delete or replace the file;
- the terminal can close;
- a renderer can lose ownership.

Main therefore validates the entire request again, checks PTY ownership again,
reads cwd again, resolves the path again, and checks existence again. This is a
time-of-check/time-of-use defense. It cannot freeze the filesystem between the
final `stat` and desktop opener, but it prevents Shepherd from relying on stale
renderer state and safely reports a disappearing target.

## 6. Why the shell cwd is authoritative

A workspace stores a cwd for session restore and shows derived project metadata,
but neither is the authoritative location of a running shell. The user may type:

```bash
cd packages/renderer
```

without emitting a renderer state event. On Linux, Shepherd follows
`/proc/<shell-pid>/cwd`, where `<shell-pid>` is the registered interactive PTY
process. It deliberately does not follow the foreground child. If `npm test`
starts a tool in another directory, printed paths still normally follow the
interactive shell's context.

This is a Linux-specific but precise solution. A cross-platform port needs an
equivalent trusted cwd source or must narrow relative-path support.

## 7. IPC contract design

Terminal output can be controlled by a repository, a remote SSH host, or an
agent. Every payload is therefore bounded before filesystem work:

| Value                    | Bound               |
| ------------------------ | ------------------- |
| candidates per line      | 16                  |
| candidate path           | 1,024 characters    |
| external URL             | 2,048 characters    |
| terminal ID              | 256 characters      |
| line or column           | 1 through 1,000,000 |
| resolved filesystem path | 4,096 characters    |

The contract rejects control characters and unknown target kinds. A column is
invalid without a line. Requests are structured-cloneable plain data, and
failures return one of four stable categories: invalid request, missing
terminal, missing target, or opener failure.

Bounded failures are both a security and interface choice. The application does
not echo attacker-controlled paths or URLs into logs or terminal output.

## 8. URL and file policy

Plain and OSC 8 external URLs are parsed with the platform `URL` implementation.
Main accepts only `http:` and `https:`, requires a hostname, and rejects embedded
usernames or passwords. It sends the normalized URL to
`shell.openExternal`.

Local file targets can be:

- absolute paths;
- relative paths resolved under the live cwd;
- `~/` paths resolved under the user's home directory;
- `file:` URLs with an empty host or `localhost`.

Remote `file://host/...` values, file URL query strings, and fragments are
rejected. The final value must be absolute, bounded, control-free, and an
existing regular file or directory before `shell.openPath` receives it.

No shell command is built. A path containing spaces, quotes, semicolons, or
command-substitution syntax remains a single data value. This eliminates command
injection rather than attempting to escape it.

## 9. Lifecycle and asynchronous failure

Filesystem confirmation is asynchronous from xterm's perspective. The user can
move to another line or close the tab while a response is in flight. The custom
provider increments a request sequence and marks itself disposed during
teardown. It also snapshots the current row again before returning links. Older,
post-disposal, or repainted-row results complete xterm's callback with no links.

Activation is also failure-tolerant:

- a rejected IPC call becomes a static renderer warning;
- a missing terminal returns a stable result;
- a missing path does not open anything;
- `openExternal` rejection or an error string from `openPath` becomes
  `open-failed`;
- terminal cleanup disposes the custom provider before xterm itself.

The terminal continues functioning through every failure. Link support is
progressive enhancement, not part of the PTY data path.

## 10. Alternatives considered

### Let xterm or `window.open` open everything

This is compact, but it bypasses the ownership registry, weakens protocol
policy, and makes local paths difficult. In Electron, navigation and opener
capabilities deserve an explicit main-process boundary.

### Parse paths in main from terminal output

Main already sees PTY bytes, but raw stream chunks are not rendered lines.
Escape sequences, cursor movement, wrapping, and screen rewrites mean the byte
stream does not contain stable hover geometry. xterm's buffer is the correct
display model.

### Make every file-looking token a link

This avoids hover IPC but creates false positives and lets dead paths look
actionable. Lazy existence checks spend filesystem work only on the line being
inspected and make the UI truthful.

### Open a code editor at line and column now

Hard-coding `code --goto`, `$EDITOR`, or another command would introduce editor
preference, quoting, remote-workspace, and process-management questions. The
current contract preserves positions without claiming navigation. A future
editor service can consume the same target after an explicit preference exists.

### Single-click activation

It feels direct in a browser but conflicts with selection, focus, and mouse-aware
terminal applications. Modifier-click preserves established terminal behavior.

## 11. Testing the whole boundary

Pure tests are valuable because almost every decision can be dependency-injected:

1. Parser tests cover path families, punctuation, bounds, and invalid metadata.
2. Geometry tests include a two-cell wide glyph before a path.
3. Provider tests confirm existence filtering, modifier behavior, and disposal
   races.
4. Contract tests submit malformed shapes, oversized arrays, controls, and bad
   numeric positions.
5. Main tests inject a fake filesystem, home directory, cwd link reader, and
   desktop openers.
6. Runtime smoke tests use an isolated Electron user-data directory, a private
   Unix socket, and controlled terminal output.
7. CDP mouse input confirms actual pointer/underline decoration for URL, file,
   and OSC 8 targets and confirms a nonexistent path stays plain.

The visible smoke matters because a correct parser can still produce an
off-by-one xterm range or fail to register its provider.

## 12. Future extension points

The current architecture leaves narrow places to grow:

- add a user-selected editor service that consumes retained line/column data;
- support wrapped file references with a bounded windowed-line mapper;
- add an optional hover tooltip showing the resolved absolute target without
  exposing it to terminal output;
- cache short-lived existence results by terminal, cwd, and candidate if hover
  profiling shows filesystem pressure;
- add remote-workspace resolvers that open files through an explicit remote
  authority rather than pretending remote paths are local;
- add additional external schemes only through a named allowlist and dedicated
  handler.

The lasting lesson is broader than terminal links: when untrusted rendered data
requests an OS action, presentation can begin in the renderer, but authority,
validation, ownership, and revalidation belong at the privileged boundary.
