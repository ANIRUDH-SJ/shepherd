# Security Policy

## Supported releases

Shepherd is early software. Security fixes are applied to the latest release and
the default branch; older builds are not maintained as separate support lines.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository when it is
available. If that channel is unavailable, contact the repository owner through
the private contact method shown on the owner's GitHub profile. Do not include
credentials, private repository content, terminal history, or other sensitive
user data in a public issue.

Include the affected version, Linux distribution, reproduction steps, impact,
and whether the issue crosses the renderer, preload, main-process, socket, PTY,
link, or preview boundary. A minimal proof of concept is helpful; destructive
payloads are not.

## Scope

Security-sensitive areas include IPC validation, the Unix socket, terminal
ownership, agent report authority, local-file and web links, Git/worktree
operations, process inspection, session persistence, and the loopback-only
preview sandbox.
