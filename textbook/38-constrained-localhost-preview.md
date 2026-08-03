# Chapter 38 — A Constrained Localhost Preview in Electron

## 38.1 The product boundary is the architecture

An embedded browser sounds like a rendering feature, but its difficult parts are trust,
ownership, and lifetime. A local development page is still untrusted content: its server
may be compromised, its dependencies may be hostile, or it may redirect to the public
internet. Giving that page Node integration would turn web content into desktop code.

Shepherd therefore implements a **localhost preview**, not a general browser. Its useful
promise is precise: an explicitly selected HTTP(S) loopback server can appear beside the
terminal that launched it. Everything outside that promise is denied.

This boundary improves both security and UI. There is no bookmark system, account state,
cookie importer, download shelf, permission prompt, or automation API to explain. The
preview has only the controls needed for the edit-run-observe loop.

## 38.2 Why a panel type, not a special pane

The existing hierarchy is:

```text
Workspace → layout tree → Pane → Surface (tab) → Panel (content)
```

A preview is content, so it belongs at the `Panel` layer:

```ts
interface TerminalPanel {
  type: 'terminal'
}

interface PreviewPanel {
  type: 'preview'
  url: string
}

type Panel = TerminalPanel | PreviewPanel
```

The discriminant makes invalid access a compile error. Renderer code must narrow
`surface.panel.type` before using `url`, while terminal-only code can explicitly filter the
union. Splits, panes, tab selection, resizing, and persistence remain generic.

This exposes an important identity rule: a **surface id is not always a PTY id**. Before
M30 those sets happened to be identical. Once previews exist, terminal ownership logic
must use `listTerminalSurfaceIds()` and `activeTerminalSurfaceId()` instead of assuming
every tab owns a shell. This applies to metadata discovery, agent focus, socket operations,
notifications, and close constraints.

Keeping at least one surface is no longer a sufficient workspace invariant. Shepherd must
keep at least one **terminal** surface so a preview can never leave a workspace with no
interactive shell.

## 38.3 Validation is a repeated boundary

Client-side validation improves feedback; it does not create authority. An attacker can
construct IPC messages or mutate DOM attributes. Preview URLs are therefore normalized
and checked at each transition:

1. the picker validates before creating a panel;
2. the reducer validates before storing a URL;
3. restore validates untrusted JSON before rebuilding a panel;
4. `will-attach-webview` validates the initial guest URL and partition;
5. guest navigation and redirects validate their destination;
6. the session request filter validates every network request;
7. open-external IPC validates again immediately before the side effect.

The accepted hosts are `localhost`, IPv6 loopback `[::1]`, and IPv4 `127.0.0.0/8`.
Only HTTP and HTTPS may be top-level documents. User information is rejected, which avoids
confusing credential-bearing forms such as `trusted@localhost`. Input length and control
characters are bounded before URL parsing.

Development servers need more than document navigation. Their HMR clients commonly use
WebSockets, and pages may use inline images or blobs. Shepherd allows HTTP(S), WS(S), and
local-origin blobs only where the request type requires them. It still rejects remote
scripts, images, fetches, sockets, and blobs. Filtering subresources matters because a
local HTML document can otherwise exfiltrate data without changing its visible address.

## 38.4 Electron webview isolation

The preview uses Electron's `<webview>` guest because it provides isolated navigation and
lifecycle controls inside the existing React pane. That choice carries risk: a webview is
a separate web contents with configuration supplied partly by renderer markup. The main
process must treat every attachment parameter as untrusted.

At `will-attach-webview`, Shepherd:

- requires the exact `shepherd-preview` partition;
- requires an already valid loopback `src`;
- removes any guest preload and popup request;
- disables Node integration in the main frame, subframes, and workers;
- enables context isolation, sandboxing, and web security;
- disables mixed content, DevTools, dialogs, experimental features, and drag navigation.

The partition name intentionally lacks Electron's `persist:` prefix. It is consequently an
in-memory session: cookies, cache, and storage do not become durable app profile state.
All preview surfaces share the restricted session so one policy installation covers their
requests. General authenticated browsing would need a different product and storage model,
not a relaxed version of this partition.

The guest also receives:

- `setWindowOpenHandler(() => ({ action: 'deny' }))`;
- denied permission checks and requests;
- a denied `will-download` path;
- navigation and redirect guards;
- automatic DevTools closure.

The host renderer never receives `shell` or raw Electron primitives. Its preload bridge
offers a single `openExternal(url)` method. Main checks that the IPC sender belongs to a
window, normalizes the URL again, and only then calls the system browser.

## 38.5 React ownership and guest lifetime

`PreviewHost` imperatively creates the custom webview inside an effect. This is one of the
cases where an effect is correct: React owns a resource outside its declarative DOM model,
and the effect establishes and cleans up that resource.

The lifecycle is symmetric:

```text
mount
  → create guest
  → set partition/preferences/src
  → attach listeners
  → append guest

unmount
  → remove listeners
  → remove guest
  → clear ref
```

The guest remains mounted when its tab is inactive. Recreating it on every tab switch would
lose application state, rebuild the page, and churn renderer processes. Instead the panel
is hidden and its audio is muted. Electron background throttling remains enabled. Closing
the surface unmounts it, which releases the guest web contents.

