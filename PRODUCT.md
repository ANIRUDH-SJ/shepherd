# What Shepherd Is

Shepherd is best described as:

> **A mission-control terminal for AI coding agents on Linux.**

At its foundation, Shepherd is a **graphical terminal multiplexer**: it runs real
shells and lets users organize them into workspaces, tabs, and split panes. But
"terminal multiplexer" does not describe the whole product. Shepherd also adds
agent discovery, semantic status, notifications, project and Git context,
worktree-based isolation, and an automation API.

The most precise product category is:

> **An AI-native terminal multiplexer and multi-agent development workspace for
> Linux.**

It is not an AI model, chatbot, or full IDE. It is the workspace around tools
like Claude Code, Codex, and other terminal-based agents.

## The Pitch

AI coding changes the developer's job. Instead of working in one terminal, a
developer may have several agents running across different projects, branches,
and tasks. Ordinary terminals can provide more panes, but they do not explain
which agent is working, finished, blocked, or waiting for human input.

**Shepherd turns those terminals into one organized command center.**

With Shepherd, developers can:

- Run real shells in tabs and split panes.
- Organize work by project and Git branch.
- See detected coding agents in one sidebar.
- Know whether an agent is working, testing, finished, or blocked.
- Jump directly to the terminal that needs attention.
- Receive notifications instead of repeatedly checking every pane.
- Create isolated Git worktree workspaces for parallel tasks.
- Control and inspect the workspace through the `shepherd` CLI and automation
  API.
- Restore the active workspace after restarting.

## The One-Line Version

> **Shepherd helps developers run and supervise multiple AI coding agents without
> losing track of what is happening where.**

## The Relatable Version

> Imagine the terminal organization of tmux, a project sidebar like an IDE, and
> a live operations dashboard for coding agents, combined into a Linux desktop
> app.

## Product Category

The broad category is:

> **AI-native developer workspace**

The more specific category is:

> **Multi-agent terminal workspace for Linux**

Calling Shepherd only a terminal emulator or multiplexer is technically valid,
but undersells it. Split panes and tabs are the foundation; the defining product
value is **agent awareness and attention management**.

## The Problem Shepherd Solves

The core problem is not merely:

> "I need more terminals."

It is:

> "I have several agents working simultaneously, and I am wasting attention
> checking which one is done, stuck, or waiting for me."

Shepherd's sidebar turns scattered terminal processes into understandable states
such as:

- Needs you
- Working
- Waiting
- Finished
- Quiet

## A 30-Second Pitch

> Shepherd is an open-source, AI-native terminal workspace for Linux. It gives
> developers one place to run multiple coding agents across projects and Git
> branches while automatically showing what each agent is doing and which one
> needs attention. It combines real terminals, tabs, split panes, worktree-based
> isolation, notifications, session restoration, and an automation API for the
> emerging workflow in which developers supervise several agents instead of
> watching one terminal.

## Tagline Options

Primary recommendation:

> **Your coding agents. One command center.**

Alternatives:

- **The terminal built for supervising AI agents.**
- **Run more agents. Lose less context.**
- **Mission control for AI development on Linux.**
- **Where your terminals become a team.**
- **One workspace for every project, branch, and agent.**

The heart of the product is simple: **Shepherd lets one developer confidently
manage many simultaneous streams of AI-assisted work.**
