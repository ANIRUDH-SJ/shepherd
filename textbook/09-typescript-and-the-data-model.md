# Chapter 9 — TypeScript & the Data Model

> **What you'll learn**
>
> - The five TypeScript features this app is actually built on — **interfaces, union types, literal types, discriminated unions, and a little generics** — taught through _our_ types, not toy examples
> - Why a **discriminated union** is the single perfect tool for two of this app's core shapes: a panel that is _one of several kinds_, and a pane tree that is _leaf-or-split_
> - The complete data model in compilable TypeScript, built bottom-up: `Panel → Surface → Pane → PaneNode → Workspace → AppWindow`
> - How `PaneNode` is a **recursive** discriminated union, and how to **narrow** it safely in code (including the `never` exhaustiveness trick)
> - Why one `shared/types.ts` imported by _both_ main and renderer is the contract that keeps the two processes honest
> - How to type the socket protocol (`{id, method, params}`) and IPC payloads — and the hard truth that **types vanish at runtime**, so the wire still needs real validation
> - The three type-safety mistakes this architecture invites: `any` leaking across the IPC boundary, forgetting to narrow a union, and assuming a type validates runtime data
>
> **Prerequisites:** `08-react-in-this-app.md` — you've already _seen_ these types used (`Workspace`, `PaneNode`, `Panel`) inside the components; this chapter finally _defines_ them. Comfort with React/TypeScript basics is assumed. We do **not** re-teach what an interface _is_; we go deep on how _this_ app models its data.

---

## 9.1 The data model _is_ the app

Most tutorials treat TypeScript types as tidy decoration — annotations you sprinkle on so the editor autocompletes. In Shepherd they are load-bearing structural steel, and the reason is the architecture you already know: **this is a two-process app, and the two processes only ever exchange JSON.**

Recall the shape from chapters 1 and 8:

- The **main process** owns the _real_ state — the authoritative tree of workspaces, panes, terminals (chapter 3). It is the source of truth.
- The **renderer** holds a _mirror_ it keeps fresh by receiving snapshots over IPC (chapter 4) and by listening to the socket-driven pushes (chapter 11).
- Neither side can reach into the other's memory. Every workspace, every pane, every status pill is **serialized to JSON, pushed across a boundary, and rebuilt on the far side.**

That means the _shape_ of a `Workspace` is a **contract between two programs**. Main promises "a workspace looks like this"; the renderer builds its entire UI trusting that promise. If the two sides disagree by even a field name — main writes `needsAttention`, the renderer reads `attention` — nothing crashes. You just get a sidebar that never lights up, and a silent afternoon of debugging.

TypeScript's whole job in this app is to make that disagreement **impossible to compile**. Define the shape once, import it on both sides, and the compiler becomes the referee that guarantees main and renderer are talking about the same thing.

```
        ┌──────────────── shared/types.ts ────────────────┐
        │   interface Workspace { … }   (ONE definition)  │
        └───────────────┬──────────────────┬──────────────┘
              import type │                  │ import type
                          ▼                  ▼
                  ┌───────────────┐   ┌───────────────┐
                  │  MAIN (Node)  │   │ RENDERER (DOM) │
                  │ builds & owns │   │ mirrors & draws│
                  │  Workspace[]  │──►│  Workspace[]   │
                  └───────────────┘JSON└───────────────┘
                          the SAME type on both ends of the wire
```

> **🔧 In Shepherd:** think of `shared/types.ts` as the OpenAPI schema of a normal web app — the agreed contract between a client and a server. The twist: here client and server are the _same repository_ compiled together, so instead of generating types from a schema and hoping they stay in sync, you get the contract enforced by the compiler **for free**. Lean into that. It is one of the biggest advantages of building the whole app in one language.

So this chapter has two halves. First (§9.2–9.3) a focused tour of the exact TypeScript features the model needs — no more, no less. Then (§9.4–9.10) we build the entire data model in real, compilable TypeScript, one layer at a time, and end with the sobering reminder that none of it exists at runtime.

---

## 9.2 The five TypeScript features this app is built on

You know TypeScript already, so this is not a language course. It is a _curated_ tour: the five features that carry the data model, each shown on a piece of the actual app. If you're solid on all five, skim to §9.4.

### 1. Interfaces — the shape of an object

An `interface` names the shape of an object: which fields exist and what type each holds. Optional fields get a `?`. This is the workhorse for every "record-like" thing in the model.

```ts
interface Surface {
  id: string
  title: string
  panel: Panel // a field can be another one of our types
}
```

We use `interface` (not `type X = { … }`) for plain object shapes by convention — they read well and give nicer error messages. We'll reach for `type` when we need a _union_ (below), which interfaces can't express.

### 2. Union types — "one of these"

A union type (`A | B`) says a value is _one of several_ types. The most common one in this app is the humble nullable:

```ts
let activeWorkspaceId: string | null = null // either an id, or nothing selected yet
```

You saw this exact type in chapter 8's `useWorkspaces()`. A union is "OR at the type level," and it forces you to handle _every_ possibility before TypeScript lets you use the value — which is the whole point.

### 3. Literal types — a specific value _is_ a type

This is the feature people underuse, and it's the key that unlocks everything later. In TypeScript, a specific string can be its own type. The value `'terminal'` has the type `'terminal'` — a type with exactly one inhabitant.

```ts
type PanelType = 'terminal' | 'preview' // a union of two string LITERALS
let t: PanelType = 'terminal' // ✅
let x: PanelType = 'website' // ❌ Error: '"website"' is not assignable to 'PanelType'
```

