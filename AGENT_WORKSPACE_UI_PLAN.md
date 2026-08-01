# Agent Workspace UI Implementation Plan

## Status

**Planning only. No feature in this document is implemented by this plan.**

Before Feature 1 begins, complete the terminal-first simplification series in
[`CMUX_UI_PARITY_PLAN.md`](./CMUX_UI_PARITY_PLAN.md). That series removes the
current dashboard-like sidebar and chrome before any new persistent agent panels
are considered. After it lands, re-evaluate this plan against the simplified UI;
do not assume that every panel proposed below should still be built.

This is a deferred, dependency-ordered implementation series for evolving
Shepherd from a terminal multiplexer with agent awareness into a Linux-first,
provider-neutral control room for parallel coding agents. Implementation starts
only through the individual branches and PRs described below.

## Product direction

Shepherd should keep the real terminal as its execution surface. It should not
try to become a full code editor or a proprietary coding agent. Its UI should
make the agent-work lifecycle easy to understand and control:

```text
create isolated task
  -> monitor meaningful progress
  -> respond to approvals, questions, or failures
  -> inspect and review changes
  -> merge, hand off, discard, or archive the result
```

The core product advantages to preserve are:

- Linux-first desktop behavior.
- Compatibility with multiple CLI coding agents.
- Local terminals and transparent processes rather than a required cloud runtime.
- Git worktree isolation and ordinary Git interoperability.
- A scriptable Unix-socket API.
- Semantic agent status and usage with explicit provenance.

## Delivery rules for every feature

Each numbered feature below is an independently reviewable delivery unit. Unless
a feature is explicitly split further, it receives its own branch and PR.

For **every feature**, completion requires all of the following:

1. Create a descriptive branch from the latest appropriate `main`.
2. Keep the implementation, focused tests, and visual proof scoped to that feature.
3. Run focused checks throughout development.
4. Settle the code and behavior before writing completion documentation.
5. Add or update a code-focused walkthrough in `learning/` explaining the real
   files, types, reducers, IPC handlers, components, tests, and end-to-end flow.
6. Add or update a complete engineering explanation in `textbook/` covering the
   architecture, data flow, technology choices, boundaries, alternatives,
   tradeoffs, validation, security, failure handling, testing, operations, and
   future extension points.
7. Update `learning/README.md`, `textbook/00-INDEX.md`, `ROADMAP.md`, `FEATURES.md`,
   the glossary, and relevant cross-references when the feature changes them.
8. Put substantial documentation in a dedicated final commit so it can be
   reviewed separately from the settled implementation.
9. Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, and
   `git diff --check` before declaring the PR ready.
10. Include screenshots or recorded visual evidence for every visible UI change.

Future milestone and chapter numbers must be assigned from the current indexes
when implementation begins; this plan intentionally does not reserve numbers
that could conflict with other work landing first.

## Cross-cutting interaction principles

- Put the user's task and required action ahead of the agent provider name.
- Use progressive disclosure: show outcomes and state summaries before raw logs.
- Keep **Needs you**, **Working**, **Ready to review**, and **Finished** visually
  distinct without relying only on color.
- Use a short attention pulse followed by a stable indicator; do not flash forever.
- Never present estimated progress, cost, or completion as exact.
- Keep destructive Git and filesystem actions explicit, validated, and recoverable
  when possible.
- Preserve keyboard operation, visible focus, reduced motion, screen-reader labels,
  terminal selection, and terminal input behavior in every phase.
- Do not duplicate the same agent state in several permanent navigation surfaces.
- Measure performance and memory effects at realistic terminal and agent counts.

## Dependency overview

```text
1 Task-first sidebar
  -> 2 Attention center
  -> 3 Review summary -> 4 Full diff review
  -> 5 New agent task flow
  -> 6 Session inspector -> 7 Session lifecycle
  -> 8 Semantic terminal chrome
  -> 9 Permission and control handoff
  -> 10 Terminal context actions
  -> 11 Command palette
  -> 12 Terminal navigation and layouts
  -> 13 Onboarding, settings, and accessibility
  -> 14 Usage budgets
  -> 15 Localhost preview
  -> 16 PR cockpit
  -> 17 Task recipes and handoffs
  -> 18 Comparison and remote-monitoring experiments
```

Features 3 and 5 may proceed independently after feature 2, but the default is
to deliver the sequence one feature at a time.

---

## Feature 1 — Task-first sidebar information architecture

**Goal:** replace duplicated workspace and global-agent summaries with one
scannable task hierarchy while preserving direct access to every terminal.

