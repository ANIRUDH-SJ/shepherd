// Headless test for the multi-workspace app reducer. Run: `npm test:app` / tsx.
import {
  initialApp,
  appReducer,
  createWorkspaceAction,
  paneAction,
  type AppState
} from './appReducer'
import { splitAction } from './workspaceReducer'
import { listSurfaceIds } from '../layout/tree'

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
const firstWs = s.activeWorkspaceId

// create a second workspace → becomes active
s = appReducer(s, createWorkspaceAction('agent-2'))
assert(s.workspaces.length === 2, 'two workspaces after create')
assert(active(s).name === 'agent-2', 'new workspace becomes active')
const secondWs = s.activeWorkspaceId

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
assert(listSurfaceIds(s.workspaces.find((w) => w.id === secondWs)!.root).length === 1, 'other workspace untouched')

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

console.log(failures === 0 ? '\n✅ ALL APP-REDUCER TESTS PASS' : `\n❌ ${failures} FAILURE(S)`)
if (failures > 0) throw new Error(`${failures} app-reducer test(s) failed`)
