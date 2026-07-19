# M14 — Sidebar information hierarchy

## The goal

The sidebar contained the right data, but its reading order did not match how a
developer scans a multi-agent session. Generic labels such as `workspace 1`
outranked the live project, agent urgency existed only in sort order, and action
buttons mixed unrelated text glyphs.

M14 makes the existing information easier to find without changing its source,
storage, or protocol.

## What changed

| File                                        | Responsibility                         |
| ------------------------------------------- | -------------------------------------- |
| `src/renderer/src/sidebarView.ts`           | Derive workspace display identity      |
| `src/renderer/src/agentView.ts`             | Build ordered semantic agent groups    |
| `src/renderer/src/components/Sidebar.tsx`   | Render workspace hierarchy and actions |
| `src/renderer/src/components/AgentList.tsx` | Render empty and grouped agent states  |
| `src/renderer/src/components/Icon.tsx`      | Supply dependency-free SVG icons       |
| `src/renderer/src/App.css`                  | Define the compact sidebar layout      |

## 1. Workspace identity

`workspaceIdentity()` returns three explicit fields: `primary`, `context`, and
`positional`. A user-provided name remains primary and the project becomes its
context. Without a custom name, the live project becomes primary and the
positional label becomes context.

This rule is pure and has no React dependency. `sidebarView.test.ts` covers both
branches, so future UI edits cannot quietly restore a generic label as the most
prominent information.

`Sidebar.tsx` uses the same result for visible labels, rename text, titles, and
accessible workspace descriptions. Each row then follows one order:

1. custom name or project fallback;
2. project or positional context, plus token usage;
3. Git branch or explicit non-Git state;
4. workspace status and agent rollup when present.

The selection target and its rename/close actions are siblings. During inline
rename the selection target drops its button role, so neither the action buttons
nor the text input are nested inside another interactive control. This preserves
F2, Enter, Space, pointer selection, and focus restoration with a valid
accessibility tree.

## 2. Agent urgency groups

`groupAgentsForSidebar()` converts the flat agent array into non-empty groups:

- **Needs you** for blocked records where `agentNeedsAttention()` is true;
- **Working** for active work;
- **Waiting** for non-actionable external blocks;
- **Finished** for done records; and
- **Quiet** for idle or unknown records.

The helper first applies the existing deterministic urgency/recency sort, then
filters records into named bands. This preserves stable row ordering while
making the reason for that order visible. Its regression specifically proves
that approval blocks and external waits do not share the same heading.

## 3. React rendering

`AgentList` always renders its section and numeric count. With no records it
shows a compact “No agents yet” explanation. With records, each group is a
labelled section containing its own semantic list. Existing row buttons still
dispatch `focusAgent` and then focus the exact terminal surface.

The workspace map used by agent rows now shares `workspaceIdentity()`, so an
unnamed workspace is described by its useful project rather than a generic
number.

## 4. Local SVG icons and CSS

`Icon.tsx` exposes a closed `IconName` union and six inline SVG drawings. Icons
inherit `currentColor`, remain decorative with `aria-hidden`, and rely on their
parent buttons for accessible names. No package, network asset, HTML injection,
or user-controlled SVG is involved.

CSS tones down the active-workspace fill, adds a narrow accent edge, gives action
icons consistent hit areas, and constrains grouped agents to a scrollable region.
Text truncates in the row while full project, path, branch, agent, and state
details remain available through titles or accessible labels.

## Verification

Helper regressions cover workspace identity and every agent band. The existing
theme boundary test confirms the new CSS consumes semantic tokens without adding
raw component colors. Visual smoke tests covered one fresh workspace, the empty
Agents state, and five synthetic agents spanning every group at 1100×720.

No reducer, IPC, socket, process discovery, session persistence, or PTY behavior
changed.

## Checkpoint

1. Why is a live project a better fallback than `workspace 1`?
2. Why does an external block belong outside “Needs you”?
3. Which accessibility responsibility belongs to the icon and which to its button?