`PanelType` is not `string`. It is _exactly_ `'terminal'` or `'preview'` and nothing else. The compiler now rejects typos and impossible values at the door. We use literal types everywhere a field is drawn from a fixed vocabulary: panel kinds, split directions (`'row' | 'column'`), status colors, PR states, and log levels.

> **⚠️ Gotcha:** literal types **widen** unless you stop them. Write `const dir = 'row'` and TypeScript infers the literal `'row'`; but write `let dir = 'row'` or put it in an object property, and it widens to `string`. That bites when you build model objects by hand — see the gotcha in §9.6.

### 4. Discriminated unions — "one of these, and I can tell which"

Take a union of object types, give every member a **common field whose type is a distinct literal**, and you have a _discriminated union_ (a.k.a. tagged union). That shared literal field is the **discriminant** (or "tag"). It is the most important single pattern in this entire chapter, so it gets its own section (§9.3) and drives §9.4 and §9.6. Preview:

```ts
type Panel =
  | { type: 'terminal' } // tag: type = 'terminal'
  | { type: 'preview'; url: string } // tag: type = 'preview'
```

Because the `type` field is a distinct literal in each member, checking it _tells the compiler which member you have_ — and unlocks the fields specific to that member. That's **narrowing**, and it's what makes this pattern magic.

### 5. A little generics — types with a hole

A generic is a type parameterized by another type — `Array<T>` is the one you already use daily. We need only a _little_ generics in this app: mainly a reusable envelope for socket responses.

```ts
interface Ok<T> {
  id: number
  result: T
} // T is a placeholder
interface Err {
  id: number
  error: { code: number; message: string }
}
type Response<T> = Ok<T> | Err

type WorkspaceListResponse = Response<Workspace[]> // fill the hole with a real type
```

`Response<T>` is a shape with a hole; `Response<Workspace[]>` fills the hole. We'll use exactly this in §9.9 to type the socket API's replies without rewriting the envelope for every method. That's the extent of the generics you need here — resist inventing more.

Those five — **interfaces, unions, literals, discriminated unions, generics** — are the whole toolbox. Everything below is built from them.

---

## 9.3 Why discriminated unions fit this app so perfectly

Two of this app's core shapes are naturally "a value that is _one of several kinds_, where the kind decides what other data exists":

- A **panel** is either a terminal or a constrained localhost preview. A terminal has no
  URL; a preview has a validated loopback URL and does not own a PTY.
- A **layout node** is either a _leaf_ (which holds one pane) or a _split_ (which holds child nodes and their sizes). A leaf has no children; a split has no single pane.

Both are textbook discriminated unions. To feel _why_ they fit, look at the tempting wrong way first — the "bag of optional fields" you'll find in `FEATURES.md`'s first sketch:

```ts
// The NAIVE panel — one interface, optional fields for every kind
interface NaivePanel {
  id: string
  type: 'terminal' | 'preview'
  ptyId?: string // present... when it's a terminal? the type doesn't SAY
  url?: string // present... when it's a preview? nothing enforces it
}
```

This compiles, and it's quietly broken in two ways:

1. **It permits nonsense.** Nothing stops you from constructing `{ id: 'x', type: 'terminal', url: 'https://…' }` — a "terminal" with a URL and no pty. The type describes a _superset_ of the real states, so illegal states are representable.

2. **It forces non-null assertions on the reader.** Because `ptyId` is _optional on every panel_, the compiler thinks even a terminal _might_ not have one. Look back at chapter 8's `Pane` component — it had to write:

   ```tsx
   {
     surface.panel.type === 'terminal' && (
       <TerminalPane paneId={surface.panel.ptyId!} /> // ← that "!" is the smell
     )
   }
   ```

   That `!` is a **non-null assertion**: "trust me, it's there." You are overriding the compiler because the type is too weak to know what you know. Every `!` is a place a refactor can silently introduce a crash.

The discriminated union fixes both at once:

```ts
interface TerminalPanel {
  type: 'terminal' // ← the discriminant, a LITERAL
}
interface PreviewPanel {
  type: 'preview' // ← distinct discriminant
  url: string // required, and ONLY exists on a preview
}
type Panel = TerminalPanel | PreviewPanel
```

Now `{ type: 'terminal', url: '…' }` is a **compile error** because a
`TerminalPanel` has no `url`. A preview without `url` is equally invalid. The illegal
states are unrepresentable:

```ts
function labelFor(panel: Panel): string {
  if (panel.type === 'terminal') {
    // Inside this branch TypeScript NARROWS `panel` to TerminalPanel.
    return 'Terminal'
  }
  // The only remaining possibility is PreviewPanel, so `panel` narrows to it here.
  return panel.url // url is a plain `string` — no "!" needed
}
```

**Walkthrough:** the check `panel.type === 'terminal'` compares against a literal type.
Inside the branch, TypeScript proves that `panel` is a `TerminalPanel`. After the branch,
it has eliminated that member, so `panel` must be a `PreviewPanel` and `panel.url` is
available.

> **🔧 In Shepherd:** `PaneView` uses this narrowing to choose `TerminalHost` or
> `PreviewHost`. The surface id identifies the PTY only in the terminal branch. Helpers
> such as `listTerminalSurfaceIds()` keep that ownership rule explicit.

The mantra to carry into the rest of the chapter: **a discriminant field lets the compiler narrow a union, and narrowing is what turns "I hope this field exists" into "the compiler guarantees this field exists."**

---

## 9.4 Layer 1 — `Panel`, the content of a tab

We build the model bottom-up, from the leaf content outward to the window. `Panel` is the
bottom: the actual thing rendered inside a tab—a terminal or a constrained preview:

