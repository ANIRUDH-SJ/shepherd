# 26 — Information architecture for a dense operational sidebar

A terminal sidebar is not merely a list. It is an operational dashboard: users
must locate a project, notice work that needs intervention, understand background
activity, and jump to the right terminal without losing focus. Information
architecture decides which facts appear first, which are grouped together, and
which stay available only on demand.

## 1. Start from user questions

A useful hierarchy answers questions in the order they occur:

1. **Where am I?** — custom workspace name or live project.
2. **Which code state?** — Git branch, when one exists.
3. **What is happening here?** — status, usage, and agents owned by this workspace.
4. **What needs me first?** — actionable agents before background states.

This order is more durable than arranging fields by when they were implemented.
Backend ownership should not dictate visual priority.

## 2. Dual workspace identity

A workspace has several identities: a custom name, project name, path, stable
identifier, and list position. No single value works everywhere.

Shepherd applies a small presentation function:

```text
custom name exists  -> primary: custom name, context: project
no custom name      -> primary: project,     context: Workspace N
```

The persistent id remains the state key and socket target. The path remains in a
tooltip because it is precise but too long for constant display. Position is
useful for disambiguation, but it changes when workspaces close and therefore
should not outrank the project.

Keeping this rule in a pure helper avoids three common bugs: different names in
workspace and agent rows, accessibility labels that disagree with visible text,
and duplicated fallback logic drifting between components.

Secondary text must still earn its space. A custom workspace called `API` rooted
at the user's home directory does not benefit from a second line that merely says
`Home`. Shepherd's pure project-context projection suppresses that generic label
but retains useful repository names. Likewise, a missing Git branch is absence of
data, not a fact that needs a permanent `No Git repository` sentence.

## 3. Put operational state under its owner

The stable relationship in the data model is not “agent belongs to an Agents
panel.” It is `AgentRecord.workspaceId`: an agent belongs to a workspace and an
exact terminal surface. The presentation should preserve that ownership.

Shepherd groups records once before rendering:

```text
all AgentRecord values
  → Map<workspaceId, AgentRecord[]>
  → urgency sort within each workspace
  → contextual buttons below that workspace
```

This has two useful consequences. First, a user does not have to match a global
agent row back to a separate workspace card. Second, the same agent is not stated
twice in permanent UI. A workspace with no agent remains one line; a workspace
with live work expands only by the number of relevant records.

For repeated lookups, a map is also cheaper and clearer than filtering the entire
agent array for every workspace. It is a derived view projection, so it does not
need another reducer field or effect.

## 4. Priority is not the same as state

An agent's lifecycle state does not fully describe urgency. Two records can both
be `blocked` while requiring different responses:

- an approval or user-input block needs the user;
- an external wait may need no intervention.

The UI therefore derives presentation priority from validated semantic state:

```text
Needs you -> Working -> Waiting -> Finished -> Quiet
```

This is a view projection, not a new lifecycle state machine. The provider-neutral
record remains unchanged, socket clients see the same contract, and the shared
attention classifier continues to decide whether a block is actionable. The
contextual list uses the priority to sort records rather than rendering permanent
group headings. Visible state text and semantic dots keep the meaning explicit.

Within one workspace, deterministic recency and identity tie-breakers prevent rows
from jumping randomly. Across workspaces, the user's workspace order remains the
primary navigation model.

## 5. Absence should usually look like absence

Persistent empty states are valuable when a panel is a destination and users must
learn how to populate it. They are harmful when they become permanent furniture
beside a higher-value surface. A terminal workspace should not reserve a quarter
of its navigation for `AGENTS 0` and a dashed instructional card on every launch.

Shepherd therefore uses conditional presence:

- no agents: no agent block;
- no branch: no branch label;
- no usage report: no usage number;
- no socket status: no status subtitle;
- no useful secondary project: no project-context line.

This is not the same as hiding a failure. Agent discovery errors and disconnected
runtime state need explicit error handling elsewhere. Ordinary absence is simply
the common state and should keep the hierarchy quiet.

## 6. Progressive disclosure in narrow space

A sidebar cannot show every identifier at full length. Shepherd uses layers:

- the most useful value is visible and ellipsized;
- useful secondary context shares a compact metadata line;
- full project/path and branch values remain in native titles;
- agent buttons carry complete accessible labels;
- details that change urgency stay visible rather than tooltip-only.

Truncation must be applied to the correct flex child. A parent needs
`min-width: 0`, while the text child needs overflow, ellipsis, and no wrapping.
Without that combination, a long branch can force the sidebar wider or push
action buttons out of reach.

Container queries can remove the least valuable secondary field at narrow widths
without changing the data model. Actions must remain inside the sidebar, and names
must truncate rather than create horizontal scrolling.