### Implementation checklist

- [ ] Define a pure sidebar view model grouped into **Needs you**, **Working**,
      **Ready to review**, and **Recent**.
- [ ] Make task/workspace title primary and provider identity a secondary badge.
- [ ] Show project, branch, elapsed time, reliable status, and usage without
      repeating the same state in a separate permanent agent list.
- [ ] Preserve workspace rename, close, unread, keyboard selection, and exact
      agent-to-terminal focus behavior.
- [ ] Support narrow, normal, and wide sidebar widths with intentional truncation.
- [ ] Add pure ordering/grouping tests and component interaction tests.
- [ ] Capture visual proof with no agents, one agent, and several mixed-state agents.

### Documentation gate

- [ ] Add a `learning/` walkthrough for the new sidebar view model and component flow.
- [ ] Update or extend the textbook treatment of sidebar information architecture,
      density, task identity, and progressive disclosure.
- [ ] Synchronize indexes, feature map, roadmap, glossary, and screenshots.

## Feature 2 — Attention center and notification inbox

**Depends on:** Feature 1.

**Goal:** provide one durable place for approvals, questions, failures, and
completed work instead of relying on animation or transient desktop alerts.

### Implementation checklist

- [ ] Define bounded, typed attention items tied to workspace, pane, surface, and agent.
- [ ] Add an attention center grouped by urgency and recency.
- [ ] Support open source terminal, reply, approve/reject where supported, resolve,
      and jump to the next unresolved item.
- [ ] Replace infinite row flashing with a reduced-motion-aware pulse and stable badge.
- [ ] Distinguish unread from unresolved and persist only the required state.
- [ ] Add keyboard navigation and a global jump-to-latest-unresolved shortcut.
- [ ] Test ordering, deduplication, stale sources, persistence, and cleanup.
- [ ] Verify desktop and in-app notification behavior together.

### Documentation gate

- [ ] Add a `learning/` walkthrough for attention state, IPC/socket flow, and UI actions.
- [ ] Add or update a textbook chapter on attention management, notification
      semantics, persistence, accessibility, and failure handling.
- [ ] Synchronize indexes, feature map, roadmap, glossary, and screenshots.

## Feature 3 — Change summary and review-center foundation

**Depends on:** Feature 2.

**Goal:** make an agent's outcome visible before building a complete in-app diff editor.

### Implementation checklist

- [ ] Define bounded Git change-summary contracts in shared code.
- [ ] Resolve repository and worktree identity in Electron main, not the renderer.
- [ ] Show reliable changed-file and added/deleted-line counts per task.
- [ ] Add a review panel with modified, added, deleted, renamed, and untracked groups.
- [ ] Add safe actions to open the worktree, file, or external editor.
- [ ] Show branch, base, dirty state, last commit, and stale/error states.
- [ ] Cache and refresh summaries without adding hot-path Git polling.
- [ ] Test parsing, worktree ownership, unusual paths, large diffs, and repository loss.
- [ ] Measure refresh overhead with several workspaces and terminals.

### Documentation gate

- [ ] Add a `learning/` walkthrough for Git summary collection, state ownership, and UI.
- [ ] Add a textbook explanation of Git diff models, process safety, caching,
      worktree boundaries, scalability, and operational failure modes.
- [ ] Synchronize indexes, feature map, roadmap, glossary, and screenshots.

## Feature 4 — Full diff review and agent feedback

**Depends on:** Feature 3.

**Goal:** let users inspect, accept, reject, and comment on agent changes without
turning Shepherd into a general-purpose editor.

### Implementation checklist

- [ ] Add a virtualized, syntax-aware file and hunk diff surface.
- [ ] Support review scopes such as worktree, staged, unstaged, commit, and last turn
      only when the underlying provenance is reliable.
- [ ] Add per-file and per-hunk stage, unstage, and revert actions with confirmation
      proportional to destructiveness.
- [ ] Add line-specific review comments that can be sent to the owning agent.
- [ ] Preserve binary, generated, oversized, renamed, and conflicted-file states.
- [ ] Provide an external-editor escape hatch for unsupported files.
- [ ] Add security validation and terminal/worktree ownership checks for every action.
- [ ] Test hunk mapping, stale diffs, conflicts, partial staging, and destructive-action
      cancellation.
- [ ] Verify large-diff rendering and keyboard review navigation.

### Documentation gate

