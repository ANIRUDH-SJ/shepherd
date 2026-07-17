# M4 — Agents & Persistence (deep dive)

> **The goal of M4:** make the app work with *real agents* and *survive a restart*.
> Three features: (1) **OSC auto-notifications** — any program's escape codes flash
> the sidebar; (2) **agent hooks** — `cmux hooks setup` wires Claude Code's
> Notification hook; (3) **session restore** — reopen your layout on relaunch.

M4 was built as **four PRs** (three features + this docs PR), each on its own branch
with kernel-style commits — the point where we moved to a proper branch → PR → merge
workflow. Pairs with `../textbook/12` (notifications & OSC) and `/13` (persistence).

---

## 1. Two on-ramps to one notification

By M3 the sidebar could flash via the socket (`cmux notify`). M4 adds a **second,
zero-setup on-ramp** and a **real agent integration** — both ending in the same place:

```
 (a) any program emits an OSC 9/777/99 escape code   ─┐
                                                       ├─► main marks the workspace
 (b) Claude Code fires its Notification hook          ─┤    → sidebar flash + toast
     → runs `cmux notify` (installed by `hooks setup`)─┘
```

`(a)` needs nothing; `(b)` is one `cmux hooks setup`. Both reuse the M3 `notify`
path (`../textbook/12`, "Loop C").

---

## 2. OSC auto-notifications (PR #2)

### `src/main/osc.ts` — a pure sniffer
Terminals can raise a desktop notification by printing an **OSC escape sequence**
(`ESC ] <code> ; <payload> <BEL|ST>`). We scan each terminal's output for the
notification codes — **OSC 9** (iTerm2), **OSC 777** (urxvt), **OSC 99** (kitty):

- `parseOsc(buffer)` returns the notifications found **plus a `rest`** — an
  unterminated tail to prepend to the next chunk, because **a sequence can split
  across reads** (the classic gotcha). Pure + no electron → unit-tested in `osc.test.ts`.
- Non-notification OSC codes (window title, colours, hyperlinks) are ignored, and
  the parser **never alters** the stream — it only sniffs a copy.

### `src/main/pty.ts` — the wiring
Each terminal now carries a small record `{ proc, workspaceId, oscBuffer }`. On every
output chunk we forward the raw bytes to xterm (unchanged) **and** run the sniffer;
any notification is routed to the emitting terminal's workspace (via the injected
`CMUX_WORKSPACE_ID`) using the same `notify` path, plus a desktop toast.

> **🔧 In cmux-linux:** try it — `printf '\033]9;hello\007'` in a pane flashes that
> workspace. That's a program telling the terminal "notify me" with no cmux CLI.

---

## 3. Agent hooks (PR #3)

### `bin/cmux hooks setup`
A **local** subcommand (it edits a file, doesn't touch the socket): it merges a
Claude Code **Notification hook** into `~/.claude/settings.json`:

```json
{ "hooks": { "Notification": [ { "hooks": [
  { "type": "command", "command": "cmux notify --title Claude --body \"needs your attention\"" }
]}]}}
```

So a real Claude Code session in a pane flashes its workspace when it needs you. It's:
- **idempotent** — re-running won't add a duplicate,
- **non-destructive** — merges into existing settings/hooks,
- **testable** — target path overridable via `CLAUDE_SETTINGS_PATH`.

---

## 4. Session restore (PR #4)

### The flow
- **Save:** the renderer persists its layout to `session.json` (in the app's userData
  dir) — **debounced** (500 ms after the last change), via `main/session.ts`.
- **Load:** at startup the renderer reads it **synchronously** (`ipcRenderer.sendSync`)
  so `useReducer` can seed straight from it — no flash of a fresh app first.
- **Validate:** `sanitizeRestored` normalises the snapshot and resets transient flags,
  so a corrupt/old file falls back to a fresh app instead of crashing.

### Scope
The original M4 implementation restored the **layout** (workspaces / panes / tabs /
splits / sizes / names + active workspace). Terminals **re-spawn fresh** when their
panes mount. M11 later added live cwd persistence, and M12 changed the launch policy
to resume only the previously active workspace so every startup contains exactly
one. See `M12-single-workspace-startup.md` for the current code path.

### Hardening from code review (Copilot, on PR #4)
Two fixes worth calling out — see `../bug-fixes/`-style reasoning:
- **Fail *closed* on a bad snapshot.** The first cut only checked the root's
  top-level `type`, so a `split` with no children crashed startup via `firstPaneId`.
  Now `isValidLayoutNode` **recursively validates** the tree; anything malformed →
  `null` → fresh app. (+ regression tests.)
- **Persist only the layout, gated on change.** The save fired on *every* state
  change — including agent status/notify churn — which could reset the debounce and
  **starve** a layout save. Now we save a `toLayoutSnapshot` (no transient flags) and
  gate the effect on the **serialised layout**, so status updates never trigger a save.

---

## 5. What's intentionally deferred

- **Per-terminal cwd + scrollback restore** (needs `/proc/<pid>/cwd` reads in main).
- Richer agent-hook message extraction (currently a static "needs your attention").
- Hooks for other agents (`codex`, `opencode`, …) — the pattern generalises.

---

## 6. How to run / verify

```bash
npm run dev
```
- **OSC:** `printf '\033]9;build done\007'` in a pane → workspace flashes + toast.
- **Hooks:** run `cmux hooks setup`, then run Claude Code in a pane — it flashes on
  a Notification. (Check `~/.claude/settings.json`.)
- **Restore:** create splits/tabs in the active workspace, quit, relaunch → that
  active workspace comes back as the only startup workspace.
- `npm test` runs the layout + app-reducer + **OSC** suites (incl. split-chunk and
  fail-closed cases).

---

## 🧪 Checkpoint

1. Two ways a notification reaches the sidebar in M4 — what are they?
2. Why does the OSC sniffer return a `rest` string, and what bug does that prevent?
3. Why is session load **synchronous** but save **debounced**?
4. What made `sanitizeRestored` crash on a bad snapshot, and how does it fail closed now?
5. Why do we persist `toLayoutSnapshot` instead of the whole `AppState`?

---

## Next: M5 — the full socket control API
We expand the M3 socket server from status/notify to **full programmatic control**
(create/split/send-keys/focus, query state) — mirroring cmux's method surface.
See `../textbook/11` and `../FEATURES.md` Part 2.
