// Headless test for the multi-workspace app reducer. Run: `npm test:app` / tsx.
import {
  initialApp,
  appReducer,
  createWorkspaceAction,
  paneAction,
  sanitizeRestored,
  type AppState
} from './appReducer'
import { splitAction } from './workspaceReducer'
import { findPane, listSurfaceIds } from '../layout/tree'
import type { AgentReport } from '../../../shared/agent'
import { MAX_WORKSPACE_NAME_LENGTH } from '../../../shared/workspace'
import type { UsageReport } from '../../../shared/usage'

let failures = 0
function assert(cond: boolean, msg: string): void {
  if (cond) console.log('  ok:', msg)
  else {
    console.error('FAIL:', msg)
    failures++
  }
}
const active = (s: AppState) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)!

// initial
let s = initialApp()
assert(s.workspaces.length === 1, 'starts with 1 workspace')
assert(active(s).name === '', 'first workspace has no custom name (shown positionally)')
assert(active(s).usage.totals.reportCount === 0, 'new workspace starts without usage')
const firstWs = s.activeWorkspaceId

// create a second workspace → becomes active
s = appReducer(s, createWorkspaceAction('agent-2'))
assert(s.workspaces.length === 2, 'two workspaces after create')
assert(active(s).name === 'agent-2', 'new workspace becomes active')
const secondWs = s.activeWorkspaceId

// workspace names are normalized without disturbing workspace-owned state
const secondBeforeRename = active(s)
s = appReducer(s, { type: 'renameWorkspace', id: secondWs, name: '  build agent  ' })
assert(active(s).name === 'build agent', 'rename trims surrounding whitespace')
assert(active(s).root === secondBeforeRename.root, 'rename preserves the workspace layout')
assert(active(s).activePaneId === secondBeforeRename.activePaneId, 'rename preserves active pane')
s = appReducer(s, {
  type: 'renameWorkspace',
  id: secondWs,
  name: 'x'.repeat(MAX_WORKSPACE_NAME_LENGTH + 20)
})
assert(active(s).name.length === MAX_WORKSPACE_NAME_LENGTH, 'rename caps names at 64 characters')
s = appReducer(s, { type: 'renameWorkspace', id: secondWs, name: '   ' })
assert(active(s).name === '', 'empty rename restores the positional fallback')

const normalizedCreate = createWorkspaceAction('  named workspace  ')
assert(
  normalizedCreate.type === 'createWorkspace' &&
    normalizedCreate.workspace.name === 'named workspace',
  'workspace creation uses the same normalization rule'
)

const exactUsage: UsageReport = {
  inputTokens: 1000,
  outputTokens: 250,
  cachedTokens: 600,
  costUsd: 0.04,
  provider: 'provider-a',
  model: 'model-a',
  accuracy: 'exact',
  timestamp: 1
}
const estimatedUsage: UsageReport = {
  inputTokens: 400,
  outputTokens: 100,
  cachedTokens: 0,
  accuracy: 'estimated',
  timestamp: 2
}
s = appReducer(s, { type: 'reportUsage', id: secondWs, report: exactUsage })
s = appReducer(s, { type: 'reportUsage', id: secondWs, report: estimatedUsage })
assert(active(s).usage.totals.inputTokens === 1400, 'usage reports accumulate per workspace')
assert(active(s).usage.totals.outputTokens === 350, 'output usage accumulates')
assert(active(s).usage.totals.cachedTokens === 600, 'cached usage accumulates')
assert(active(s).usage.totals.costUsd === 0.04, 'known cost accumulates')
assert(active(s).usage.totals.hasEstimated, 'cumulative usage remembers estimates')
assert(active(s).usage.latest?.timestamp === 2, 'latest usage report is retained')

// attention on the FIRST (inactive) workspace
s = appReducer(s, { type: 'setAttention', id: firstWs, unread: true, attention: true })
assert(s.workspaces.find((w) => w.id === firstWs)!.attention, 'first workspace flagged attention')

// selecting it clears attention
s = appReducer(s, { type: 'selectWorkspace', id: firstWs })
assert(s.activeWorkspaceId === firstWs, 'selected first workspace')
assert(!active(s).attention && !active(s).unread, 'selecting clears unread + attention')

// pane action (split) targets ONLY the active workspace's tree
const firstPaneId = active(s).activePaneId
s = appReducer(s, paneAction(firstWs, splitAction(firstPaneId, 'row')))
assert(listSurfaceIds(active(s).root).length === 2, 'active workspace now has 2 terminals')
assert(
  listSurfaceIds(s.workspaces.find((w) => w.id === secondWs)!.root).length === 1,
  'other workspace untouched'
)

// setStatus
s = appReducer(s, { type: 'setStatus', id: firstWs, status: 'Claude is waiting for your input' })
assert(active(s).status === 'Claude is waiting for your input', 'status subtitle set')

// close a workspace
s = appReducer(s, { type: 'closeWorkspace', id: secondWs })
assert(s.workspaces.length === 1, 'one workspace after close')
// cannot close the last one
const only = s.activeWorkspaceId
s = appReducer(s, { type: 'closeWorkspace', id: only })
assert(s.workspaces.length === 1, 'the last workspace cannot be closed')