- [ ] Add a `learning/` walkthrough for diff loading, rendering, Git actions, and feedback.
- [ ] Add a textbook chapter on diff algorithms, staging, review state, security,
      stale-data handling, virtualization, alternatives, and recovery.
- [ ] Synchronize indexes, feature map, roadmap, glossary, and screenshots.

## Feature 5 — New agent task flow

**Depends on:** Features 1 and 2; may run in parallel with Features 3–4 only as a
separate PR with no overlapping state-model changes.

**Goal:** turn worktree creation and terminal launch into an understandable,
task-oriented product flow.

### Implementation checklist

- [ ] Add a dedicated **New agent task** action separate from **New workspace**.
- [ ] Collect repository, task title/prompt, base branch, local/worktree isolation,
      agent provider, setup profile, and starting permission mode.
- [ ] Validate repository, branch, path, and agent executable before mutation.
- [ ] Preview the worktree/branch operations and surface actionable failures.
- [ ] Support foreground and background start while keeping ordinary terminal
      workspaces available.
- [ ] Reuse the existing validated worktree and socket boundaries.
- [ ] Remember only safe, useful defaults; never persist task secrets implicitly.
- [ ] Add reducer, IPC, main-process, and end-to-end creation tests.
- [ ] Capture success, validation failure, and setup failure screenshots.

### Documentation gate

- [ ] Add a `learning/` walkthrough for task creation from form to worktree and PTY.
- [ ] Add or update textbook coverage of task modeling, isolation choices,
      validation, setup profiles, permissions, rollback, and failure recovery.
- [ ] Synchronize indexes, feature map, roadmap, glossary, and screenshots.

## Feature 6 — Session inspector and semantic activity timeline

**Depends on:** Features 2 and 3.

**Goal:** reveal what an agent is doing through meaningful events without making
raw terminal output the primary monitoring UI.

### Implementation checklist

- [ ] Add a collapsible inspector beside or below the active workspace.
- [ ] Show current plan/checklist when reported, last meaningful activity, approvals,
      tests, changed files, elapsed time, and usage provenance.
- [ ] Define bounded semantic timeline events with explicit source and timestamps.
- [ ] Keep raw logs opt-in and virtualized.
- [ ] Degrade cleanly for automatically discovered agents with limited semantics.
- [ ] Add stale, disconnected, unknown, and provider-error states.
- [ ] Test event ordering, source precedence, bounds, reconnection, and cleanup.
- [ ] Measure memory and render behavior for long-running sessions.

### Documentation gate

- [ ] Add a `learning/` walkthrough for event ingestion, storage bounds, and inspector UI.
- [ ] Add a textbook chapter on observability versus transcript display, event
      provenance, ordering, retention, privacy, scalability, and extensions.
- [ ] Synchronize indexes, feature map, roadmap, glossary, and screenshots.

## Feature 7 — Durable task lifecycle, history, and archive

**Depends on:** Feature 6.

**Goal:** preserve reviewable outcomes after an agent process exits and make old
tasks easy to resume, archive, restore, merge, or discard.

### Implementation checklist

- [ ] Define task lifecycle states: working, needs input, ready to review, approved,
      merged, discarded, failed, and archived.
- [ ] Separate process liveness from task completion state.
- [ ] Add pin, rename, archive, restore, reopen, and remove actions.
- [ ] Restore the task/worktree association without pretending to restore arbitrary
      live process memory.
- [ ] Add retention and cleanup policies with explicit disk-usage visibility.
- [ ] Snapshot recoverable metadata before removing managed worktrees.
- [ ] Test migration, restart, interrupted cleanup, missing worktrees, and retention.
- [ ] Verify active, recent, and archived navigation with realistic data volumes.

### Documentation gate

- [ ] Add a `learning/` walkthrough for lifecycle transitions, persistence, and cleanup.
- [ ] Add or update textbook coverage of session identity, persistence, worktree
      retention, snapshots, recovery, and operational tradeoffs.
- [ ] Synchronize indexes, feature map, roadmap, glossary, and screenshots.

## Feature 8 — Semantic terminal titles and workspace context bar

**Depends on:** Feature 1; use review and lifecycle metadata only when available.

**Goal:** make panes recognizable without generic `Terminal 1` labels or repeated
sidebar metadata.

### Implementation checklist

