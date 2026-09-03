import type { LayoutNode } from './layout/types'
import { localhostPreviewUrl, workspaceSessionSummary } from './workspaceInspector'

let failures = 0
function assert(condition: unknown, message: string): void {
  if (condition) console.log(`  ok: ${message}`)
  else {
    console.error(`FAIL: ${message}`)
    failures++
  }
}

const root: LayoutNode = {
  type: 'split',
  id: 'split-1',
  direction: 'row',
  sizes: [0.5, 0.5],
  children: [
    {
      type: 'pane',
      pane: {
        id: 'pane-1',
        activeSurfaceId: 'term-1',
        surfaces: [
          { id: 'term-1', panel: { type: 'terminal' } },
          { id: 'preview-1', panel: { type: 'preview', url: 'http://localhost:4173' } }
        ]
      }
    },
    {
      type: 'pane',
      pane: {
        id: 'pane-2',
        activeSurfaceId: 'term-2',
        surfaces: [{ id: 'term-2', panel: { type: 'terminal' } }]
      }
    }
  ]
}

const summary = workspaceSessionSummary(root)
assert(summary.panes === 2, 'counts split panes')
assert(summary.terminals === 2, 'counts terminal surfaces')
assert(summary.previews === 1, 'counts preview surfaces independently')
assert(localhostPreviewUrl(3000) === 'http://localhost:3000', 'creates a loopback preview URL')
assert(localhostPreviewUrl(0) === null, 'rejects port zero')
assert(localhostPreviewUrl(65_536) === null, 'rejects ports above the TCP range')
assert(localhostPreviewUrl(3000.5) === null, 'rejects fractional ports')

if (failures > 0) throw new Error(`${failures} workspace inspector test(s) failed`)
console.log('\n✅ ALL WORKSPACE INSPECTOR TESTS PASS')