## 7. Inline SVG icon boundary

Text glyphs such as `+`, `×`, and a pencil vary by font, platform, and baseline.
A small inline SVG system gives controls consistent stroke weight and dimensions
without an icon-library dependency.

The safe boundary is deliberately closed:

- icon names are a TypeScript union;
- path data is static source code;
- SVG inherits `currentColor` from semantic CSS;
- decorative SVG is hidden from assistive technology;
- the enclosing button owns the title and accessible name.

Do not accept arbitrary SVG markup from workspace names, terminal output, or
configuration. Apart from injection risk, untrusted shapes could obscure nearby
controls or imitate state indicators.

## 8. Flat layout and scrolling strategy

One workspace list owns the available vertical space. Contextual agent buttons
participate in the same scroll flow as their owning row. There is no second Agents
scroll container and no shortcut legend pinned below it.

This removes nested scrolling and makes capacity proportional to real activity.
The cost is that many simultaneous agents can make one workspace tall. That is a
more honest pressure than reserving fixed space when there are zero agents, and a
future bounded overflow affordance can be added if real workloads require it.

Flat does not mean interaction-free. A small hover background, an inset active
edge, and visible focus outline communicate state without turning every ordinary
row into a bordered card.

## 9. Accessibility and interaction

Color reinforces but does not define state. Compact agent text names the provider
and lifecycle state while a dot reinforces it. Icon-only buttons have explicit
accessible labels and tooltips. Contextual agent rows remain real buttons because
they perform an action: selecting the owning workspace, pane, surface, and then
moving focus to the terminal.

The visible label can stay short while the accessible label includes the verb,
workspace, and optional detail. That avoids forcing explanatory copy into the
visual layout without making the action ambiguous to a screen-reader user.

Keyboard focus must remain visible independently of hover. Reduced-motion rules
continue to disable repeating attention animation without removing labels,
counts, borders, or state colors.

Composite rows require careful DOM structure. A row-level selection target must
not contain its rename and close buttons, and edit mode must not place an input
inside a button-like element. Shepherd renders selection and actions as
siblings, then temporarily removes the selection role while its rename input is
active.

## 10. State, failure, and security boundaries

The simplification does not move authority into CSS or the component. Main still
discovers processes and metadata. Shared contracts still validate semantic agent
reports. The reducer still owns workspace, pane, surface, attention, and expiry
state. The sidebar only groups and projects already-owned data.

Clicking an agent dispatches its stable id rather than trusting visible provider
text. The reducer resolves that id to the owning workspace/pane/surface, and the
renderer then requests terminal focus. Duplicate display names therefore cannot
redirect navigation.

Stale or expired records disappear through the existing lifecycle policy. A
malformed report is rejected before rendering. Long messages remain in bounded
validated fields and titles; they are rendered as text, never markup. Removing a
global component changes none of those trust boundaries.

## 11. Testing the architecture

Presentation logic is best tested below the pixel layer:

- custom and fallback identity branches;
- useful versus generic secondary project context;
- actionable versus external block classification;
- contextual visible and accessible labels;
- deterministic ordering inside each workspace;
- exact agent-to-workspace/pane/surface reducer navigation;
- token-boundary and reduced-motion invariants.

Visual smoke testing then answers the questions pure tests cannot: Does the
hierarchy scan correctly? Do icons align? Do long values truncate? Do row actions
stay inside a 190-pixel sidebar? Empty and populated states are both required
because their layout pressures differ. A real click should also prove that a
contextual status button reaches the owning terminal.

## 12. Alternatives and tradeoffs

A card per workspace would create stronger separation but too much visual weight
beside terminal content. A global urgency dashboard makes cross-workspace triage
obvious but duplicates ownership and consumes space when empty. Collapsible agent
groups save space but add state and can hide urgent transitions. A full component
library offers polished primitives but adds bundle weight and styling constraints
for a small native-control surface.

The chosen design favors a shallow DOM, native controls, pure projections, and
semantic tokens. Its main cost is more explicit markup and CSS. That cost is
localized to the renderer and buys reviewable behavior without changing runtime
contracts.

## 13. Extension points

The structure can later support a direct “focus next Needs you” command, bounded
agent overflow, workspace PR/port metadata, or denser sidebar modes. A command
palette or notification center can provide cross-workspace triage without
reintroducing a permanent dashboard. Those additions should extend existing
identity, ownership, and urgency projections instead of adding parallel rules.

## Checkpoint

1. Why should visual identity differ from persistent identity?
2. Why is an actionable classifier safer than treating every block as urgent?
3. Which details must remain visible instead of moving into a tooltip?
4. Why does contextual grouping preserve ownership better than a global list?
5. When is an empty state useful, and why is it omitted here?
6. What security boundary does a closed icon union create?