- [ ] Derive bounded titles from agent/task, active command, cwd, server, or shell.
- [ ] Keep stable fallback numbering for accessibility and ambiguous cases.
- [ ] Add compact context for project, branch, dirty/change state, PR, port, and agent.
- [ ] Make metadata clickable only when a safe, useful destination exists.
- [ ] Avoid title churn from noisy subprocesses and rapid cwd changes.
- [ ] Preserve tab keyboard semantics, truncation, focus, and narrow-pane layouts.
- [ ] Test title precedence, sanitization, stability, and provider fallbacks.
- [ ] Capture one-, two-, four-, and eight-pane visual evidence.

### Documentation gate

- [ ] Add a `learning/` walkthrough for title derivation and context-strip rendering.
- [ ] Update textbook coverage of terminal chrome, process metadata, precedence,
      accessibility, and dense layout tradeoffs.
- [ ] Synchronize indexes, feature map, roadmap, glossary, and screenshots.

## Feature 9 — Permission visibility and human/agent control handoff

**Depends on:** Features 2 and 6.

**Goal:** clearly show who controls a terminal, what the agent may do, and how the
user can interrupt or take over safely.

### Implementation checklist

- [ ] Show the active permission mode and whether the user or agent controls input.
- [ ] Add take over, hand back, pause/interrupt, and stop controls only where the
      provider protocol supports them.
- [ ] Label every approval with its source task, agent, terminal, action, and scope.
- [ ] Require explicit confirmation for broader or persistent permission changes.
- [ ] Keep provider capability detection separate from visual presentation.
- [ ] Preserve ordinary terminal input when no managed agent controls the PTY.
- [ ] Test races, provider exit, stale controls, nested agents, and unsupported modes.
- [ ] Run keyboard, screen-reader, reduced-motion, and destructive-action checks.

### Documentation gate

- [ ] Add a `learning/` walkthrough for capability detection and control transitions.
- [ ] Add a textbook chapter on human authority, agent permissions, PTY ownership,
      approval provenance, interruption, security, and provider differences.
- [ ] Synchronize indexes, feature map, roadmap, glossary, and screenshots.

## Feature 10 — Terminal selection as agent context

**Depends on:** Features 5 and 9.

**Goal:** let users turn selected output and detected errors into bounded context
for an existing or new agent task.

### Implementation checklist

- [ ] Add selection actions for ask active agent, start task, explain error, and copy
      with command/cwd context.
- [ ] Make every outbound context previewable and editable before submission.
- [ ] Bound selection length and label truncation clearly.
- [ ] Preserve ANSI meaning only when useful; never send hidden terminal control data.
- [ ] Associate context with the correct terminal, cwd, command, and timestamp.
- [ ] Keep normal selection, copy, link activation, and right-click behavior intact.
- [ ] Test wide characters, wrapped lines, huge selections, stale terminals, and secrets.
- [ ] Verify the flow with shell errors, test failures, and server logs.

### Documentation gate

- [ ] Add a `learning/` walkthrough for xterm selection extraction and agent submission.
- [ ] Add a textbook chapter on terminal context capture, trust boundaries, privacy,
      encoding, truncation, interaction conflicts, and failure handling.
- [ ] Synchronize indexes, feature map, roadmap, glossary, and screenshots.

## Feature 11 — Global command palette and project actions

**Depends on:** Features 1, 5, 7, and 10.

**Goal:** provide one keyboard-first entry point for navigation, task actions,
layouts, settings, and safe project-defined commands.

### Implementation checklist

- [ ] Add searchable commands, workspaces, tasks, agents, recent history, and settings.
- [ ] Rank exact, prefix, fuzzy, recent, and contextual matches predictably.
- [ ] Add project actions through a versioned, validated `shepherd.json` schema.
- [ ] Display command scope, shortcut, source, and destructive status.
- [ ] Require confirmation for untrusted repository-defined execution.
- [ ] Keep the palette responsive with large histories and many workspaces.
- [ ] Add pure ranking, schema, focus, keyboard, and execution-boundary tests.
- [ ] Verify empty, narrow, error, and large-result states visually.

### Documentation gate

- [ ] Add a `learning/` walkthrough for the command registry, ranking, and execution.
- [ ] Add a textbook chapter on command palettes, fuzzy search, project configuration,
      trust, validation, keyboard UX, performance, and extensibility.
- [ ] Synchronize indexes, feature map, roadmap, glossary, and screenshots.

## Feature 12 — Terminal search, focus mode, and layout operations

**Depends on:** Feature 11 for discoverability; commands must remain available
through direct shortcuts where appropriate.

**Goal:** finish the conventional terminal-navigation tools needed during complex
agent sessions.

### Implementation checklist