// workspaces are numbered by POSITION in the sidebar (index+1), so closing one
// shifts the rest down. The reducer keeps the list ordered; the number is derived
// in the UI. Verify close removes + preserves order:
let n = initialApp()
n = appReducer(n, createWorkspaceAction()) // position 2
const midId = n.activeWorkspaceId
n = appReducer(n, createWorkspaceAction()) // position 3
assert(n.workspaces.length === 3, 'three workspaces')
n = appReducer(n, { type: 'closeWorkspace', id: midId }) // close the middle one
assert(n.workspaces.length === 2, 'two workspaces after closing the middle')
assert(
  n.workspaces.every((w) => w.id !== midId),
  'closed workspace is gone; the third now sits at position 2 (renumbered in UI)'
)

// agent lifecycle: reports bind to a real surface, reject stale updates, focus the
// exact terminal, expire, and disappear with their pane/workspace.
let agentsState = initialApp()
const agentWorkspace = agentsState.workspaces[0]
const agentSurfaceId = listSurfaceIds(agentWorkspace.root)[0]
agentsState = appReducer(agentsState, createWorkspaceAction('other'))
const otherWorkspaceId = agentsState.activeWorkspaceId
const blockedReport: AgentReport = {
  agentId: 'codex:term-1',
  provider: 'codex',
  displayName: 'Codex',
  workspaceId: agentWorkspace.id,
  surfaceId: agentSurfaceId,
  state: 'blocked',
  blockReason: 'approval',
  message: 'Approve command',
  source: 'codex:hooks',
  revision: 2,
  updatedAt: 20
}
agentsState = appReducer(agentsState, { type: 'reportAgent', report: blockedReport })
assert(agentsState.agents.length === 1, 'agent report creates a record')
assert(agentsState.agents[0].paneId === agentWorkspace.activePaneId, 'agent binds to owning pane')
assert(
  agentsState.workspaces.find((w) => w.id === agentWorkspace.id)!.agentAttention,
  'actionable block marks an inactive workspace'
)
assert(
  agentsState.workspaces.find((w) => w.id === agentWorkspace.id)!.agentUnread,
  'blocked agent is unread in an inactive workspace'
)

agentsState = appReducer(agentsState, {
  type: 'reportAgent',
  report: { ...blockedReport, state: 'done', revision: 1, updatedAt: 30 }
})
assert(agentsState.agents[0].state === 'blocked', 'stale sequenced report is ignored')

agentsState = appReducer(agentsState, { type: 'focusAgent', id: blockedReport.agentId })
const focusedAgentWorkspace = agentsState.workspaces.find((w) => w.id === agentWorkspace.id)!
assert(agentsState.activeWorkspaceId === agentWorkspace.id, 'focusAgent selects the workspace')
assert(
  focusedAgentWorkspace.activePaneId === agentsState.agents[0].paneId,
  'focusAgent selects pane'
)
assert(
  findPane(focusedAgentWorkspace.root, focusedAgentWorkspace.activePaneId)!.activeSurfaceId ===
    agentSurfaceId,
  'focusAgent selects terminal surface'
)
assert(
  !focusedAgentWorkspace.agentUnread && !focusedAgentWorkspace.agentAttention,
  'focusing an agent acknowledges its workspace markers'
)

agentsState = appReducer(agentsState, {
  type: 'reportAgent',
  report: {
    ...blockedReport,
    state: 'working',
    blockReason: undefined,
    revision: 3,
    updatedAt: 40,
    expiresAt: 50
  }
})
agentsState = appReducer(agentsState, { type: 'expireAgents', now: 49 })
assert(agentsState.agents.length === 1, 'agent remains before expiry')
agentsState = appReducer(agentsState, { type: 'expireAgents', now: 50 })
assert(agentsState.agents.length === 0, 'agent is removed at expiry')

agentsState = appReducer(agentsState, {
  type: 'reportAgent',
  report: {
    ...blockedReport,
    revision: 4,
    updatedAt: 50,
    staleAt: 60,
    expiresAt: 100
  }
})
agentsState = appReducer(agentsState, { type: 'expireAgents', now: 59 })
assert(agentsState.agents[0].state === 'blocked', 'agent remains authoritative before stale time')
agentsState = appReducer(agentsState, { type: 'expireAgents', now: 60 })
assert(agentsState.agents[0].state === 'unknown', 'stale agent transitions to unknown')
assert(agentsState.agents[0].revision === 4, 'stale transition preserves producer sequence')
assert(agentsState.agents[0].blockReason === undefined, 'stale state drops obsolete block reason')
assert(
  !agentsState.workspaces.find((w) => w.id === agentWorkspace.id)!.agentAttention,
  'stale blocked state no longer requests attention'
)
agentsState = appReducer(agentsState, { type: 'expireAgents', now: 100 })
assert(agentsState.agents.length === 0, 'stale agent is removed at expiry')

