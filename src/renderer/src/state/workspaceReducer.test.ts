import { findPane, makePane, makeSurface } from '../layout/tree'
import type { LayoutNode } from '../layout/types'
import {
  previewSplitAction,
  updatePreviewUrlAction,
  workspaceReducer,
  type WorkspaceState
} from './workspaceReducer'

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
assert(invalid === selected, 'invalid pane selection leaves state unchanged')

const invalidSurface = workspaceReducer(initial, {
  type: 'setActiveSurface',
  paneId: right.id,
  surfaceId: 'missing-surface'
})
assert(invalidSurface === initial, 'invalid surface selection leaves state unchanged')

const previewSplit = workspaceReducer(
  initial,
  previewSplitAction(left.id, 'http://localhost:43140/')
)
const previewPane = findPane(previewSplit.root, previewSplit.activePaneId)
const previewSurface = previewPane?.surfaces[0]
assert(previewSplit.root.type === 'split', 'preview opens beside the terminal')
assert(previewSurface?.panel.type === 'preview', 'preview split owns a preview panel')
assert(
  previewSurface?.panel.type === 'preview' &&
    previewSurface.panel.url === 'http://localhost:43140/',
  'preview stores the normalized local URL'
)

const navigated = workspaceReducer(
  previewSplit,
  updatePreviewUrlAction(previewSurface!.id, 'http://localhost:43140/next')!
)
const navigatedPane = findPane(navigated.root, navigated.activePaneId)
assert(
  navigatedPane?.surfaces[0].panel.type === 'preview' &&
    navigatedPane.surfaces[0].panel.url === 'http://localhost:43140/next',
  'persists a safe preview navigation'
)
assert(
  updatePreviewUrlAction(previewSurface!.id, 'https://example.com') === null,
  'rejects an unsafe preview navigation action'
)

const soleTerminalPane = makePane(makeSurface())
const soleTerminalState: WorkspaceState = {
  root: { type: 'pane', pane: soleTerminalPane },
  activePaneId: soleTerminalPane.id
}
const soleTerminalWithPreview = workspaceReducer(
  soleTerminalState,
  previewSplitAction(soleTerminalPane.id, 'http://localhost:43140/')
)
const terminalSurfaceId = soleTerminalPane.surfaces[0].id
const closeOnlyTerminal = workspaceReducer(soleTerminalWithPreview, {
  type: 'closeSurface',
  paneId: soleTerminalPane.id,
  surfaceId: terminalSurfaceId
})
assert(closeOnlyTerminal === soleTerminalWithPreview, 'keeps one terminal while previews exist')
const closeOnlyTerminalPane = workspaceReducer(soleTerminalWithPreview, {
  type: 'closePane',
  paneId: soleTerminalPane.id
})
assert(closeOnlyTerminalPane === soleTerminalWithPreview, 'keeps the only terminal pane')

if (failures > 0) throw new Error(`${failures} workspace-reducer test(s) failed`)
console.log('\n✅ ALL WORKSPACE REDUCER TESTS PASS')