```ts
export interface TerminalPanel {
  type: 'terminal'
}

export interface PreviewPanel {
  type: 'preview'
  url: string // a validated HTTP(S) loopback URL (chapter 38)
}

export type Panel = TerminalPanel | PreviewPanel
```

**Walkthrough:**

- **The terminal surface id is the PTY id.** The real node-pty process lives in main and
  cannot cross into the renderer. A preview surface id instead owns an Electron guest, so
  terminal operations must narrow the panel before treating its surface id as a PTY handle.
- **`PreviewPanel` ships as a constrained capability.** The split tree and tab bar handle
  it generically, while terminal-only operations explicitly filter for terminal panels.
  The URL is revalidated during creation, navigation, restore, and external opening; see
  chapter 38. A general browser remains a separate future capability.

> **⚠️ Gotcha:** do not use `listSurfaceIds()` where PTY ownership is required. Preview
> surfaces deliberately participate in layout and tabs but not terminal input, metadata,
> agent focus, or final-terminal close rules.

Concrete value:

```ts
const shellPanel: Panel = { type: 'terminal', ptyId: 'pty_7a3f' }
```

---

## 9.5 Layer 2 — `Surface` (a tab) and `Pane` (the tab strip)

A **Surface** is a single tab: a titled wrapper around exactly one `Panel`. A **Pane** is one tiled rectangle on screen — it owns a _list_ of surfaces (its tab bar) and remembers which is active.

```ts
export interface Surface {
  id: string
  title: string // shown on the tab, e.g. "zsh", "build", "docs"
  panel: Panel // the content of this tab
}

export interface Pane {
  id: string
  surfaces: Surface[] // the tabs in this rectangle (chapter 8's SurfaceTabs)
  activeSurfaceId: string // which tab is visible; must match one surface's id
}
```

**Walkthrough:**

- **A `Pane` is not a terminal — it's a container of tabs.** This trips people who think "pane = terminal." One pane can hold three surfaces (a shell, a log tail, a docs browser), and only one shows at a time. That's why chapter 8's `Pane` component rendered _all_ surfaces and hid the inactive ones with CSS — the data model says a pane _has many surfaces_, all real, one active.
- **`activeSurfaceId` is a soft reference.** It's a `string` that _should_ equal one of `surfaces[i].id`. TypeScript cannot enforce "this id exists in that array" — that's a runtime invariant, not a shape. So code that reads the active surface must handle "not found":

  ```ts
  const active: Surface | undefined = pane.surfaces.find((s) => s.id === pane.activeSurfaceId)
  ```

  Note the return type is `Surface | undefined` — `.find()` might miss. The `| undefined` is TypeScript _forcing_ you to acknowledge the invariant might be violated (e.g. right after closing the active tab). This is the type system doing its job: nudging you toward the edge case.

> **🔧 In Shepherd:** storing `activeSurfaceId` (an id) rather than an `activeSurface` (the object) is deliberate. When main serializes a `Pane` to JSON and the renderer rebuilds it, ids survive the trip cleanly and can't get "out of sync" with the array — there's only one copy of each surface, in `surfaces`, and `activeSurfaceId` points _at_ it. Storing the object too would duplicate it and invite the two copies to drift. **Reference by id across a serialization boundary; resolve to the object only in local code.**

---

## 9.6 Layer 3 — `PaneNode`, the recursive split tree

Here is the centerpiece of the whole model and the reason chapter 8's `PaneTree` component had to render _itself_. A workspace's layout is not a flat list of panes — it's a **tree of splits**: a column that contains a row that contains two panes, and so on, nested arbitrarily deep. The type that captures that is a **recursive discriminated union**:

```ts
export type PaneNode =
  | { kind: 'leaf'; pane: Pane }
  | {
      kind: 'split'
      dir: 'row' | 'col' // 'row' = side-by-side, 'col' = stacked
      sizes: number[] // fraction of space per child; sizes.length === children.length
      children: PaneNode[] // ← RECURSION: a split's children are PaneNodes too
    }
```

Two things make this type special, and both matter:

1. **It's a discriminated union** on the `kind` field (`'leaf' | 'split'`), so you narrow it exactly like `Panel`.
2. **It's recursive** — the `split` member's `children` are themselves `PaneNode`s. That single self-reference is what lets one type describe a tree of unlimited depth.

Here's a concrete three-pane layout — two columns, the right one split into a top and bottom — as both a picture and a value:

```
layout (PaneNode) =
  split(dir:'row')                     ← two things side by side
   ├─ leaf → Pane A                    ← left column (whole height)
   └─ split(dir:'col')                 ← right column, itself split top/bottom
        ├─ leaf → Pane B               ← top-right
        └─ leaf → Pane C               ← bottom-right
```

```ts
const layout: PaneNode = {
  kind: 'split',
  dir: 'row',
  sizes: [0.5, 0.5],
  children: [
    { kind: 'leaf', pane: paneA },
    {
      kind: 'split',
      dir: 'col',
      sizes: [0.6, 0.4],
      children: [
        { kind: 'leaf', pane: paneB },
        { kind: 'leaf', pane: paneC }
      ]
    }
  ]
}
```

Notice how the value's _shape_ mirrors the picture's _nesting_ exactly. That's the payoff of a recursive type: the data structure and the visual structure are isomorphic.

### Narrowing a recursive union in code

You cannot handle a tree with a single `if` — you handle it with a function that **narrows the node, then recurses on children**. Here's counting the leaves (i.e. how many panes are on screen):

