# cmux UI Parity and Simplification Plan

## Status

Status: active delivery plan. Planning is the first PR; implementation follows in
separate dependency-ordered PRs.

This plan responds to the current Shepherd UI reading like a generic AI dashboard:
permanent agent furniture, shortcut cards, repeated metadata, rounded containers,
and accent color applied to ordinary focus. The target is the visual restraint of
cmux while preserving Linux conventions, Shepherd's product identity, existing
accessibility, and the current React/Electron architecture.

The visual reference is cmux's official current product screenshot and documented
workspace model. We copy its hierarchy and restraint, not macOS traffic lights,
Swift/AppKit implementation details, or user-specific terminal colors.

## Program rule

Complete this series before implementing the task-first dashboards, inspectors,
and review panels in `AGENT_WORKSPACE_UI_PLAN.md`. After the parity series, every
later permanent panel must justify why it needs to remain visible beside the
terminal.

Each numbered PR below must:

1. Start from the latest appropriate `main` on its own branch/worktree.
2. Preserve unrelated work and avoid generated bundles in the diff.
3. Keep reducer/layout operations pure and avoid new UI dependencies unless a PR
   explicitly justifies one.
4. Add focused regression tests before or alongside the behavior change.
5. Capture screenshots for the empty, normal, narrow, and populated states affected.
6. Run focused checks throughout, followed by `npm test`, `npm run lint`,
   `npm run typecheck`, `npm run build`, and `git diff --check`.
7. After code and behavior settle, update both:
   - `learning/` with a code-focused walkthrough of the real implementation.
   - `textbook/` with architecture, data flow, alternatives, tradeoffs,
     accessibility, security, failure handling, testing, and extension points.
8. Synchronize `learning/README.md`, `textbook/00-INDEX.md`, `ROADMAP.md`,
   `FEATURES.md`, the glossary, and relevant cross-references.
9. Put substantial documentation in a dedicated final commit.
10. Open a PR with the problem, implementation, decisions, verification, screenshots,
    dependencies, and follow-up work.

## Delivery overview

| Order | Milestone | Branch                            | Outcome                                                                |
| ----- | --------- | --------------------------------- | ---------------------------------------------------------------------- |
| 0     | Planning  | `docs/cmux-ui-parity-plan`        | Land this delivery contract only                                       |
| 1     | M24       | `feat/minimal-workspace-sidebar`  | Flat, terminal-first sidebar without permanent AI furniture            |
| 2     | M25       | `feat/minimal-terminal-chrome`    | Compact tabs, headers, panes, and hover controls                       |
| 3     | M26       | `feat/neutral-ui-theme`           | Neutral palette and semantic-only accent/motion                        |
| 4     | M27       | `feat/notification-center`        | cmux-style rings, badges, pending list, and jump-to-unread             |
| 5     | M28       | `feat/workspace-pr-port-metadata` | Compact reliable PR and listening-port context                         |
| 6     | M29       | `feat/terminal-utilities`         | Find, command palette, contextual shortcut help, and settings entry    |
| 7     | M30       | `feat/localhost-preview`          | Constrained browser/preview surface after the terminal shell is stable |

PRs 1–3 are the immediate visual-parity pass. PRs 4–7 extend behavior only after
the simplified shell is merged and visually accepted.

---

## PR 0 — Planning documentation

**Goal:** establish the order, boundaries, commits, verification, and documentation
requirements without changing runtime behavior.

### Files

- `CMUX_UI_PARITY_PLAN.md`
- `AGENT_WORKSPACE_UI_PLAN.md`
- `ROADMAP.md`

### Commit

1. `docs: plan cmux ui parity series`

### Verification

- `npx prettier --check CMUX_UI_PARITY_PLAN.md AGENT_WORKSPACE_UI_PLAN.md ROADMAP.md`
- `git diff --check`

No application tests or screenshots are required because this PR changes no
runtime behavior.

## PR 1 / M24 — Minimal workspace sidebar

**Goal:** make the sidebar a flat workspace list with contextual agent status,
not a permanent AI dashboard.

**Status:** implementation and documentation are complete on
`feat/minimal-workspace-sidebar`; review and merge are the remaining delivery steps.

### Scope

- Remove the permanent global Agents section and its empty-state card.
- Remove the permanent shortcut legend.
- Flatten workspace rows: no ordinary card border, shadow, or large gaps.
- Keep one restrained active-row treatment with a small radius.
- Make project/task name primary.
- Show branch/cwd and latest useful status only when the data exists.
- Show agent state inside its owning workspace row only when an agent exists.
- Keep usage secondary and hide unavailable data rather than showing placeholders.
- Make the Shepherd label neutral and reduce top-bar height/padding.
- Preserve rename, close, context menu, unread, sidebar resize/collapse, accessible
  naming, keyboard selection, and exact agent-to-terminal focus.

### Delivery commits

1. `test: define contextual sidebar agents`
   - Add compact contextual labels and complete accessible-label coverage.
2. `renderer: flatten workspace sidebar`
   - Reshape `Sidebar` composition and workspace-row markup.
   - Remove permanent `AgentList` and shortcut rendering.
