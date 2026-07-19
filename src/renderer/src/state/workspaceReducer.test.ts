import { findPane, makePane, makeSurface } from '../layout/tree'
import type { LayoutNode } from '../layout/types'
import { workspaceReducer, type WorkspaceState } from './workspaceReducer'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

const left = makePane(makeSurface())
const rightFirst = makeSurface()
const rightSecond = makeSurface()
const right = makePane(rightFirst)
right.surfaces.push(rightSecond)
const root: LayoutNode = {
  type: 'split',
  id: 'split-test',
  direction: 'row',
  sizes: [0.5, 0.5],
  children: [
    { type: 'pane', pane: left },
    { type: 'pane', pane: right }
  ]
}
const initial: WorkspaceState = { root, activePaneId: left.id }
const selected = workspaceReducer(initial, {
  type: 'setActiveSurface',
  paneId: right.id,
  surfaceId: rightSecond.id
})
assert(selected.activePaneId === right.id, 'tab selection activates its owning pane')
assert(
  findPane(selected.root, right.id)?.activeSurfaceId === rightSecond.id,
  'tab selection activates the requested surface'
)

const invalid = workspaceReducer(selected, {
  type: 'setActiveSurface',
  paneId: 'missing-pane',
  surfaceId: 'missing-surface'
})
assert(invalid === selected, 'invalid tab selection leaves state unchanged')

if (failures > 0) throw new Error(`${failures} workspace-reducer test(s) failed`)
console.log('\n✅ ALL WORKSPACE REDUCER TESTS PASS')