```ts
export function countPanes(node: PaneNode): number {
  if (node.kind === 'leaf') {
    // narrowed to the leaf member: `node.pane` is available, `node.children` is not
    return 1
  }
  // narrowed to the split member: `node.children` is available, `node.pane` is not
  return node.children.reduce((sum, child) => sum + countPanes(child), 0)
}
```

**Walkthrough:** the `node.kind === 'leaf'` check narrows `node` to the leaf member, so `node.pane` is legal and `node.children` would be a compile error. After the early `return`, the only remaining member is the split, so `node.children` is legal. The recursion (`countPanes(child)`) walks the whole tree. This is the _exact_ pattern chapter 8's `PaneTree` used to render — `if (node.kind === "leaf") return <Pane …>` else map over `node.children` and recurse. Same shape, different payload (a number vs. JSX).

### The `never` exhaustiveness trick

What happens the day you add a third layout kind — say `{ kind: 'tabbed'; … }`? You want the compiler to _find every function that forgot to handle it_. The idiom is an exhaustiveness check with `never`:

```ts
export function countPanesExhaustive(node: PaneNode): number {
  switch (node.kind) {
    case 'leaf':
      return 1
    case 'split':
      return node.children.reduce((s, c) => s + countPanesExhaustive(c), 0)
    default: {
      // If every case is handled, `node` is narrowed to `never` here, and this compiles.
      // Add a new PaneNode kind and forget a case, and `node` is that kind — NOT never —
      // so this line becomes a compile error pointing you right at the gap.
      const _exhaustive: never = node
      return _exhaustive
    }
  }
}
```

**Walkthrough:** `never` is the type with _no_ values. Inside `default`, after `'leaf'` and `'split'` are handled, TypeScript has eliminated every possibility, so `node`'s type is `never` — and `const _exhaustive: never = node` compiles fine. But add `'tabbed'` to `PaneNode` and _don't_ add a `case`, and now `node` in `default` is `{ kind: 'tabbed'; … }`, which is **not** assignable to `never` — a compile error. You've turned "I forgot a case" from a runtime bug into a build failure. Use this in every `switch` over a discriminated union you expect to grow: the layout tree, the panel kinds, the socket methods.

> **⚠️ Gotcha:** _constructing_ a `PaneNode` by hand is where literal widening (§9.2) bites. Write it without a type annotation and it breaks:
>
> ```ts
> const leaf = { kind: 'leaf', pane: paneA } // `kind` is inferred as `string`, not 'leaf'
> const bad: PaneNode = leaf // ❌ 'string' is not assignable to '"leaf"'
> ```
>
> The object literal's `kind` widens to `string`, so it no longer matches the literal the union demands. Two fixes: **annotate the target** (`const leaf: PaneNode = { kind: 'leaf', pane: paneA }`) so the expected literal flows in, or pin the field with **`as const`** (`{ kind: 'leaf' as const, pane: paneA }`). Prefer annotating — it's the pattern that also catches missing fields. You'll hit this constantly in `10-tiling-and-layout.md` when the tiling code builds new nodes on split/close.

> **🔧 In Shepherd:** _why_ a discriminated union instead of, say, two classes (`LeafNode`, `SplitNode`) with inheritance? Because the tree gets **serialized to JSON** — sent over IPC, written to the session file (chapter 13). Classes don't survive `JSON.stringify`/`parse`; their methods and prototype are gone, leaving a plain object anyway. A discriminated union _is_ a plain-object description from the start, so it round-trips through JSON losslessly and narrows on the far side by reading a string field. For data that crosses the wire, tagged plain objects beat class hierarchies every time.

---

## 9.7 Layer 4 — `Workspace`, and all the sidebar metadata

A **Workspace** is one row in the sidebar and everything behind it. It carries the layout tree _plus_ the pile of metadata the sidebar renders — the status pills, progress bar, logs, notifications, unread/attention flags, git branch/PR, and ports. Almost all of that metadata is _pushed by the socket API_ (chapter 11); the `Workspace` type is the shape it lands in.

Build the small pieces first, because each is a chance to use a literal-type vocabulary:

```ts
// A colored status chip: `shepherd set-status build passing --color green`
export type StatusColor = 'green' | 'yellow' | 'red' | 'blue' | 'gray'
export interface StatusPill {
  key: string // stable id so `clear-status build` can target it ("build")
  label: string // human text ("passing", "waiting for input")
  color: StatusColor
  priority?: number // higher sorts first in the row
}

// A determinate progress bar: `shepherd set-progress 0.6 --label "building"`
export interface Progress {
  value: number // 0..1
  label?: string
}

// A line in the workspace's log stream: `shepherd log "tests started" --level progress`
export type LogLevel = 'info' | 'progress' | 'warn' | 'error'
export interface LogEntry {
  id: string
  ts: number // epoch millis
  level: LogLevel
  message: string
}

// A notification: `shepherd notify --title "Claude" --body "waiting for input"`
export interface Notif {
  id: string
  ts: number
  title: string
  body: string
  read: boolean
}

// Git context shown in the row (chapter: FEATURES.md #12, #15)
export type PrState = 'open' | 'merged' | 'closed' | 'draft'
export interface GitInfo {
  branch?: string
  pr?: { number: number; state: PrState; title?: string }
}
```

Now the workspace itself, assembling all of it:

