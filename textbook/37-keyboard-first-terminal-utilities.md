# Chapter 37 — Keyboard-First Terminal Utilities

A terminal application has an unusual interaction constraint: most keyboard input
belongs to the program running inside the terminal, not to the application chrome.
Adding search, a command palette, help, and settings therefore is not mainly a dialog
styling exercise. It is an ownership problem involving key events, imperative terminal
state, React state, focus, accessibility, and bounded work over a potentially large
scrollback buffer.

This chapter explains the engineering model Shepherd uses for those utilities.

## 37.1 Permanent chrome has a cost

Discoverability is useful, but a permanent shortcut card competes with the terminal on
every frame even though the user reads it rarely. A command palette has the opposite
shape:

```text
rare capability discovery -> temporary overlay -> action -> terminal focus restored
```

The utility is present in the product without becoming part of its default visual
hierarchy. This works only if entry points are discoverable, keyboard operation is
complete, and focus restoration is reliable.

Shepherd provides a small command button plus typed shortcuts. The button helps a new
user; the shortcuts make repeated use fast; contextual help explains the current map.

## 37.2 The command registry is an internal protocol

A shortcut system often starts as several unrelated `if (event.key === ...)` branches.
Later a palette duplicates the labels, and documentation duplicates them again. Those
copies drift.

Treat the registry as a small internal protocol instead:

```ts
interface AppCommand {
  id: AppCommandId
  title: string
  category: CommandCategory
  shortcut?: string
  shortcutKey?: string
  keywords: string
  availability?: AvailabilityRule
}
```

The ID is machine identity. The title and shortcut are presentation. Keywords are
search metadata. Availability is policy. Execution is owned separately by the app
shell because it needs current reducer state and existing actions.

This separation has useful properties:

1. The palette, shortcut help, and key resolver cannot disagree about command identity.
2. A closed TypeScript union makes missing execution branches a compile-time error.
3. Availability can be tested without rendering React.
4. Search ranking remains a pure function.
5. Future entry points can reuse the same protocol.

The registry must not contain executable closures when a plain data description is
enough. Closures capture state, obscure equality, and make testing or future
serialization harder. Shepherd resolves an ID against current state at execution time.

## 37.3 Contextual availability is capability policy

Some commands are structurally unsafe or meaningless in a given state:

- the last workspace cannot be closed;
- the last pane cannot be closed;
- one terminal cannot be closed when it is the final terminal under the current rule;
- unread navigation needs an unread notification.

The UI derives a small `CommandContext` from application state and asks
`commandEnabled(id, context)`. It does not store separate `canClosePane` state, because
that value is derived and could become stale.

There are two reasonable display policies:

| Policy                    | Advantage                                 | Cost                                       |
| ------------------------- | ----------------------------------------- | ------------------------------------------ |
| Hide unavailable commands | Shorter list                              | Users cannot learn that the command exists |
| Show disabled commands    | Explains the capability and current state | Slightly denser list                       |

Shepherd shows disabled commands after enabled commands and labels them unavailable.
The execution boundary checks availability again. Visual disabled state is guidance,
not authorization.

## 37.4 Ranking should be deterministic and bounded

A desktop command registry is small enough that fuzzy-search dependencies are often
unnecessary. Shepherd uses deterministic token scoring:

```text
exact title > title prefix > word prefix > category prefix > keyword occurrence
```

Every query word must match. Enabled results sort first, score sorts second, and source
order is the stable tie-breaker. Inputs and outputs are bounded: at most eight query
words, a 120-character input, and 20 returned commands.

These bounds are not about defending against a remote attacker; they keep behavior
predictable if synthetic input, accessibility software, or a future integration sends
unexpectedly large values. Determinism also makes ranking easy to regression-test.

## 37.5 Keyboard ownership at the terminal boundary

The terminal translates browser key events into bytes for the PTY. Stealing a common
combination can break shell and full-screen applications. `Ctrl+C`, for example, is
usually an interrupt byte. Plain `Ctrl+F` can belong to readline, Emacs, a pager, or an
application running inside the terminal.

