# UI Refinement Plan

## Goal

Make Shepherd easier to scan during multi-agent work while keeping the terminal
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

- [x] Make custom workspace names and project fallbacks unambiguous
- [x] Present branch, usage, status, and agent summary in a stable reading order
- [x] Keep a compact Agents empty state visible at startup
- [x] Group active agents by urgency and improve accessible state labels
- [x] Replace text glyph actions with consistent local SVG icons
- [x] Add UI/helper regression coverage and visual verification

### 3. Terminal tabs and pane focus

- [x] Clarify active tab and active pane without large color fills
- [x] Make pane actions discoverable on hover and keyboard focus
- [x] Improve tab semantics, tooltips, and keyboard focus behavior
- [x] Add a compact workspace context strip above the terminal area
- [x] Cover component behavior and verify split-pane layouts visually

## Constraints

- Keep state colors semantic and consistent across workspaces and agents.
- Preserve reduced-motion behavior and visible keyboard focus.
- Do not introduce external icon, theme, or component dependencies.
- Keep every phase on its own branch and PR with implementation and documentation commits.
- Run the complete test, lint, typecheck, build, and diff-check gate for every PR.
