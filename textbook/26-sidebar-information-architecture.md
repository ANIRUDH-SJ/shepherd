# 26 — Information architecture for a dense operational sidebar

A terminal sidebar is not merely a list. It is an operational dashboard: users
must locate a project, notice work that needs intervention, understand background
activity, and jump to the right terminal without losing focus. Information
architecture decides which facts appear first, which are grouped together, and
which stay available only on demand.

## 1. Start from user questions

A useful hierarchy answers questions in the order they occur:

1. **Where am I?** — custom workspace name or live project.
2. **Which instance is this?** — project context or workspace position.
3. **Which code state?** — Git branch or an explicit non-Git label.
4. **What is happening?** — usage, workspace status, and agent rollup.
5. **What needs me first?** — actionable agents before background states.

This order is more durable than arranging fields by when they were implemented.
Backend ownership should not dictate visual priority.

## 2. Dual workspace identity

A workspace has several identities: a custom name, project name, path, stable
identifier, and list position. No single value works everywhere.

cmux-linux applies a small presentation function:

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

## 3. Priority is not the same as state

An agent's lifecycle state does not fully describe urgency. Two records can both
be `blocked` while requiring different responses:

- an approval or user-input block needs the user;
- an external wait may need no intervention.

The UI therefore derives a presentation group from validated semantic state:

```text
Needs you -> Working -> Waiting -> Finished -> Quiet
```

This is a view projection, not a new lifecycle state machine. The provider-neutral
record remains unchanged, socket clients see the same contract, and one shared
`agentNeedsAttention()` rule continues to decide whether a block is actionable.

Named groups improve more than appearance. They expose the sort rule, create
screen-reader landmarks, and make counts meaningful. Within each group,
deterministic recency and identity tie-breakers keep rows from jumping randomly.

## 4. Empty state as structural confirmation

Hiding a zero-count section makes users ask whether the feature is disabled,
still loading, or unsupported. A compact persistent empty state confirms three
facts: agent discovery exists, no agents are currently present, and launching an
agent in a terminal is the next action.

Empty states should not dominate the product. One icon, a direct label, and one
short instruction are enough. The same section and count remain in place when
records arrive, minimizing layout surprise.

## 5. Progressive disclosure in narrow space

A sidebar cannot show every identifier at full length. cmux-linux uses layers:

- the most useful value is visible and ellipsized;
- secondary context sits on the next line;
- full project/path and branch values remain in native titles;
- agent buttons carry complete accessible labels;
- details that change urgency stay visible rather than tooltip-only.

Truncation must be applied to the correct flex child. A parent needs
`min-width: 0`, while the text child needs overflow, ellipsis, and no wrapping.
Without that combination, a long branch can force the sidebar wider or push
action buttons out of reach.

## 6. Inline SVG icon boundary

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

## 7. Layout and scrolling strategy

Three regions compete vertically: workspaces, agents, and shortcuts. The
workspace list grows flexibly, the Agents region has a bounded share and its own
scroll container, and shortcuts stay pinned at the bottom. This preserves the
highest-frequency navigation while allowing many agent groups.

Independent scrolling is a tradeoff: users may not see quiet agents without
scrolling, but actionable groups remain first and the global count reveals that
more records exist. Expanding every group would push workspace navigation and
shortcuts off screen.

## 8. Accessibility and interaction

Color reinforces but does not define state. Group headings and row status text
carry the same meaning as dots and semantic colors. Icon-only buttons have
explicit accessible labels and tooltips. Agent rows remain real buttons because
they perform an action: selecting the owning workspace, pane, surface, and then
moving focus to the terminal.

Keyboard focus must remain visible independently of hover. Reduced-motion rules
continue to disable repeating attention animation without removing labels,
counts, borders, or state colors.

Composite rows require careful DOM structure. A row-level selection target must
not contain its rename and close buttons, and edit mode must not place an input
inside a button-like element. cmux-linux renders selection and actions as
siblings, then temporarily removes the selection role while its rename input is
active.

## 9. Testing the architecture

Presentation logic is best tested below the pixel layer:

- custom and fallback identity branches;
- actionable versus external block classification;
- complete group order;
- deterministic ordering inside groups;
- token-boundary and reduced-motion invariants.

Visual smoke testing then answers the questions pure tests cannot: Does the
hierarchy scan correctly? Do icons align? Do long values truncate? Can all groups
be reached at the default window size? Empty and populated states are both
required because their layout pressures differ.

## 10. Alternatives and tradeoffs

A card per workspace would create stronger separation but too much visual weight
beside terminal content. Collapsible agent groups save space but add state and can
hide urgent transitions. A full component library offers polished primitives but
adds bundle weight and styling constraints for six small icons. Sorting without
headings is compact but keeps the priority rule invisible.

The chosen design favors a shallow DOM, native controls, pure projections, and
semantic tokens. Its main cost is more explicit markup and CSS. That cost is
localized to the renderer and buys reviewable behavior without changing runtime
contracts.

## 11. Extension points

The structure can later support agent-group collapse preferences, a direct
“focus next Needs you” command, workspace PR/port metadata, or denser sidebar
modes. Those additions should extend the existing identity and urgency
projections instead of adding parallel fallback or priority rules.

## Checkpoint

1. Why should visual identity differ from persistent identity?
2. Why is an actionable classifier safer than treating every block as urgent?
3. Which details must remain visible instead of moving into a tooltip?
4. Why are group headings useful even when the rows are already sorted?
5. What security boundary does a closed icon union create?