Shepherd's global commands require exact Ctrl+Shift with neither Alt nor Meta. Shifted
punctuation is normalized because keyboard events vary:

```text
plus     can arrive as "+" or "="
minus    can arrive as "-" or "_"
zero     can arrive as "0" or ")"
comma    can arrive as "," or "<"
```

The handler prevents default and stops propagation only after a registered, enabled
command executes. Unknown and unavailable combinations continue to the terminal.

A once-installed global listener needs current state. Reinstalling it on each render is
correct when cleanup is perfect, but it creates needless churn and makes stale closure
bugs easier to introduce. Shepherd stores current state and the executor in refs:

```text
window keydown -> stable listener -> current executor ref -> current state ref
```

Refs are appropriate here because the callback is imperative and does not itself render
UI. The visible palette results still use normal React derivation.

## 37.6 Imperative xterm state inside declarative React

xterm.js is an imperative object. React owns when a `TerminalHost` exists, while the
host owns one long-lived terminal and its addons in refs. Search follows the same
lifetime:

```text
TerminalHost mounts
  -> create Terminal
  -> create FitAddon and SearchAddon
  -> load addons
  -> subscribe to search-result changes
  -> open terminal and connect PTY

TerminalHost unmounts
  -> remove renderer listeners
  -> dispose result subscription
  -> dispose addons/terminal and owned PTY
```

The `SearchAddon` must not be recreated for each query. Its search state and decorations
belong to the terminal instance, and repeated addon construction would leak listeners or
decorations.

React state stores only what React renders: whether find is open, the controlled query,
and the latest result position/count. The terminal buffer remains owned by xterm.

## 37.7 Surface-targeted find

A split workspace can contain multiple simultaneously visible terminal panels. A DOM
query for “the visible terminal” is ambiguous because one active tab exists in each
pane. Application state already knows the focused pane and its active surface.

The correct route is explicit:

```text
command execution
  -> read active workspace and pane
  -> obtain exact activeSurfaceId
  -> dispatch renderer event with surfaceId
  -> every TerminalHost compares the ID
  -> exactly one host opens find
```

This is an internal renderer event, not Electron IPC: both producer and consumers live
in the same Chromium renderer. Adding preload/main traffic would add a trust boundary
and lifecycle surface without providing value.

When find is invoked from a dialog, dispatch happens on the next event-loop turn. That
allows the overlay to unmount before the search input claims focus. Ordering is part of
the interaction contract.

## 37.8 Search bounds and the decoration API

Search work scales with scrollback size, match count, and query complexity. Shepherd
keeps that work explicit:

- xterm scrollback already has a global retention bound;
- the query is normalized to printable characters and capped at 512 characters;
- the official add-on handles literal search rather than arbitrary regular expressions;
- highlighted results stop at 1,000;
- UI result labels admit that cap with `1000+ results`.

The official search add-on uses xterm's decoration API to paint every match and the
active match. In xterm 6 that API is still marked proposed, so terminal construction
must set `allowProposedApi: true`. Without it, the search engine can collect results but
decoration registration throws before the add-on emits its result-change event. The UI
then misleadingly reports zero matches.

This is a good example of an integration contract that static typing cannot fully
prove. Both packages typecheck; the failure appears only when the add-on invokes the
guarded runtime API. The compatibility option belongs next to the bounded find config
and needs live integration proof.

Enabling proposed APIs has a tradeoff: xterm can change them between releases. The use
is constrained to an official addon pinned through the package lock. Dependency
upgrades must rerun the terminal-find interaction test.

## 37.9 Search interaction and failure behavior

The current-terminal search form uses familiar semantics:

| Input                | Result                                            |
| -------------------- | ------------------------------------------------- |
| Typing               | Incrementally selects the next match              |
| Enter                | Next match, wrapping through the buffer           |
| Shift+Enter          | Previous match, wrapping backward                 |
| Escape               | Clear decorations, close, restore terminal focus  |
| Empty query          | Clear decorations and reset result state          |
| Surface deactivation | Close without stealing focus from the new surface |

The query contains no shell command and crosses no process boundary. It searches the
already retained renderer buffer. Therefore it cannot read files or execute terminal
output. Control-character removal still matters because invisible input makes behavior
hard to inspect and could interact poorly with copy/paste or assistive software.

