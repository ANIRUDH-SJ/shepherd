# Repository Guidelines

## Project Structure & Module Organization

`src/main/` contains Electron's main-process services: PTY management, the Unix
socket API, notifications, and session persistence. `src/preload/` exposes the
restricted IPC bridge. The React renderer lives in `src/renderer/src/`; keep UI
components in `components/`, layout-tree logic in `layout/`, and reducers in
`state/`. Shared IPC contracts belong in `src/shared/`.

The plain Node/CommonJS CLI is under `bin/`. Packaging configuration and assets
are in `electron-builder.yml` and `build/`. Generated bundles and installers go
to `out/` and `release/`; do not edit or commit them. Architecture notes live in
`textbook/`, milestone records in `learning/`, and plans in `ROADMAP.md` and
`FEATURES.md`.

## Build, Test, and Development Commands

- `npm install` installs dependencies, including the native `node-pty` module.
- `npm run dev` launches Electron with renderer hot reload.
- `npm test` runs all headless TypeScript test files.
- `npm run lint` checks JavaScript, TypeScript, and TSX with ESLint.
- `npm run typecheck` validates both Node and renderer TypeScript projects.
- `npm run build` typechecks and produces production bundles in `out/`.
- `npm run dist` builds AppImage and `.deb` artifacts in `release/`.
- `npm run format` applies Prettier repository-wide.

## Coding Style & Naming Conventions

Use TypeScript for application code and functional React components. Prettier
enforces two-space indentation, single quotes, no semicolons, a 100-column width,
and no trailing commas. Use `PascalCase` for components and types, `camelCase`
for functions and variables, and descriptive action names such as
`createWorkspaceAction`. Keep layout and reducer operations pure. The `bin/` CLI
intentionally remains CommonJS for execution under Node or
`ELECTRON_RUN_AS_NODE`.

## Testing Guidelines

Tests are executable `*.test.ts` files run through `tsx`, without a separate test
framework. Place tests beside the module they exercise, following examples such
as `layout/tree.test.ts` and `main/osc.test.ts`. Add regression coverage for
reducer, parser, layout, or settings changes. Run tests, lint, and build before
opening a PR. No numeric coverage threshold is currently enforced.

## Commit & Pull Request Guidelines

Follow the existing concise, imperative pattern: `renderer: add font zoom`,
`socket: validate input`, or `docs: update roadmap`. Keep commits scoped to one
concern. PRs should explain the problem, implementation, and verification
performed; call out packaging or native-module implications. Include screenshots
for visible UI changes and artifact/runtime checks for packaging changes. Link
related issues or roadmap milestones when applicable, and keep generated output
out of the diff.

## Required Feature Delivery Workflow

Treat every feature as branch-and-PR work. Do not implement a feature directly on
`main` or mix it into an unrelated in-progress branch.

- Create a new, descriptively named branch from the latest appropriate `main` for
  each independently reviewable feature or PR.
- If the current checkout contains unrelated changes, preserve them and use a
  separate worktree or another non-destructive approach for the new branch.
- Plan large features as dependency-ordered PRs with explicit checklists. Give
  each PR its own branch and keep it small enough to review independently.
- Split implementation into concise, scoped commits following the repository's
  imperative commit-message convention. Do not collapse unrelated code, tests,
  UI, integrations, and documentation into one commit.
- Raise a PR for every feature branch. The PR must describe the problem,
  implementation, important decisions, dependencies, verification performed, and
  any follow-up work. Include screenshots for visible changes.
- Run the relevant focused tests throughout development, then run `npm test`,
  `npm run lint`, `npm run typecheck`, and `npm run build` before declaring the PR
  ready. Report any command that could not be run or did not pass.

Documentation is part of each feature's definition of done and is written after
the feature code and behavior have settled:

- Update `learning/` with a code-focused walkthrough of what was written, where it
  lives, and how the completed implementation works end to end. Explain the
  important types, functions, reducers, handlers, components, tests, and their
  relationships.
- Update `textbook/` with the complete engineering explanation: technology
  choices, architecture, boundaries, data flow, protocol and state design,
  implementation approach, alternatives considered, tradeoffs, security and
  validation, failure handling, testing strategy, operational behavior, and
  future extension points.
- Keep documentation synchronized with the final code. Do not present planned or
  hypothetical behavior as implemented behavior.
- Update relevant roadmap, feature matrix, glossary, index, and cross-references
  when the feature changes them.
- Put substantial documentation in a dedicated final commit or documentation PR
  so reviewers can evaluate it separately from the settled implementation.