3. `ui: simplify sidebar hierarchy`
   - Apply flat-list density, neutral toolbar treatment, restrained selection,
     truncation, hover, focus, narrow-width, and reduced-motion styles.
4. `renderer: hide generic sidebar metadata`
   - Suppress repeated `Home` context while preserving useful repository context.
   - Cover useful, generic, and unnamed project-context branches.
5. `docs: explain minimal workspace sidebar`
   - Add the M24 learning walkthrough.
   - Update textbook sidebar information architecture and indexes.
   - Synchronize feature map, roadmap, glossary, and visual verification notes.

### Focused verification

- Sidebar view/helper tests.
- Workspace/agent reducer regressions affected by presentation derivation.
- Renderer component interaction checks.
- Visual states: fresh launch, several workspaces, agent working, agent needs input,
  unread workspace, custom name, narrow sidebar, and reduced motion.

### Acceptance criteria

- A fresh launch shows only the workspace list and terminal-relevant controls.
- There is no `AGENTS 0`, dashed empty-state card, or permanent shortcut block.
- No agent information is duplicated in two permanent sidebar sections.
- At least twice as many realistic workspace rows fit in the same sidebar height.
- Keyboard and screen-reader behavior remains equivalent or improves.

## PR 2 / M25 — Minimal terminal chrome

**Depends on:** PR 1.

**Goal:** reduce the stacked-header and card-container appearance around the terminal.

**Status:** implementation, live interaction proof, and documentation are complete on
`feat/minimal-terminal-chrome`; review and merge are the remaining delivery steps.

### Scope

- Keep one compact workspace title strip and remove low-value `Pane N · Terminal N`
  copy from permanent chrome.
- Use rectangular tabs with minimal inactive backgrounds instead of pills/cards.
- Show close and pane actions on hover or keyboard focus while preserving shortcuts.
- Remove ordinary rounded pane containers and permanent accent borders.
- Use neutral hairline split boundaries.
- Keep a visible but restrained keyboard-focus indicator.
- Preserve tab ARIA semantics, roving focus, terminal mounts, PTY ownership, splits,
  dividers, close constraints, and exact terminal focus.
- Continue using stable terminal numbering as an accessible fallback while allowing
  useful semantic titles later.

### Delivery commits

1. `test: define minimal terminal chrome`
2. `renderer: compact workspace and tab chrome`
3. `ui: flatten panes and hover controls`
4. `renderer: keep active tabs in view`
5. `docs: explain minimal terminal chrome`

### Focused verification

- Existing terminal chrome, tab navigation, layout tree, divider, and ownership tests.
- One-, two-, four-, and eight-pane screenshots.
- Narrow pane, many tabs, disabled close, keyboard focus, hover, and attention states.
- Terminal selection, input, zoom, link activation, and resize smoke checks.

### Acceptance criteria

- The terminal begins after no more than two compact chrome rows.
- Normal active panes do not look like notification states.
- Secondary actions do not compete with terminal content.
- Splits read as one continuous terminal workspace rather than a grid of cards.

## PR 3 / M26 — Neutral theme and semantic interaction states

**Depends on:** PRs 1–2.

**Goal:** remove the blue/purple AI-dashboard palette while keeping meaning,
accessibility, and theme extension points.

### Scope

- Shift canvas, sidebar, tabs, raised surfaces, and borders to neutral near-black
  and charcoal roles.
- Reserve blue for active selection and true attention/focus moments.
- Reserve green, amber, and red for semantic success, waiting, and failure.
- Reduce corner radii and eliminate decorative shadows outside popovers.
- Remove uppercase letter-spaced micro-headings from ordinary navigation.
- Ensure terminal colors remain independent from Shepherd UI chrome.
- Retain strong `:focus-visible`, high-contrast, and reduced-motion alternatives.
- Add theme-token regressions so component CSS does not reintroduce arbitrary colors.

### Planned commits

1. `test: define neutral theme boundaries`
2. `ui: neutralize shell palette and geometry`
3. `ui: reserve accent and motion for semantic state`
4. `docs: explain neutral terminal-first theming`

### Focused verification

- Theme-token boundary and component helper tests.
- Automated contrast checks where available plus manual focus/contrast review.
- Default, hover, selected, keyboard focus, attention, success, failure, disabled,
  reduced-motion, narrow, and high-density screenshots.

### Acceptance criteria

- Ordinary focus, selection, and attention are visually distinguishable.
- A normal fresh launch does not contain several simultaneous blue outlines/fills.
- No decorative dashboard card remains in the default shell.
- The terminal remains the highest-contrast and largest visual surface.

## PR 4 / M27 — Notification center and meaningful rings

**Depends on:** PRs 1–3.

**Goal:** make attention obvious without restoring a permanent agent dashboard.

### Scope

- Use a brief pane ring/pulse only when new attention arrives.
- Leave a stable unread badge in the workspace row after the pulse.
- Add a compact notification popover listing pending notifications.
- Add jump-to-latest-unread and mark-current-read actions.
- Distinguish unread, unresolved, and cleared state.
- Deduplicate socket, OSC, and provider lifecycle notifications where they represent
  the same event.