If SearchAddon is not ready, update returns without throwing. If WebGL is unavailable,
xterm's existing renderer fallback remains independent of search. Disposing the host
removes decorations and result subscriptions with the terminal.

## 37.10 Accessible combobox and listbox semantics

A command palette is visually a text field followed by rows, but assistive technology
needs the relationship encoded:

```text
dialog
└── input role=combobox
    ├── aria-controls -> results listbox
    ├── aria-expanded=true
    └── aria-activedescendant -> selected option ID

listbox
└── button role=option aria-selected=...
```

Keyboard selection stays in the input; `aria-activedescendant` tells a screen reader
which option is active. The selected DOM row scrolls into view. Home, End, ArrowUp,
ArrowDown, and Enter provide complete keyboard navigation, while click remains
available.

The result rows use stable command-derived IDs. If a query yields no commands, the
input drops `aria-activedescendant` and the list shows a plain empty-state message.

## 37.11 Modal focus is a state machine

Opening and closing a dialog is simple only when dialogs never replace each other. A
utility flow can be:

```text
terminal -> settings -> shortcut help -> command palette -> close
```

If each dialog captures the element focused immediately before it mounted, help may
capture a button inside settings. That button disappears when settings unmounts. On
final close, focusing the detached button fails and focus falls back to the document.

Model the whole chain as one focus transaction:

```text
first dialog opens: remember connected origin
dialog A -> dialog B: retain origin; do not restore
last dialog closes: clear transaction; restore connected origin
```

Shepherd's shared `DialogFrame` also:

- uses `role="dialog"` and `aria-modal="true"`;
- gives every dialog an accessible name and optional description;
- moves focus to the marked initial control;
- closes on Escape or backdrop activation;
- cycles Tab and Shift+Tab within enabled focusable controls;
- checks that the origin remains connected before restoring it.

The module-scoped focus origin is intentionally limited to the renderer's single
utility-overlay slot. If the product later allows multiple independent modal stacks,
this should become an owned stack or React context rather than one global variable.

## 37.12 Minimal settings as an honest capability surface

A settings page can easily promise more than the application implements. Shepherd's
entry has three roles:

1. Change the existing persisted terminal font size.
2. Explain current theme boundaries and reduced-motion behavior.
3. Link to the actual typed keybinding map.

Font size already has a settled data flow:

```text
settings button
  -> bump/reset helper
  -> clamp to 8..28
  -> localStorage shepherd.fontSize
  -> renderer custom event
  -> every TerminalHost updates font and refits PTY dimensions
```

Reusing it avoids a second source of truth. The settings dialog does not render shell,
theme editor, or key-remapping controls that have no backing contract. Informational
copy is preferable to a nonfunctional switch.

`localStorage` is sufficient for this renderer-only preference under the current
single-window model. A future multi-window or externally editable settings system would
move validated configuration ownership to main and expose it through preload IPC.

## 37.13 CSS and visual hierarchy

Utility CSS reuses the semantic token system from Chapter 25. The overlay darkens the
work area just enough to establish modality. Dialogs use one border, one shadow,
compact typography, and the existing focus and selection colors. No new brand palette
is introduced.

Two responsive contracts matter:

1. The dialog width is capped on ordinary windows but never exceeds the viewport.
2. On a narrow terminal pane, find sacrifices the result counter before sacrificing
   query and navigation controls.

Terminal find is positioned inside `.pane-body`, so each pane supplies the correct
containing block. It does not become global window chrome.

## 37.14 Security and trust boundaries

These utilities are renderer-local, but there are still boundaries to state clearly:

- Palette queries are data used by a literal ranking function, never evaluated.
- Terminal-find queries search retained text, never execute it.
- Command IDs come from a closed local registry, not arbitrary strings received over
  IPC.
- Execution rechecks contextual availability.
- Settings values pass through the existing numeric clamp before persistence.
- The dialog does not add Node or filesystem access to the sandboxed renderer.
- No terminal contents, search terms, or command queries are logged or sent externally.