- [ ] Add bounded current-terminal scrollback search with next/previous navigation.
- [ ] Add temporary maximize/focus mode without destroying the split tree.
- [ ] Add equalize splits and a small set of deterministic layout presets.
- [ ] Support moving a tab between panes and, only when safe, between workspaces.
- [ ] Show terminal zoom state and expose reset through the palette.
- [ ] Preserve mounted-terminal lifetime and PTY ownership during layout moves.
- [ ] Add layout purity, focus restoration, tab move, search, and lifecycle tests.
- [ ] Verify realistic one-, two-, four-, and eight-terminal workflows.

### Documentation gate

- [ ] Add a `learning/` walkthrough for search, focus mode, and layout transformations.
- [ ] Update textbook chapters on xterm.js, layout trees, terminal ownership,
      keyboard interaction, rendering performance, and failure recovery.
- [ ] Synchronize indexes, feature map, roadmap, glossary, and screenshots.

## Feature 13 — Onboarding, settings, density, and accessibility

**Depends on:** Features 1–12 so the UI being introduced is stable enough to teach
and configure.

**Goal:** make the completed core workflow understandable and adaptable without
requiring users to discover it from repository documentation.

### Implementation checklist

- [ ] Add a first-run path for opening a repository, creating an isolated task,
      launching an agent, installing integrations, and learning core shortcuts.
- [ ] Replace the permanently visible shortcut list with contextual help and palette access.
- [ ] Add compact/comfortable density, UI and terminal fonts, theme/accent, notification,
      reduced-motion, and keybinding settings.
- [ ] Validate and migrate settings without resetting existing preferences.
- [ ] Add useful empty, loading, unavailable-provider, and failure states.
- [ ] Audit contrast, focus order, screen-reader names, zoom, reduced motion, and targets.
- [ ] Test settings migrations, reset behavior, onboarding completion, and key conflicts.
- [ ] Capture the complete first-run and settings flow visually.

### Documentation gate

- [ ] Add a `learning/` walkthrough for onboarding and settings state/persistence.
- [ ] Add or update textbook coverage of accessible desktop UI, theming, preference
      migration, onboarding, failure communication, and configuration boundaries.
- [ ] Synchronize indexes, feature map, roadmap, glossary, README, and screenshots.

## Feature 14 — Usage budgets and trustworthy resource controls

**Depends on:** Feature 6 and the existing usage-provenance foundation.

**Goal:** make usage actionable while preserving the distinction between exact,
estimated, partial, and unavailable measurements.

### Implementation checklist

- [ ] Add optional per-task warning thresholds and budgets without claiming enforcement
      where a provider cannot enforce it.
- [ ] Show elapsed time, command count, and provider/model breakdown when reported.
- [ ] Keep exact/estimated provenance visible at every aggregation level.
- [ ] Add threshold notifications without overwhelming the attention center.
- [ ] Never infer currency cost without a versioned, attributable price source.
- [ ] Bound historical usage retention and expose reset/export behavior.
- [ ] Test mixed provenance, counter resets, reconnects, thresholds, and overflow.
- [ ] Verify dense and unavailable-data states visually.

### Documentation gate

- [ ] Add a `learning/` walkthrough for budgets, thresholds, aggregation, and UI.
- [ ] Update textbook coverage of usage provenance, estimation, pricing boundaries,
      retention, user trust, and provider variability.
- [ ] Synchronize indexes, feature map, roadmap, glossary, and screenshots.

## Feature 15 — Localhost preview panel

**Depends on:** Features 3, 8, and 9.

**Goal:** provide a focused development-server preview before attempting a
general-purpose in-app browser or browser automation platform.

### Implementation checklist

- [ ] Detect listening localhost ports through bounded, ownership-aware observation.
- [ ] Show server badges and explicit open-preview actions.
- [ ] Add a constrained preview panel with navigation, reload, open externally, and errors.
- [ ] Define strict URL, permission, popup, download, and external-navigation policies.
- [ ] Keep preview process and memory lifecycle explicit.
- [ ] Preserve terminal space through split, tab, and focus-mode options.
- [ ] Test port reuse, process exit, redirects, unavailable servers, and unsafe URLs.
- [ ] Measure preview memory/render cost beside multiple active terminals.

### Documentation gate

- [ ] Add a `learning/` walkthrough for port discovery and preview lifecycle.
- [ ] Add a textbook chapter on Electron web content, navigation security, process
      isolation, localhost routing, lifecycle, performance, and browser deferral.
- [ ] Synchronize indexes, feature map, roadmap, glossary, and screenshots.