- Preserve desktop notification settings and reduced-motion behavior.

### Planned commits

1. `test: define notification inbox semantics`
2. `state: track bounded pending notifications`
3. `renderer: add notification popover and navigation`
4. `ui: add restrained attention rings and badges`
5. `docs: explain notification center behavior`

### Verification and documentation

- Parser/socket/reducer ordering, deduplication, persistence, cleanup, and limits.
- Keyboard and screen-reader popover navigation.
- Visual proof for no notifications, new pulse, stable unread, several pending items,
  cleared state, inactive workspace, and reduced motion.
- Complete `learning/` and `textbook/` updates after behavior settles.

## PR 5 / M28 — Compact PR and listening-port metadata

**Depends on:** PRs 1–3.

**Goal:** match cmux's useful workspace context without adding dashboard panels.

### Scope

- Detect PR status through an optional authenticated `gh` capability.
- Detect listening ports through bounded Linux process ownership.
- Render PR and port metadata in one compact workspace detail line.
- Hide missing/unavailable metadata completely.
- Cache and refresh without hot-path subprocess polling.
- Keep GitHub optional and surface authentication errors only on explicit interaction.

### Planned commits

1. `test: define workspace metadata contracts`
2. `main: discover bounded pr and port context`
3. `renderer: show compact workspace metadata`
4. `docs: explain pr and port metadata`

### Verification and documentation

- No repo, no remote, missing `gh`, unauthenticated `gh`, open/closed PR, several ports,
  port reuse, process exit, narrow sidebar, cache invalidation, and performance checks.
- Complete `learning/` and `textbook/` updates after behavior settles.

## PR 6 / M29 — Terminal utilities and contextual help

**Depends on:** PRs 1–3.

**Goal:** replace the removed shortcut wall with useful, discoverable tools.

### Scope

- Add current-terminal scrollback find.
- Add a compact command palette for existing workspace, tab, pane, and settings actions.
- Add contextual shortcut help reachable from the palette or help action.
- Add a settings entry for terminal font, theme integration, and keybindings without
  putting settings controls in permanent chrome.
- Keep command registration typed and keyboard-first.

### Planned commits

1. `test: define terminal utility commands`
2. `renderer: add terminal find`
3. `renderer: add command palette and contextual help`
4. `renderer: add minimal settings entry`
5. `docs: explain terminal utilities`

### Verification and documentation

- Search wrapping, empty query, large scrollback, focus restoration, shortcut conflicts,
  palette ranking, narrow window, keyboard-only, and screen-reader flows.
- Complete `learning/` and `textbook/` updates after behavior settles.

## PR 7 / M30 — Constrained localhost preview

**Depends on:** PRs 1–6, especially reliable listening-port metadata.

**Goal:** add cmux's useful terminal-plus-browser workflow without immediately
building a general-purpose browser platform.

### Scope

- Open an explicitly selected localhost server beside a terminal.
- Reuse the pane/surface model with a constrained preview panel type.
- Provide URL, back/forward, reload, open externally, and error controls.
- Enforce navigation, popup, download, permission, and external-protocol policies.
- Keep renderer/process lifecycle and memory use explicit.
- Defer general browsing, cookie import, remote routing, automation, and devtools to
  separately planned follow-up PRs.

### Planned commits

1. `test: define preview panel contracts`
2. `main: enforce preview navigation boundaries`
3. `renderer: add localhost preview surface`
4. `ui: integrate minimal preview chrome`
5. `docs: explain localhost preview architecture`

### Verification and documentation

- Safe and unsafe URLs, server exit/restart, redirects, popup/download attempts,
  split resize, tab switching, session persistence, cleanup, and memory checks.
- Complete `learning/` and `textbook/` updates after behavior settles.

---

## Visual acceptance checklist for PRs 1–3

- [x] No permanent Agents section when the sidebar can express contextual state.
- [x] No permanent shortcut legend.
- [x] No dashed empty-state cards.
- [x] No generic `Pane N · Terminal N` copy in permanent top-level chrome.
- [x] No ordinary pane rendered as a rounded dashboard card.
- [x] No accent ring used as the default active-pane treatment.
- [ ] No repeated project, workspace, branch, and agent information across several rows.
- [x] Secondary controls appear on hover/focus without becoming undiscoverable.
- [x] Empty space belongs to the terminal, not placeholder panels.
- [x] Narrow layouts truncate intentionally and preserve actions.
- [x] Keyboard focus remains clearly visible.
- [x] Reduced-motion users receive equivalent non-animated state.
- [x] Terminal selection, input, resize, links, splits, tabs, and PTY lifecycle regressions pass.

## Explicit non-goals

- Pixel-copying macOS window buttons or platform chrome.
- Copying cmux source code or private implementation details.
- Replacing Electron/xterm.js solely for appearance.
- Introducing a component library to obtain generic cards or dialogs.
- Building an IDE, full editor, or proprietary agent.
- Making browser, GitHub, cloud accounts, or a specific agent provider mandatory.
- Mixing any two implementation milestones into one large PR.