agentsState = appReducer(
  agentsState,
  paneAction(agentWorkspace.id, splitAction(focusedAgentWorkspace.activePaneId, 'row'))
)
const splitWorkspace = agentsState.workspaces.find((w) => w.id === agentWorkspace.id)!
const splitPane = findPane(splitWorkspace.root, splitWorkspace.activePaneId)!
const splitAgent: AgentReport = {
  ...blockedReport,
  agentId: 'claude:split',
  provider: 'claude',
  displayName: 'Claude Code',
  surfaceId: splitPane.activeSurfaceId,
  state: 'working',
  blockReason: undefined,
  revision: undefined,
  updatedAt: 60,
  source: 'claude:hooks'
}
agentsState = appReducer(agentsState, { type: 'reportAgent', report: splitAgent })
assert(agentsState.agents.length === 1, 'agent can bind to a split pane')
agentsState = appReducer(
  agentsState,
  paneAction(agentWorkspace.id, { type: 'closePane', paneId: splitPane.id })
)
assert(agentsState.agents.length === 0, 'closing a pane removes its agents')

const otherWorkspace = agentsState.workspaces.find((w) => w.id === otherWorkspaceId)!
const otherSurfaceId = listSurfaceIds(otherWorkspace.root)[0]
agentsState = appReducer(agentsState, {
  type: 'reportAgent',
  report: {
    ...blockedReport,
    agentId: 'opencode:other',
    provider: 'opencode',
    displayName: 'OpenCode',
    workspaceId: otherWorkspaceId,
    surfaceId: otherSurfaceId,
    state: 'idle',
    blockReason: undefined,
    revision: undefined,
    updatedAt: 70,
    source: 'opencode:hooks'
  }
})
agentsState = appReducer(agentsState, { type: 'closeWorkspace', id: otherWorkspaceId })
assert(agentsState.agents.length === 0, 'closing a workspace removes its agents')

let exitedSurfaceState = initialApp()
const exitedWorkspace = exitedSurfaceState.workspaces[0]
const exitedSurfaceId = listSurfaceIds(exitedWorkspace.root)[0]
for (const [agentId, provider] of [
  ['codex:exited', 'codex'],
  ['claude:exited', 'claude']
] as const) {
  exitedSurfaceState = appReducer(exitedSurfaceState, {
    type: 'reportAgent',
    report: {
      ...blockedReport,
      agentId,
      provider,
      displayName: provider,
      workspaceId: exitedWorkspace.id,
      surfaceId: exitedSurfaceId,
      source: `${provider}:hooks`
    }
  })
}
assert(exitedSurfaceState.agents.length === 2, 'multiple agents can bind to one live surface')
exitedSurfaceState = appReducer(exitedSurfaceState, {
  type: 'clearAgentsForSurface',
  surfaceId: exitedSurfaceId
})
assert(exitedSurfaceState.agents.length === 0, 'terminal exit clears every surface agent')
assert(
  !exitedSurfaceState.workspaces[0].agentAttention,
  'terminal exit recalculates workspace attention'
)

// session restore: sanitizeRestored validates a snapshot and resets transients
const snapshot = initialApp()
snapshot.workspaces[0].unread = true // a transient that must NOT survive a restore
const restored = sanitizeRestored(JSON.parse(JSON.stringify(snapshot)))
assert(restored !== null, 'sanitizeRestored accepts a valid snapshot')
assert(restored!.workspaces.length === 1, 'restored workspace count matches')
assert(restored!.workspaces[0].unread === false, 'transient flags are reset on restore')
assert(restored!.workspaces[0].usage.totals.reportCount === 0, 'usage is reset on restore')
assert(restored!.workspaces[0].usage.latest === null, 'latest usage is reset on restore')
assert(restored!.agents.length === 0, 'agent lifecycle state is reset on restore')
assert(sanitizeRestored(null) === null, 'sanitizeRestored(null) → null')
assert(sanitizeRestored({}) === null, 'sanitizeRestored({}) → null (no workspaces)')
assert(sanitizeRestored({ workspaces: [] }) === null, 'empty workspaces → null')
assert(
  sanitizeRestored({ workspaces: [{ id: 'x' }] }) === null,
  'workspace without a valid root → null'
)

// malformed layouts must fail CLOSED (null), not crash later (Copilot review, PR #4)
assert(
  sanitizeRestored({ workspaces: [{ id: 'w', root: { type: 'split' } }] }) === null,
  'split root with no children → null'
)
assert(
  sanitizeRestored({
    workspaces: [{ id: 'w', root: { type: 'split', direction: 'row', sizes: [], children: [] } }]
  }) === null,
  'split root with empty children → null'
)
assert(
  sanitizeRestored({
    workspaces: [
      { id: 'w', root: { type: 'pane', pane: { id: 'p', surfaces: [], activeSurfaceId: 's' } } }
    ]
  }) === null,
  'pane with no surfaces → null'
)

console.log(failures === 0 ? '\n✅ ALL APP-REDUCER TESTS PASS' : `\n❌ ${failures} FAILURE(S)`)
if (failures > 0) throw new Error(`${failures} app-reducer test(s) failed`)
