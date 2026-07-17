import type { SocketApply } from '../shared/ipc'
import type { WorkspaceMetadata } from '../shared/workspaceMetadata'
import type { TerminalProcessContext } from './terminalInspection'
import {
  branchFromGitHead,
  parseGitLocation,
  WorkspaceMetadataDiscovery
} from './workspaceMetadata'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

assert(
  parseGitLocation('/projects/cmux-linux\n/projects/cmux-linux/.git\n')?.root ===
    '/projects/cmux-linux',
  'parses bounded absolute Git locations'
)
assert(parseGitLocation('relative\nrelative/.git\n') === null, 'rejects relative Git locations')
assert(
  branchFromGitHead('ref: refs/heads/feat/sidebar') === 'feat/sidebar',
  'reads a branch name from HEAD'
)
assert(branchFromGitHead('0123456789abcdef') === 'detached@0123456', 'labels detached HEAD safely')

function context(surfaceId: string, cwd: string): TerminalProcessContext {
  return {
    surfaceId,
    workspaceId: 'ws-1',
    shellPid: 10,
    processes: [],
    cwd,
    lastActivityAt: 1_000
  }
}

async function main(): Promise<void> {
  const emitted: SocketApply[] = []
  let head = 'ref: refs/heads/main'
  let probes = 0
  const discovery = new WorkspaceMetadataDiscovery((command) => emitted.push(command), {
    probeGit: async (cwd) => {
      probes++
      return cwd.startsWith('/projects/cmux-linux')
        ? { root: '/projects/cmux-linux', gitDir: '/projects/cmux-linux/.git' }
        : null
    },
    readGitHead: () => head,
    home: '/home/dev'
  })
  discovery.updateWorkspaces([{ id: 'ws-1', name: '', activeSurfaceId: 'term-1' }])

  await discovery.scan([context('term-1', '/projects/cmux-linux/src')], 1_000)
  const first = emitted[0]?.params.metadata as WorkspaceMetadata
  assert(first?.projectName === 'cmux-linux', 'reports the repository as the project')
  assert(first?.gitBranch === 'main', 'reports the current branch')
  assert(probes === 1, 'probes Git once for the initial cwd')

  await discovery.scan([context('term-1', '/projects/cmux-linux/src')], 1_500)
  assert(emitted.length === 1, 'deduplicates unchanged metadata')
  assert(probes === 1, 'uses cached Git locations on unchanged scans')

  head = 'ref: refs/heads/feat/live-sidebar'
  await discovery.scan([context('term-1', '/projects/cmux-linux/src')], 2_000)
  const branchUpdate = emitted[1]?.params.metadata as WorkspaceMetadata
  assert(branchUpdate?.gitBranch === 'feat/live-sidebar', 'detects a branch switch from HEAD')
  assert(probes === 1, 'does not spawn Git to detect a branch switch')

  await discovery.scan([context('term-1', '/tmp/scratch')], 2_500)
  const outsideGit = emitted[2]?.params.metadata as WorkspaceMetadata
  assert(outsideGit?.projectName === 'scratch', 'updates the project after cd')
  assert(outsideGit?.gitBranch === null, 'marks a non-Git directory')
  assert(probes === 2, 're-probes after leaving the cached repository')

  discovery.updateWorkspaces([{ id: 'ws-1', name: '', activeSurfaceId: 'term-2' }])
  await discovery.scan([context('term-1', '/projects/cmux-linux')], 3_000)
  assert(emitted.length === 3, 'ignores metadata from a non-active terminal')

  if (failures > 0) throw new Error(`${failures} live workspace metadata test(s) failed`)
  console.log('\n✅ ALL LIVE WORKSPACE METADATA TESTS PASS')
}

void main()