```ts
export interface Workspace {
  id: string
  name: string // the sidebar label
  cwd: string // working directory shells spawn in

  layout: PaneNode // the split tree from §9.6

  // ── sidebar metadata, all driven by the socket API (chapter 11) ──
  status: StatusPill[] // 0+ chips under the name
  progress?: Progress // optional determinate bar
  logs: LogEntry[] // recent log lines (a rolling buffer)
  notifications: Notif[] // pending/seen notifications
  unread: boolean // is there something new here?  → badge
  attention: boolean // does an agent need me NOW?   → ring/flash
  git?: GitInfo // branch + PR, if this cwd is a repo
  ports?: number[] // listening ports detected for this workspace
}
```

**Walkthrough of the choices that matter:**

- **`status` is an _array_, `progress` is _optional_.** A workspace can show several pills at once (a "build" pill and a "tests" pill), so `StatusPill[]`. But there's at most one progress bar, and usually none, so `progress?: Progress`. The cardinality of the UI is encoded in the type: many pills, zero-or-one bar. Chapter 8's `WorkspaceRow` read `workspace.status[0]?.label` — the `?.` is there precisely because `status` can be empty.
- **`unread` and `attention` are two _different_ booleans, on purpose.** `unread` means "new activity" (a badge). `attention` means "an agent is blocked on you _right now_" (the ring/flash from `FEATURES.md`'s signature feature). A finished build is `unread` but not `attention`; "Claude is waiting for your input" is both. Modeling them separately lets the sidebar show a quiet badge vs. a loud ring — chapter 8's `data-attention={workspace.attention}` fed exactly this into the CSS.
- **`StatusPill.key` vs `StatusPill.id`.** It's `key`, not `id`, because the socket API addresses a pill by a _caller-chosen name_: `shepherd set-status build passing` then later `shepherd clear-status build`. The `key` is `"build"`. That's a semantic id the agent controls, distinct from the random ids we mint for panes/surfaces.
- **`git` and `ports` are optional** because not every workspace is a git repo or has a server running. Optionality here is _honest_: it says "this might genuinely be absent," which forces the renderer to guard (`workspace.git?.branch`) rather than assume.
- **Every literal-typed field is a tiny closed vocabulary.** `StatusColor`, `LogLevel`, `PrState` — each is a union of string literals, so `--color purple` or `--level debug` is rejected the moment the socket handler tries to build the object. The vocabularies live in _one_ place and the compiler enforces them across the whole app.

---

## 9.8 Layer 5 — `AppWindow`, the root (and a name collision to dodge)

The top of the object model is the **Window**: one OS window, its list of workspaces, and which one is active.

```ts
export interface AppWindow {
  id: string
  workspaces: Workspace[]
  activeWorkspaceId: string
}
```

Wait — the object model (chapters 1 and 8) calls this level `Window`, so why is the _type_ named `AppWindow`?

> **⚠️ Gotcha:** **`Window` is already a global type in TypeScript** — it's the type of the browser's `window` object, provided by the DOM library the renderer compiles against. If you declare `interface Window { … }` in a file the renderer sees, TypeScript's **declaration merging** will _merge_ your fields into the global `Window` interface instead of creating a new type. Suddenly `window.workspaces` type-checks everywhere and your real type is polluted, all silently. Naming ours `AppWindow` (some codebases use `CmuxWindow`) sidesteps the collision entirely. The _concept_ is still "Window" in the object model; the _identifier_ is `AppWindow` so it can't shadow or merge with the DOM's `Window`. This is a real, subtle trap that only shows up because half our code runs in a browser context.

With `AppWindow` in place, here is the **entire type tree on one canvas** — the payoff diagram of the chapter. Every arrow is a field; the two `◄──` notes flag the two discriminated unions:

```
AppWindow
 ├─ id: string
 ├─ activeWorkspaceId: string
 └─ workspaces: Workspace[]
     └─ Workspace
         ├─ id / name / cwd: string
         ├─ layout: PaneNode  ◄─────────────── recursive discriminated union
         │    ├─ { kind: 'leaf',  pane: Pane }
         │    └─ { kind: 'split', dir, sizes, children: PaneNode[] }  ─┐ points
         │                                                             │  back to
         │         Pane                                                │  PaneNode
         │          ├─ activeSurfaceId: string                         │
         │          └─ surfaces: Surface[]                     ◄───────┘
         │               └─ Surface
         │                    ├─ id / title: string
         │                    └─ panel: Panel  ◄──────────────── discriminated union
         │                         ├─ { type: 'terminal' }
         │                         └─ { type: 'preview', url }
         │
         ├─ status:        StatusPill[]   (key, label, color, priority?)
         ├─ progress?:     Progress       (value, label?)
         ├─ logs:          LogEntry[]     (ts, level, message)
         ├─ notifications: Notif[]        (ts, title, body, read)
         ├─ unread / attention: boolean   → badge / ring
         ├─ git?:          GitInfo        (branch?, pr?)
         └─ ports?:        number[]
```

Read that top-to-bottom and you have memorized the data model. It is exactly the object model from chapter 1 — `Window → Workspace → Pane → Surface → Panel` — now with the _split tree_ (`PaneNode`) threaded in between Workspace and Pane, and all the sidebar metadata hung off Workspace.

---

## 9.9 One `shared/types.ts`, imported by both processes

Every type above lives in **one file** that both processes import: `shared/types.ts`. This isn't a filing-cabinet detail; it's the mechanism that makes the whole contract work. You already saw both sides import from it in chapter 8:

```ts
// renderer/hooks/useWorkspaces.ts
import type { Workspace } from '../../shared/types'

// renderer/components/MainArea.tsx
import type { PaneNode } from '../../shared/types'
```

And main imports the same file from the other side:

```ts
// main/store.ts  — the source of truth
import type { AppWindow, Workspace, PaneNode, Panel } from '../shared/types'

let win: AppWindow = { id: 'w1', workspaces: [], activeWorkspaceId: '' }
```

**Why one shared file matters so much here:**

- **It's the single definition of the contract.** Main _builds_ `Workspace` objects; the renderer _consumes_ them. Because both import the identical `interface Workspace`, the compiler guarantees they agree on every field name and type. Rename `attention → needsAttention` in the shared file and _both_ sides fail to compile until you fix them — the drift bug from §9.1 becomes impossible.
- **`import type` makes the erasure explicit.** Writing `import type { … }` (not `import { … }`) tells the compiler "I only want the _types_ — erase this import entirely from the output JavaScript." That's not just tidy; it's _required_ for safety here, because…
- **…the shared file must have zero runtime dependencies.** `shared/types.ts` is compiled into _both_ bundles: the Node/main bundle and the browser/renderer bundle. If someone adds a runtime helper that does `import { app } from 'electron'` or `import * as fs from 'fs'`, the _renderer_ build breaks (no `fs` in a browser) — or worse, bloats. Keep `shared/types.ts` **types only**: interfaces, type aliases, unions. Types vanish at compile time (§9.10), so a types-only file adds _nothing_ to either bundle and can be safely imported anywhere.

```
                       shared/types.ts   (types ONLY — compiles to zero JS)
                       ┌──────────────────────────────────────────────┐
                       │  Panel · Surface · Pane · PaneNode ·          │
                       │  Workspace · AppWindow · StatusPill · …       │
                       └───────────────┬───────────────┬──────────────┘
              import type              │               │             import type
                          ┌───────────▼──┐         ┌───▼───────────┐
                          │ main/*.ts     │         │ renderer/*.tsx │
                          │ (Node bundle) │         │ (browser bundle)│
                          └───────────────┘         └────────────────┘
                          builds the truth           mirrors & renders
```

> **🔧 In Shepherd:** the directory split is deliberate — `main/`, `renderer/`, `preload/`, and `shared/`. Anything in `shared/` is fair game for _both_ processes, which is a strong constraint: it can't touch Node APIs _or_ DOM APIs, only plain data. That constraint is a feature. It forces the data model to stay a pure description — exactly what you want for something that gets JSON-serialized and shipped across a process boundary a thousand times a session.

---

## 9.10 Typing the wire — and why types can't validate it

Now the two halves of the app talk. There are two wires (chapters 4 and 11), and both carry JSON:

- **IPC** — main pushes state _snapshots_ to the renderer (chapter 8's `workspace:update`).
- **The socket API** — agents send _commands_ into main over a unix socket, newline-delimited JSON `{ id, method, params }`.

Type both, then confront the catch that makes this section the most important in the chapter.

### Typing the IPC snapshot

The renderer's mirror is refreshed by a snapshot. Chapter 8 already named its shape; here it is, sourced from the shared types:

```ts
export interface Snapshot {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
}
```

Every `onWorkspaceUpdate((snap: Snapshot) => …)` callback in the renderer is typed against this. One type, both ends: main constructs a `Snapshot`, the renderer destructures one, the compiler checks both against the same interface.

### Typing the socket protocol

The socket wire format is `{ id, method, params }` for a request and `{ id, result }` / `{ id, error }` for a reply — basically JSON-RPC. Type the envelope generically (there's our "little generics" from §9.2):

```ts
export interface SocketRequest {
  id: number
  method: string
  params: unknown // ← note: UNKNOWN, not any — see below
}

export interface Ok<T> {
  id: number
  result: T
}
export interface Err {
  id: number
  error: { code: number; message: string }
}
export type Response<T> = Ok<T> | Err
```

The `params` of a request depend on the `method` — which is _exactly_ a discriminated union again, this time discriminated by `method`:

```ts
export type Command =
  | { method: 'workspace.select'; params: { id: string } }
  | { method: 'surface.split'; params: { paneId: string; dir: 'row' | 'col' } }
  | {
      method: 'set-status'
      params: { workspaceId: string; key: string; label: string; color: StatusColor }
    }
  | { method: 'notification.create'; params: { workspaceId: string; title: string; body: string } }

function dispatch(cmd: Command): void {
  switch (cmd.method) {
    case 'workspace.select':
      return selectWorkspace(cmd.params.id)
    case 'surface.split':
      return splitPane(cmd.params.paneId, cmd.params.dir)
    case 'set-status':
      return applyStatus(cmd.params)
    case 'notification.create':
      return pushNotification(cmd.params)
    // add the `never` exhaustiveness check here too (§9.6) as the method list grows
  }
}
```

**Walkthrough:** narrowing on `cmd.method` unlocks the _right_ `params` shape in each branch — inside `case 'surface.split'`, `cmd.params` is `{ paneId: string; dir: 'row' | 'col' }` and nothing else. The same discriminated-union pattern that models the pane tree also models the entire command protocol. That's not a coincidence; it's the pattern fitting "one of several kinds, and the kind decides the payload" a third time. (The full protocol is chapter 11's subject; this is just its _type_.)

Narrowing the _response_ is slightly different because `Ok`/`Err` share no literal tag — they differ by _which key exists_. TypeScript narrows on that with the `in` operator:

```ts
function unwrap<T>(res: Response<T>): T {
  if ('error' in res) {
    // narrows res to Err
    throw new Error(res.error.message)
  }
  return res.result // narrows res to Ok<T>
}
```

### The catch: types are compile-time only

Here is the single most important idea in this chapter, and the one that most often burns people who "know TypeScript":

**Every type in this chapter is erased before the code runs.** `interface`, `type`, the unions, the generics — the TypeScript compiler _deletes_ all of it and emits plain JavaScript. At runtime there is no `Workspace`, no `Command`, no `PaneNode`. There are only anonymous JavaScript objects. Types are a _compile-time proof about your source code_; they are **not** a runtime check on your data.

That is completely fine for data you _construct in-process_ — main builds a `Workspace` and the compiler already proved it's well-formed. But it is a **trap** for data that _arrives from outside_: bytes off the socket, a session file loaded from disk, an IPC message. Those are just JSON. A malicious or buggy client can send:

```json
{ "id": "not-a-number", "method": 42 }
```

and your beautifully typed `SocketRequest` is a **lie** about that value. This is why `params` above is typed `unknown` and not `any` — and why the boundary needs a real, runtime **validator**, not a type annotation:

```ts
export function parseRequest(line: string): SocketRequest | null {
  let data: unknown
  try {
    data = JSON.parse(line) // JSON.parse returns `any`; we pin it to `unknown`
  } catch {
    return null // not even valid JSON
  }
  if (typeof data !== 'object' || data === null) return null

  const obj = data as Record<string, unknown>
  if (typeof obj.id !== 'number') return null // actually check, at runtime
  if (typeof obj.method !== 'string') return null

  // Only now, having CHECKED, do we hand back a value the type system can trust.
  return { id: obj.id, method: obj.method, params: obj.params }
}
```

**Walkthrough:** we start with `unknown` — the honest type for "JSON we haven't inspected." `unknown` is `any`'s safe sibling: you can hold it, but the compiler forbids you from _using_ it (reading fields, calling it) until you've _narrowed_ it with real runtime checks (`typeof`, `in`, `Array.isArray`). Each `if` is an actual runtime test _and_ a narrowing step. The function's return type (`SocketRequest | null`) means "either a value I've verified matches the type, or nothing" — so callers can't skip the check. The validator is the bridge from the untyped outside world to the typed inside world.

The same discipline pairs with **type-guard predicates** (`x is T`) for reusable narrowing:

```ts
export function isTerminalPanel(p: Panel): p is TerminalPanel {
  return p.type === 'terminal' // a runtime check that ALSO tells the compiler the type
}
```

For anything beyond a handful of fields, hand-writing validators gets tedious and drifts from the types. The production move is a schema library like **zod**, where you write the schema _once_ and get **both** a runtime validator _and_ the static type:

```ts
import { z } from 'zod'

const SelectParams = z.object({ id: z.string() }) // runtime schema
type SelectParams = z.infer<typeof SelectParams> // static type: { id: string }

const parsed = SelectParams.safeParse(unknownParams) // real runtime check at the boundary
if (parsed.success) {
  selectWorkspace(parsed.data.id) // parsed.data is fully typed AND verified
}
```

`z.infer` derives the TypeScript type _from_ the runtime schema, so the two literally cannot drift. One source of truth, checked at runtime and known at compile time — the best of both.

> **🔧 In Shepherd:** the rule is a line on a map. **Inside** the process, trust the types — main built the objects, the compiler checked them. **At every boundary** — the socket handler, the session-file loader (chapter 13), any IPC message main _receives_ — treat the input as `unknown` and validate before you trust it. That single discipline is the difference between "an agent sends a malformed `notify` and the sidebar throws" and "the malformed command is rejected with a clean error."

---

## 9.11 The three gotchas this architecture invites

These aren't generic TypeScript tips — they're the specific ways _this_ app's shape (two processes, JSON on the wire, a mirrored store) lets type safety leak.

### 1. `any` leaking across the IPC/socket boundary

`any` is a hole in the type system: a value typed `any` can be assigned to anything and silences all checking, and it _spreads_ — one `any` at the boundary infects everything it touches. The classic leak here is the raw IPC/socket payload:

```ts
// ❌ `msg` is any → `msg.wsId`, `msg.whatever` all type-check, all unchecked
window.api.onWorkspaceUpdate((msg: any) => setWorkspaces(msg.workspaces))

// ✅ type it (Snapshot) AND, at a trust boundary, VALIDATE it (§9.10)
window.api.onWorkspaceUpdate((msg: Snapshot) => setWorkspaces(msg.workspaces))
```

The fix is two-part: annotate boundary payloads with the real shared type, and where the data is _untrusted_ (the socket), start from `unknown` and validate down to the type. Turn on `noImplicitAny` so the compiler _makes_ you — an un-annotated callback parameter becomes an error instead of a silent `any`.

### 2. Forgetting to narrow a union

A discriminated union is only safe if you _narrow_ before you reach for member-specific fields. Skip the narrow and you either get a compile error (good) or reach for a field that isn't there (if you `any` your way around it):

```ts
function bad(node: PaneNode) {
  return node.children.length // ❌ Property 'children' does not exist on the 'leaf' member
}
function good(node: PaneNode) {
  if (node.kind === 'split') return node.children.length // ✅ narrowed first
  return 0
}
```

The compiler catches the honest version. The way people _defeat_ the compiler is casting (`(node as any).children`) to "make the error go away" — which reintroduces gotcha #1. When TypeScript rejects a union access, the message is telling you _you forgot to check `kind`/`type`_ — add the check, don't cast it away. And put the `never` exhaustiveness guard (§9.6) in `switch`es so a _new_ union member forces you to narrow it everywhere.

### 3. Assuming the type validates runtime data

The deepest trap, restated because it's worth restating: **a type annotation is not a runtime assertion.** Writing `const cmd = JSON.parse(line) as Command` does _not_ check anything — the `as` is you _asserting_ to the compiler, and `JSON.parse` will happily hand you `{ method: "rm -rf" }` typed as a valid `Command`.

```ts
// ❌ a cast is a promise you're making to the compiler, not a check it performs
const cmd = JSON.parse(line) as Command
dispatch(cmd) // cmd.params could be ANYTHING; you just told TS to stop worrying

// ✅ validate at the boundary, THEN the type is earned
const req = parseRequest(line) // returns SocketRequest | null (§9.10)
if (req) dispatch(validateCommand(req)) // validateCommand does the real per-method check
```

If you remember one sentence from this chapter: **types describe your code; validators check your data; the two are not interchangeable, and the boundary is where you must have both.**

---

## 🧪 Checkpoint

Answer these before moving on — everything's in this chapter:

1. `shared/types.ts` is imported by both main and renderer. In one or two sentences, what specific bug does that single shared file make _impossible to compile_, and why can't two separate type definitions give the same guarantee?
2. Chapter 8's code wrote `surface.panel.ptyId!` with a non-null assertion. What was it about the _naive_ `Panel` type that forced the `!`, and why does turning `Panel` into a discriminated union let you delete it?
3. What makes a union a _discriminated_ union specifically? Point at the exact field in `Panel` and in `PaneNode` that does the job, and say what its type must be.
4. Write the type of `PaneNode` from memory. Which single part of it makes it able to describe a tree of unlimited depth?
5. In a `switch (node.kind)`, what is the purpose of `const _exhaustive: never = node` in the `default` branch? What happens the day someone adds a `'tabbed'` kind to `PaneNode`?
6. `Workspace` has both `unread: boolean` and `attention: boolean`. Give a concrete scenario that is one but not the other, and say which UI element each drives.
7. Why is the top-level type named `AppWindow` instead of `Window`? What does TypeScript do if you name an interface `Window` in a file the renderer compiles?
8. An agent sends `{ "id": 1, "method": "set-status", "params": { "color": "purple" } }` over the socket. Your `Command` type says `color` must be a `StatusColor`. Does the _type_ stop this at runtime? What actually has to stop it, and where?

---

## Summary

In Shepherd the types aren't decoration — they're the **contract between two processes that only ever exchange JSON**, so getting the data model right is getting the app right. The model is built from five TypeScript features: **interfaces** for object shapes, **union types** for "one of these," **literal types** for closed vocabularies, **discriminated unions** for "one of these _and I can tell which_," and a **little generics** for the socket-response envelope. The star is the discriminated union: by giving each member a distinct **literal discriminant** (`type` on `Panel`, `kind` on `PaneNode`), the compiler can **narrow** a value to a specific member and hand you the fields that member guarantees — which is exactly why `Panel` (terminal-or-browser) and the **recursive** `PaneNode` (leaf-or-split) fit it so well, and why the naive "bag of optional fields" alternative both permits illegal states and forces `!` non-null assertions on every reader. We assembled the full tree bottom-up — `Panel → Surface → Pane → PaneNode → Workspace → AppWindow` — with all the socket-driven sidebar metadata (status pills, progress, logs, notifications, unread/attention, git/PR, ports) hung off `Workspace`, and named the root `AppWindow` to dodge a collision with the DOM's global `Window`. One **`shared/types.ts`**, imported with `import type` by both processes and kept dependency-free, is the mechanism that makes the contract enforceable. Finally, the sober truth: **types are compile-time only and vanish at runtime**, so the socket protocol (`{id, method, params}`) and every other _incoming_ boundary must be **validated at runtime** — start from `unknown`, narrow with real checks or a schema library like zod, and never mistake a `type` annotation or an `as` cast for a check on your data. Watch the three leaks this shape invites: `any` spreading from the boundary, forgetting to narrow a union, and assuming a type validates runtime bytes.

## Where this shows up next

- The _geometry_ behind `PaneNode` — sizes, draggable dividers, focus math, and the algorithms that mutate the tree on split/close → `10-tiling-and-layout.md`
- The socket protocol these `Command` / `Response<T>` types describe, plus the `shepherd` CLI that speaks it → `11-the-socket-api.md`
- Where `status`, `progress`, `notifications`, `unread`, and `attention` actually get _set_ on a `Workspace` (the socket methods and OSC parsing) → `12-notifications-and-osc.md`
- Serializing this whole model to disk and rebuilding it (the other place `unknown` + validation is mandatory) → `13-session-persistence.md`
- The IPC surface (`window.api`, `Snapshot`, `onWorkspaceUpdate`) that carries these types across the bridge → `04-ipc-inter-process-communication.md` and `05-preload-and-context-isolation.md`
- The components that _consume_ every type defined here → `08-react-in-this-app.md`
- The end-to-end trace where a `Command` becomes a `Workspace` change becomes a re-render → `17-how-it-all-connects.md`
- Any term above you want pinned down in one place → `16-glossary.md`

## Further reading

- TypeScript Handbook — "Everyday Types" (interfaces, unions, literals): https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
- TypeScript Handbook — "Narrowing" (discriminated unions, the `in` operator, and the `never` exhaustiveness check): https://www.typescriptlang.org/docs/handbook/2/narrowing.html
- TypeScript Handbook — "Generics" (the `Response<T>` envelope pattern): https://www.typescriptlang.org/docs/handbook/2/generics.html
- "Making Illegal States Unrepresentable" — the design principle behind §9.3, in TypeScript terms: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html (see also the classic essay by Yaron Minsky)
- zod — schema validation that gives you a runtime check _and_ a static type from one definition (§9.10): https://zod.dev