Future project-defined commands would change this threat model. A `shepherd.json`
action cannot simply become an executable renderer closure. Main would need schema
validation, explicit working-directory policy, argument handling without a shell,
permission and trust UX, bounded output, and clear project ownership.

## 37.15 Testing strategy

Pure tests cover the stable policy layer:

- command IDs and displayed shortcuts are unique;
- multi-token and keyword ranking is deterministic;
- availability changes with context;
- exact modifier policy preserves ordinary terminal keys;
- shifted punctuation normalizes correctly;
- query normalization and result labels handle boundaries;
- the decoration compatibility flag remains enabled.

Typecheck and lint cover exhaustive execution, React props, ARIA values, and lifecycle
code. Production build proves xterm's search addon bundles with Electron/Vite.

Live Electron verification is essential for behavior that unit tests cannot model
cheaply:

- real PTY output appears in xterm scrollback;
- SearchAddon decorations work under xterm's runtime API guard;
- 1,100 matches remain bounded and announced;
- Enter/Shift+Enter wrap and Escape restores xterm focus;
- palette ranking executes against real app state;
- ARIA roles and active descendant relationships exist in the DOM;
- settings changes update persistence and live terminals;
- dialog-to-dialog transitions preserve the original focus transaction;
- a 520×560 viewport contains the palette.

The most valuable live failure was not visual. Runtime exception capture revealed the
missing proposed-API flag. Interaction tests should collect console exceptions, not
only inspect screenshots.

## 37.16 Operational behavior and performance

When utilities are closed, the palette, help, and settings components do not exist in
the DOM and install no listeners. The one global shortcut listener is constant. Each
mounted terminal owns one SearchAddon, but search performs work only for a non-empty
query. Highlight count and query length are bounded.

Changing font size refits every mounted terminal, which is correct but proportional to
the number of retained surfaces. The existing terminal lifecycle/memory limits remain
the governing scale boundary.

No main-process service, background timer, network probe, persistence schema, or IPC
channel was added. This is deliberately a renderer capability layered over settled
state and terminal ownership.

## 37.17 Alternatives considered

### Browser-native page find

Chromium find searches DOM text, not xterm's full logical scrollback buffer, and cannot
provide terminal-aware match selection. The official xterm addon is the correct owner.

### A third-party fuzzy-search library

The registry is small. A dependency would add bundle and ranking complexity without a
meaningful user benefit. Pure deterministic scoring is sufficient and testable.

### A permanent settings sidebar

That would reintroduce the dashboard-like chrome M24 removed. Settings are infrequent
and fit a temporary dialog.

### Individual shortcut handlers in each component

This distributes ownership and causes collisions and stale documentation. A central
typed registry plus a current-state executor is easier to reason about.

### Main-process search

Main does not own xterm's rendered scrollback. Mirroring all terminal output for search
would duplicate retention, increase memory, and create a new sensitive-data boundary.

### Enabling regular-expression search

Regex is powerful but adds syntax errors and potentially more expensive queries.
Literal current-terminal search meets the immediate workflow with a smaller failure
surface.

## 37.18 Extension points

The architecture allows deliberate growth:

- command groups or recent-command weighting can extend the pure ranker;
- user keymaps can compile into the same registry after conflict validation;
- main-owned configuration can replace localStorage without changing dialog semantics;
- project actions can resolve to validated main-process capabilities;
- a preview panel can register commands without building a second palette;
- search options such as case sensitivity can be added as explicit bounded state;
- multiple modal stacks can replace the single focus transaction with a context-owned
  stack.

The rule is to preserve one source of command identity and keep terminal key ownership
explicit.

## Checkpoint

1. Why is a command registry closer to an internal protocol than to a menu array?
2. Why does exact Ctrl+Shift matching matter more in a terminal than in a normal form?
3. Which state belongs in React, and which remains owned by SearchAddon/xterm?
4. Why can two visible panes make a “visible terminal” DOM selector incorrect?
5. What runtime failure does `allowProposedApi` prevent?
6. Why must focus restoration span a chain of replacing dialogs?
7. What new trust boundary would repo-defined palette actions introduce?
