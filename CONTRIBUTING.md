# Contributing

Shepherd welcomes focused bug reports and pull requests for shipped behavior.

## Development setup

On Linux with Node.js and npm available:

```bash
npm install
npm run dev
```

The native `node-pty` dependency may require the usual C/C++ build toolchain when
a compatible prebuilt binary is unavailable.

## Before opening a pull request

Create a descriptive feature branch and keep each change independently
reviewable. Add regression coverage beside the module it exercises, then run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Explain the problem, implementation, important decisions, and verification in
the PR. Include native screenshots for visible interface changes. Do not commit
generated `out/` or `release/` content, local plans, study notes, credentials, or
machine-specific state.

See [AGENTS.md](AGENTS.md) for the repository's coding conventions and complete
delivery workflow.

## Reporting security issues

Do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md)
instead.