## Feature 16 — Pull-request cockpit

**Depends on:** Features 3–4, 7, and 15 where preview verification is useful.

**Goal:** attach PR context, review feedback, checks, and merge readiness to the
task/worktree that produced the branch.

### Implementation checklist

- [ ] Detect authenticated `gh` capability without making GitHub mandatory.
- [ ] Show PR number, state, review decision, changed files, and check summary.
- [ ] Link review comments to files and lines in the review center when possible.
- [ ] Support refresh, open externally, and safe branch/PR creation actions.
- [ ] Keep authentication failures and repository-provider limitations actionable.
- [ ] Do not merge automatically; keep final human responsibility explicit.
- [ ] Test no-remote, fork, detached worktree, missing auth, stale checks, and rate limits.
- [ ] Verify PR states and failure conditions visually.

### Documentation gate

- [ ] Add a `learning/` walkthrough for GitHub discovery, PR state, and review linking.
- [ ] Add a textbook chapter on CLI/API integration, authentication, rate limits,
      stale remote state, provider abstraction, security, and human approval.
- [ ] Synchronize indexes, feature map, roadmap, glossary, and screenshots.

## Feature 17 — Task recipes, skills, and handoff summaries

**Depends on:** Features 5–7, 10–11, and 16.

**Goal:** make successful workflows reusable and make task transfer understandable
without copying entire transcripts.

### Implementation checklist

- [ ] Add versioned project and user recipes for common task shapes such as
      investigate, implement, verify, and review.
- [ ] Keep recipes provider-neutral and show every command, permission, and context source.
- [ ] Generate bounded handoff summaries covering decisions, files, tests, risks,
      usage provenance, and remaining work.
- [ ] Allow users to edit summaries before copying, saving, or sending them.
- [ ] Store durable task notes separately from raw terminal transcripts.
- [ ] Add import/export with schema validation and no implicit secret inclusion.
- [ ] Test precedence, invalid recipes, migration, redaction, and provider fallback.
- [ ] Verify recipe selection and handoff review visually.

### Documentation gate

- [ ] Add a `learning/` walkthrough for recipes, handoff data, and provider adapters.
- [ ] Add a textbook chapter on reusable workflows, configuration precedence,
      summarization boundaries, privacy, portability, and extension points.
- [ ] Synchronize indexes, feature map, roadmap, glossary, and screenshots.

## Feature 18 — Agent comparison and remote-monitoring experiments

**Depends on:** the completed local workflow through Feature 17.

**Goal:** validate later differentiators without committing the core product to
cloud orchestration, mobile control, or simultaneous competing implementations.

This feature is an investigation series, not automatic authorization to ship all
experiments. Each accepted experiment requires its own follow-up feature plan,
branch, PR, verification, and documentation gates.

### Investigation checklist

- [ ] Prototype comparing two agents in isolated worktrees using diff, tests,
      duration, and trustworthy usage rather than a single opaque score.
- [ ] Prototype a read-only local-network monitoring view for task state and attention.
- [ ] Evaluate remote SSH task identity, routing, persistence, and trust boundaries.
- [ ] Evaluate opt-in sharing or multiplayer without exposing terminal contents by default.
- [ ] Measure security, privacy, latency, storage, and maintenance costs.
- [ ] Record explicit go/no-go decisions and delete abandoned prototype code.

### Documentation gate

- [ ] Add a `learning/` investigation record for each retained prototype and its code.
- [ ] Add or update textbook material for every retained architecture, including
      rejected alternatives and measured tradeoffs.
- [ ] Synchronize indexes, feature map, roadmap, glossary, and screenshots only for
      behavior that is actually retained.

---

## Explicitly deferred or excluded

- Building a complete IDE or general-purpose source editor.
- Shipping a Shepherd-owned proprietary coding model or agent runtime.
- Adding a universal prompt box before provider-neutral task submission is reliable.
- Building a general web browser before the constrained localhost preview is proven.
- Showing percentage progress without a measurable provider-reported total.
- Treating cloud accounts, GitHub, or a specific coding-agent subscription as mandatory.
- Decorative avatars, constant animation, or visual effects that reduce information density.
- Starting multiple UI features in one branch merely because they appear in this plan.

## Final program completion criteria

The program is complete only when every accepted feature has its own merged PR,
tests, visual proof, synchronized product documentation, a code-focused
`learning/` walkthrough, and complete `textbook/` engineering coverage. Deferred
experiments remain unchecked and must not be described as implemented behavior.
