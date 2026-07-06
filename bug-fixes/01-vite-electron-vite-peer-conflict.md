# Bug 01 — vite 8 vs electron-vite peer conflict

**Milestone:** M0 (scaffold) · **Found by:** `npm install` failing · **Status:** Fixed

## Symptom

Installing the dev toolchain blew up with an `ERESOLVE` error:

```
npm error code ERESOLVE
npm error Found: vite@8.1.3
npm error   peer vite@"^8.0.0" from @vitejs/plugin-react@6.0.3
npm error Conflicting peer dependency: vite@7.3.6
npm error   peer vite@"^5.0.0 || ^6.0.0 || ^7.0.0" from electron-vite@5.0.0
```

## How we debugged it

The error itself named the conflict, but not the *fix*. Rather than guess versions,
we **asked the registry** what was actually compatible:

```bash
npm view electron-vite peerDependencies
#   → { vite: '^5.0.0 || ^6.0.0 || ^7.0.0' }         # electron-vite maxes at vite 7
npm view @vitejs/plugin-react@5 peerDependencies
#   → { vite: '^4.2.0 || ^5.0.0 || ^6.0.0 || ^7.0.0' } # plugin-react 5 supports vite 7
npm view @vitejs/plugin-react dist-tags
#   → { latest: '6.0.3' }                              # ...but npm auto-picked 6 (wants vite 8)
```

That triangulated a version set everyone agrees on.

## Root cause

`npm install <pkg>` with no version pulls the **latest**. The latest vite is `8`, and
the latest `@vitejs/plugin-react` (`6`) *requires* vite 8 — but `electron-vite@5`
only supports vite ≤ 7. So npm couldn't satisfy everyone: vite-8-wanting plugin-react
vs. vite-≤7-wanting electron-vite. A brand-new major (vite 8) had simply outrun
electron-vite's support window.

## The fix

Pin the packages to a mutually compatible set:

```bash
npm install -D electron electron-vite "vite@^7" "@vitejs/plugin-react@^5" …
```

- `vite@7` — the highest electron-vite 5 supports
- `@vitejs/plugin-react@5` — supports vite 7 (the auto-picked `@6` needs vite 8)

## How we prevent it now

- `package.json` pins `vite ^7` and `@vitejs/plugin-react ^5`.
- **Rule:** before bumping a build-tool major (esp. vite), check the *orchestrator's*
  supported range first (`npm view electron-vite peerDependencies`). The tool that
  wraps others (electron-vite) is the ceiling, not the newest leaf package.

## Lesson

When `ERESOLVE` hits, don't randomly try versions — `npm view … peerDependencies`
turns a guessing game into a lookup.
