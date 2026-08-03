# M30 — Constrained Localhost Preview

## The goal

M30 completes the cmux-parity series with one deliberately narrow browser workflow:
open a server running on this machine beside its terminal. It is not a general browser.
Only explicit HTTP(S) loopback URLs are accepted, and the embedded page cannot navigate,
fetch, open popups, download files, request permissions, or invoke protocols outside that
boundary.

The result still behaves like a native Shepherd surface: it splits beside a terminal,
uses the existing tab and layout model, survives session restoration, resizes with the
split tree, and releases its guest when closed.

## What changed

### Shared contracts

`src/shared/preview.ts` owns the validation rules used on every side of the Electron
boundary:

- `normalizePreviewUrl()` trims and bounds input, supplies `http://` when omitted, and
  accepts only `localhost`, `[::1]`, or the IPv4 `127.0.0.0/8` block over HTTP(S).
- credentials, control characters, deceptive hostnames, remote hosts, `file:`,
  `javascript:`, and other protocols are rejected.
- `previewRequestAllowed()` applies a second request-level boundary. Main frames remain
  HTTP(S)-only; local WebSocket traffic is allowed for hot reload; local blobs and inline
  subresources work; remote subresources and sockets do not.
- `PREVIEW_PARTITION` gives every preview the same dedicated, in-memory Electron session.
- `previewUrlLabel()` derives the compact tab label without adding another stored title.

`src/shared/ipc.ts` adds one narrow capability, `preview.openExternal`. The renderer can
ask the main process to open the current preview URL, but it never receives Electron's
`shell` API.

### Main-process policy

`src/main/previewPolicy.ts` contains pure policy functions, while
`src/main/previewSecurity.ts` attaches them to Electron:

1. `will-attach-webview` rejects a guest unless its initial URL is local and it requests
   the exact preview partition.
2. Main removes any supplied preload and hardens the guest preferences: Node integration,
   subframe/worker integration, DevTools, mixed content, dialogs, drag navigation, and
   experimental features are disabled; context isolation, sandboxing, and web security
   stay enabled.
3. The partition denies permission requests and downloads.
4. `webRequest.onBeforeRequest` enforces the network boundary for documents, scripts,
   images, fetches, and WebSockets—not merely the address bar.
5. Guest navigation and redirects are revalidated; all new windows are denied.
6. `preview.openExternal` validates again in main and requires an owning window before
   calling `shell.openExternal()`.

`src/main/index.ts` enables `webviewTag` only for the application window and installs the
host and guest policy during startup. `src/preload/index.ts` exposes only the typed
open-external method.

### The model and reducers

`src/renderer/src/layout/types.ts` now models `Panel` as a discriminated union:

```ts
type Panel = { type: 'terminal' } | { type: 'preview'; url: string }
```

The surface id still owns the lifetime of the thing inside its tab, but only terminal
surface ids own PTYs. That distinction is enforced by helpers in `layout/tree.ts`:

- `listTerminalSurfaceIds()` ignores previews.
- `activeTerminalSurfaceId()` uses the active terminal when possible and otherwise finds
  a real terminal fallback.
- `normalizeLayoutNode()` migrates legacy surfaces to terminal panels and rejects unsafe
  persisted preview URLs.
- `updatePreviewSurfaceUrl()` updates only a validated preview.

`workspaceReducer.ts` adds `previewSplitAction()` and `updatePreviewUrlAction()`. Closing
logic counts terminal surfaces separately, so a workspace can never lose its final PTY
just because a preview exists. The app reducer uses the terminal fallback for metadata,
socket ownership, and notification navigation when a preview is selected.

### Renderer flow

The command palette registers `preview.open`. `PreviewPicker.tsx` offers ports already
discovered for the active terminal and also accepts a manually entered loopback URL.
Submitting dispatches `previewSplitAction()`, producing a normal row split whose new pane
contains a preview surface.

`PaneView.tsx` narrows the panel union and renders either `TerminalHost` or
`PreviewHost`. `TabBar.tsx` derives preview labels and icons while preserving ARIA tab
semantics and the final-terminal close invariant.

`PreviewHost.tsx` creates the `<webview>` imperatively. That makes attachment and teardown
explicit and avoids React treating Electron's custom element like an ordinary iframe.
It owns:

- URL entry and Go;
- back, forward, stop/reload, and open externally;
- loading, navigation, failure, and renderer-process events;
- an accessible error overlay with Retry;
- audio muting while its tab is inactive;
- guest removal during effect cleanup.

Electron 43's legacy `WebviewTag.canGoBack()` did not reliably report the newly committed
entry during live testing. `previewHistory.ts` therefore keeps a small per-surface history
cursor for control availability, while the guest's own browser history performs the
actual same-origin navigation. Its forward-stack replacement behavior has a focused
regression test.

`App.css` keeps the new chrome subordinate to the terminal shell: one 32-pixel neutral
toolbar, hairline borders, compact controls, no card wrapper, and semantic focus/error
states.

## End-to-end data flow

```text
command palette
  → PreviewPicker validates URL
  → previewSplitAction adds PreviewPanel
  → PaneView mounts PreviewHost
  → will-attach-webview revalidates and hardens guest
  → ephemeral preview session filters every request
  → did-navigate persists the validated local URL
  → session snapshot restores the same panel later
  → close surface unmounts webview and destroys its guest contents
```

No preview becomes a PTY id. Terminal metadata, agent actions, socket commands, and
notifications continue to resolve to an actual terminal even while a preview pane is
active.

## Verification performed

Automated coverage exercises URL normalization, request filtering, web preferences,
attachment, navigation, popup and permission policy, layout migration, reducer invariants,
terminal fallback, command availability, labels, persistence, and history behavior.

The live Electron pass used an isolated local HTTP fixture and verified:

- picker focus, dialog semantics, split creation, and the dedicated partition;
- local navigation, local redirects, back/forward, reload, and URL validation;
- blocked remote navigation, redirect, fetch, popup, download, and permission attempts;
- split resizing and inactive-tab retention/muting;
- server shutdown error, accessible Retry, and recovery after restart;
- session-file persistence and restoration after relaunch;
- guest cleanup by observing the webview DevTools target disappear while the terminals
  and pane layout remained.

The captured result is in `docs/images/localhost-preview.png`.

## Intentionally deferred

This milestone does not add arbitrary internet browsing, persistent cookies, logins,
download management, permission prompts, remote/SSH port forwarding, DevTools, browser
automation, or a socket browser API. Those features have different security and lifecycle
requirements and remain separate future work.

## Checkpoint

1. Why must request filtering happen in main even though the picker validates the URL?
2. Why does the app need `activeTerminalSurfaceId()` after adding preview panels?
3. What makes the preview partition ephemeral?
4. Which local development behavior requires allowing loopback WebSockets?
5. What proves that closing a preview releases its guest process?
