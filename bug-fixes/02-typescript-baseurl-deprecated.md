# Bug 02 — TypeScript `baseUrl` deprecated

**Milestone:** M0 (scaffold) · **Found by:** `npm run build` failing · **Status:** Fixed

## Symptom

The first `npm run build` failed in `typecheck:web`:

```
tsconfig.web.json(23,5): error TS5101: Option 'baseUrl' is deprecated and will stop
functioning in TypeScript 7.0. Specify compilerOption '"ignoreDeprecations": "6.0"'
to silence this error.
```

Then, after a first attempt at the fix, a *second* error appeared:

```
tsconfig.web.json(24,23): error TS5090: Non-relative paths are not allowed when
'baseUrl' is not set. Did you forget a leading './'?
```

## How we debugged it

Straightforward — the compiler told us exactly what it disliked, in two steps:

1. It flagged `baseUrl` as deprecated (the installed TypeScript is `6.x`, which
   deprecates it ahead of removal in 7.0).
2. We'd only used `baseUrl: "."` to anchor a path alias:
   ```jsonc
   "baseUrl": ".",
   "paths": { "@renderer/*": ["src/renderer/src/*"] }
   ```
   So we removed `baseUrl` — which surfaced error #2: without `baseUrl`, TS requires
   path *targets* to be **relative**.

## Root cause

Modern TypeScript (5.0+) lets `paths` work **without** `baseUrl` (resolving relative
to the tsconfig's own directory), and `baseUrl` is now deprecated. But when you drop
`baseUrl`, the path targets must start with `./`.

## The fix

Remove `baseUrl`, and make the alias target relative:

```jsonc
// tsconfig.web.json
"paths": { "@renderer/*": ["./src/renderer/src/*"] }   // ← leading ./
```

## How we prevent it now

- No `baseUrl` anywhere; `paths` targets are relative (`./…`).
- The actual bundler alias still lives in `electron.vite.config.ts` (`@renderer`);
  the tsconfig `paths` only teach the *type-checker* the same mapping.

## Lesson

`baseUrl` is on the way out. Use relative `paths` targets and skip `baseUrl` entirely
in new projects.