Event callbacks store current `active` and `onUrlChange` values in refs. That allows one
stable guest lifecycle effect per surface rather than destroying the browser because a
parent passed a new callback identity. State that belongs to the model—the last validated
URL—flows back through the reducer and persistence. Ephemeral browser state stays inside
the guest.

## 38.6 History controls and Electron API drift

Electron 43 still exposes `WebviewTag.canGoBack()`, but live testing showed that the legacy
capability could remain false immediately after a valid page navigation. Chromium's guest
history itself was correct. Depending on the stale capability would leave the Back control
disabled.

Shepherd keeps a small UI history model:

```ts
interface PreviewHistory {
  entries: string[]
  index: number
  pendingIndex: number | null
}
```

Committed guest navigations append after the cursor and discard a forward branch. Back or
Forward records the expected index, asks the guest to perform `history.back()` or
`history.forward()`, and confirms the cursor when the navigation event arrives. The script
passed to `executeJavaScript()` is a fixed application constant, never user input.

This model controls button availability; Chromium still owns document history and same-
origin semantics. The pure transition functions are tested separately from Electron.

## 38.7 Persistence and migration

The panel URL is plain JSON and belongs in the existing layout snapshot. Restore is still
an input boundary, so `normalizeLayoutNode()` accepts old surfaces with no `panel` field as
terminal panels and accepts a preview only if its stored URL passes current validation.
An invalid preview cannot be resurrected by editing a session file.

Persisting the last committed URL provides predictable relaunch behavior without storing
cookies, page DOM, history, form values, or credentials. The ephemeral partition and the
durable layout file intentionally have different responsibilities:

| State                        | Owner                       | Durable? |
| ---------------------------- | --------------------------- | -------- |
| Panel kind and validated URL | Shepherd session snapshot   | Yes      |
| Split sizes and active tab   | Shepherd session snapshot   | Yes      |
| Page DOM and JavaScript heap | webview guest               | No       |
| Cookies/cache/storage        | ephemeral preview partition | No       |
| Back/forward cursor          | `PreviewHost` instance      | No       |

## 38.8 Failure handling

Failure is normal in this workflow: developers stop and restart servers constantly.
`did-fail-load` maps a main-frame failure into a compact error overlay while ignoring an
aborted request caused by an intentional new navigation. `render-process-gone` reports a
stopped preview process. Retry loads the currently entered, revalidated URL.

The toolbar exposes loading through `aria-busy`; the error container uses `role="alert"`;
every icon-only control has an accessible name and title. The URL entry and picker have
real labels. Preview tabs reuse the existing tablist, selected-state, keyboard navigation,
and focus model rather than creating parallel semantics.

## 38.9 Alternatives and tradeoffs

### `iframe`

An iframe is simpler, but many dev servers deny framing, and it does not provide the same
guest lifecycle and navigation controls. It also would not remove the need for a strict
network policy.

### `WebContentsView`

A main-owned `WebContentsView` avoids the webview tag and can be a strong choice for a
general browser. It complicates synchronization with DOM-computed pane rectangles,
stacking, scrolling, and tab visibility. The constrained feature benefits from living in
the existing surface component, provided attachment is hardened in main.

### Proxying localhost through Shepherd

A proxy could rewrite headers and centralize requests, but it expands Shepherd into an HTTP
and WebSocket proxy with origin, streaming, TLS, and credential responsibilities. Direct
loopback traffic plus session-level filtering is smaller and preserves dev-server behavior.

### Persistent per-site partitions

They would support logins but introduce cookie ownership, disk cleanup, cross-preview
tracking, migration, and privacy UI. M30 explicitly avoids that responsibility.

## 38.10 Testing strategy

Pure tests cover URL parsing, deceptive hosts, request types, preference hardening,
attachment policy, popup/permission denial, history transitions, layout normalization,
preview URL updates, last-terminal invariants, terminal fallback, command context, labels,
and snapshot restoration.

Live Electron verification is still necessary because type tests cannot prove how Chromium
dispatches redirects or destroys a guest. The M30 fixture covers:

- local page navigation and redirect;
- remote page navigation, redirect, fetch, and WebSocket boundary;
- popup, download, and permission denial;
- stop/reload, server failure, Retry, and restart;
- split resizing and inactive-tab muting;
- relaunch from the same session file;
- guest-target disappearance after close.

The final repository gates add the full test suite, lint, both TypeScript projects, and a
production build.

## 38.11 Extension points

Safe follow-ups can build on the boundary without silently widening it:

- choose among detected ports with richer health/title metadata;
- add an explicit per-preview memory diagnostic;
- support remote development only through a designed tunnel/ownership protocol;
- introduce automation as a separately authenticated and permissioned API;
- move to a main-owned view if a true browser product is approved.

None should be implemented by accepting arbitrary origins in `normalizePreviewUrl()`.
That validator is a product boundary, not an inconvenience.

## Checkpoint

1. Why is a local document still untrusted?
2. What breaks if code continues to assume every surface id identifies a PTY?
3. Why are remote subresources blocked even when the top-level page is localhost?
4. What state is intentionally persisted, and what state is intentionally ephemeral?
5. Why does closing the surface, rather than hiding it, define guest cleanup?
