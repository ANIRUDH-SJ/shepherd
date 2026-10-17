import { companionSnapshot, privateIPv4 } from './companion'
import type { WorkspacesSync } from './ipc'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}
for (const address of ['10.0.0.1', '172.16.1.2', '172.31.255.1', '192.168.0.2'])
  assert(privateIPv4(address), `accepts private address ${address}`)
for (const address of ['127.0.0.1', '8.8.8.8', '172.32.0.1', '192.169.1.1', '999.1.1.1', 'x.y.z.q'])
  assert(!privateIPv4(address), `rejects non-LAN address ${address}`)
const sync: WorkspacesSync = {
  workspaces: [
    { id: 'one', name: 'A' },
    { id: 'two', name: 'B' }
  ],
  activeWorkspaceId: 'one',
  agents: [
    {
      agentId: 'a',
      provider: 'custom',
      displayName: 'Agent',
      workspaceId: 'one',
      paneId: 'pane',
      surfaceId: 'term',
      state: 'blocked',
      message: 'private prompt',
      source: 'test',
      revision: 1,
      updatedAt: 1
    }
  ]
}
const view = companionSnapshot(sync)
assert(view.workspaces[0].blocked === 1, 'counts actionable agents in their workspace')
assert(view.workspaces[1].blocked === 0, 'keeps workspace counts separate')
assert(!JSON.stringify(view).includes('private prompt'), 'excludes agent messages')
assert(!JSON.stringify(view).includes('pane'), 'excludes terminal identifiers')
if (failures) process.exitCode = 1
