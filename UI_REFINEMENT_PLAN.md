# UI Refinement Plan

## Goal

Make cmux-linux easier to scan during multi-agent work while keeping the terminal
as the visual focus. The series is intentionally split into independent PRs so
palette infrastructure, information architecture, and terminal interaction can
be reviewed and reverted separately.

## Delivery sequence

### 1. Semantic design tokens

- [x] Define semantic surface, content, interaction, and state colors
- [x] Define shared typography, spacing, radii, shadow, and motion values
- [x] Replace component-level raw colors with token consumption
- [x] Standardize selection, scrollbar, and control transitions
- [x] Add a regression that keeps raw colors inside the token boundary
- [x] Add learning and textbook documentation

### 2. Workspace and agent hierarchy

- [ ] Make custom workspace names and project fallbacks unambiguous
- [ ] Present branch, usage, status, and agent summary in a stable reading order
- [ ] Keep a compact Agents empty state visible at startup
- [ ] Group active agents by urgency and improve accessible state labels
- [ ] Replace text glyph actions with consistent local SVG icons
- [ ] Add UI/helper regression coverage and visual verification

### 3. Terminal tabs and pane focus

- [ ] Clarify active tab and active pane without large color fills
- [ ] Make pane actions discoverable on hover and keyboard focus
- [ ] Improve tab semantics, tooltips, and keyboard focus behavior
- [ ] Add a compact workspace context strip above the terminal area
- [ ] Cover component behavior and verify split-pane layouts visually

## Constraints

- Keep state colors semantic and consistent across workspaces and agents.
- Preserve reduced-motion behavior and visible keyboard focus.
- Do not introduce external icon, theme, or component dependencies.
- Keep every phase on its own branch and PR with implementation and documentation commits.
- Run the complete test, lint, typecheck, build, and diff-check gate for every PR.
