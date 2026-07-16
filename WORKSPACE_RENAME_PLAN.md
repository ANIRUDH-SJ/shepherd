# Workspace Rename Feature Plan

## Goal

Let users rename sidebar workspaces without recreating them, while preserving the existing positional fallback (`workspace 1`, `workspace 2`, …), layout, terminals, status, and session persistence.

## Product Rules

- A custom name is trimmed and limited to 64 characters.
- Submitting an empty name removes the custom name and restores the positional label.
- Renaming changes metadata only; it must not recreate the workspace or its PTYs.
- `Enter` saves and `Escape` cancels inline editing.
- Double-clicking a name or pressing `F2` on a focused row starts editing.
- Socket automation targets the workspace by its current id/name and supplies the new name separately.

## Implementation Checklist

### Goal 1 — Naming rules and reducer coverage

- [ ] Add a pure workspace-name normalizer.
- [ ] Apply normalization in workspace creation and rename actions.
- [ ] Test whitespace, empty fallback, maximum length, and state preservation.

### Goal 2 — Inline sidebar editing

- [ ] Add accessible inline editing without nesting interactive controls.
- [ ] Support pointer, `F2`, `Enter`, `Escape`, blur-save, and focus restoration.
- [ ] Preserve selection, unread indicators, close behavior, and narrow sidebar layout.

### Goal 3 — Socket and CLI automation

- [ ] Add `rename-workspace` to socket capabilities.
- [ ] Validate `--name` and resolve the target workspace before forwarding.
- [ ] Add CLI help and a controlled socket integration test.

### Goal 4 — Documentation and verification

- [ ] Document UI and CLI usage in the README and M5 learning log.
- [ ] Run tests, lint, typecheck, production build, and diff validation.
- [ ] Review the final branch for generated or unrelated files.

## Planned Commit Series

1. `docs: plan workspace rename`
2. `renderer: normalize workspace names`
3. `ui: rename workspaces inline`
4. `socket: add workspace rename command`
5. `test: cover workspace rename CLI`
6. `docs: document workspace rename`
7. `docs: complete workspace rename plan`

## Explicitly Deferred

- Enforcing globally unique workspace names.
- Rename history or undo beyond cancelling the active edit.
- Provider-generated automatic workspace titles.
- A general workspace settings dialog.
