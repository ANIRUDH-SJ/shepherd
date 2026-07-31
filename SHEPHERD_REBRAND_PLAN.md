# Shepherd Rebrand Plan

## Status and scope

Status: implementation and documentation complete; final verification in progress.

Branch: `feat/shepherd-rebrand`

Baseline: `362c1e6b79144c100aab8a133040b07674479a57`

This feature renames the product and GitHub repository from cmux-linux to
Shepherd. It covers visible UI, Electron identity, Linux packaging, the primary
CLI, runtime diagnostics, documentation, and repository metadata. It also
provides a compatibility bridge for existing sessions and automation.

The canonical Desktop checkout remains at
`/home/anirudh-s-j/Desktop/cmux-linux` during delivery so active tooling and
historical worktrees are not invalidated. The GitHub repository is renamed only
after the feature PR is merged.

## Identity contract

| Surface                     | New identity                             | Compatibility behavior                                        |
| --------------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| Product/window/desktop name | `Shepherd`                               | none needed                                                   |
| npm and Debian package      | `shepherd`                               | old packages are not overwritten                              |
| App ID                      | `dev.anirudhsj.shepherd`                 | existing state selection is handled separately                |
| Linux executable            | `shepherd`                               | packaged CLI keeps a `cmux` alias                             |
| Primary CLI                 | `shepherd`                               | `cmux` remains a deprecated launcher alias                    |
| Primary socket              | `/tmp/shepherd.sock`                     | also listen on `/tmp/cmux-linux.sock` when no override is set |
| Runtime environment         | `SHEPHERD_*`                             | read and inject legacy `CMUX_*` aliases                       |
| Diagnostics                 | `[shepherd:*]`, `SHEPHERD_*_DIAGNOSTICS` | accept legacy opt-in variables                                |
| Session override            | `SHEPHERD_SESSION_PATH`                  | fall back to `CMUX_SESSION_PATH`                              |
| Renderer setting            | `shepherd.fontSize`                      | read the legacy key if the new key is absent                  |
| Agent schema ID             | `urn:shepherd:agent-protocol:v1`         | protocol methods and version remain stable                    |
| GitHub repository           | `ANIRUDH-SJ/shepherd`                    | GitHub redirects the former URL                               |

References to the separate upstream cmux product remain `cmux`. Historical
benchmark commit IDs and result filenames remain unchanged.

## Data and integration migration

- Use `~/.config/shepherd` for new installations.
- If only the legacy user-data directory contains Shepherd-owned state, select
  it at startup rather than presenting an empty session.
- Prefer every `SHEPHERD_*` value over its `CMUX_*` counterpart. An explicitly
  supplied override disables the default dual-socket listener.
- Install new provider hooks with the `shepherd` command. Recognize and replace
  only exact legacy managed hook commands.
- Write a new Shepherd OpenCode plugin for new users. If the exact legacy
  managed plugin exists, update it in place so two plugins are not loaded.
- Never overwrite an unmanaged provider file or copy arbitrary user-data
  directories.

## Planned commit sequence

1. `docs: plan Shepherd rebrand`
2. `app: define Shepherd product identity`
3. `socket: preserve legacy control paths`
4. `cli: introduce Shepherd command`
5. `integrations: migrate managed Shepherd hooks`
6. `renderer: adopt Shepherd identity`
7. `diagnostics: publish Shepherd runtime signals`
8. `packaging: ship Shepherd application identity`
9. `benchmarks: target Shepherd runtime`
10. `docs: explain Shepherd identity migration`
11. focused review and completion updates

## Verification

- Pure tests for environment precedence, socket paths, state-path selection,
  localStorage fallback, CLI aliases, and managed integration migration.
- Existing socket, CLI, provider integration, session, reducer, and renderer
  regression tests.
- Packaged artifact inspection for executable, desktop file, AppImage, Debian
  filename, bundled `shepherd` command, and legacy `cmux` alias.
- Isolated production smoke for both socket names and both CLI names.
- A legacy-state smoke proving the renamed app restores the existing session.
- Final `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`,
  `npm run dist`, and `git diff --check`.

## Documentation definition of done

- Add a code-level walkthrough under `learning/`.
- Add a textbook chapter covering identity, compatibility, data migration,
  packaging, integration safety, alternatives, and tradeoffs.
- Update README installation and automation examples.
- Update current roadmap, feature matrix, indexes, glossary, contributor guide,
  benchmark guidance, and public repository links.
- Keep historical upstream attribution technically accurate.

## Delivery checklist

- [x] Centralize Shepherd and legacy product constants.
- [x] Preserve existing user state without copying or overwriting directories.
- [x] Prefer new environment variables and accept legacy aliases.
- [x] Serve the new socket and bounded legacy endpoint safely.
- [x] Ship `shepherd` as primary CLI and retain `cmux` compatibility.
- [x] Migrate only exact managed provider integrations.
- [x] Rename visible renderer, window, protocol, and diagnostic branding.
- [ ] Produce Shepherd AppImage and Debian artifacts.
- [x] Add focused regression and unpacked-package coverage.
- [x] Complete learning and textbook documentation.
- [x] Synchronize README, roadmap, features, indexes, and glossary.
- [ ] Pass all required verification.
- [ ] Open, code-review, and merge the dedicated PR.
- [ ] Rename the GitHub repository and update the canonical `origin`.
