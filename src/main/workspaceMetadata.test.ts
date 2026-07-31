import type { SocketApply } from '../shared/ipc'
import type { WorkspaceMetadata } from '../shared/workspaceMetadata'
import type { TerminalProcessContext } from './terminalInspection'
import {
  branchFromGitHead,
  parseGitLocation,
  startWorkspaceMetadataDiscovery,
  WORKSPACE_METADATA_ACTIVE_POLL_MS,
  WORKSPACE_METADATA_HIDDEN_POLL_MS,
  WorkspaceMetadataDiscovery
} from './workspaceMetadata'
import type { TerminalInspectionActivity } from './terminalInspection'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

assert(
  parseGitLocation('/projects/shepherd\n/projects/shepherd/.git\n')?.root === '/projects/shepherd',
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
      return cwd.startsWith('/projects/shepherd')
        ? { root: '/projects/shepherd', gitDir: '/projects/shepherd/.git' }
        : null
    },
    readGitHead: () => head,
    home: '/home/dev'
  })
  discovery.updateWorkspaces([{ id: 'ws-1', name: '', activeSurfaceId: 'term-1' }])

  await discovery.scan([context('term-1', '/projects/shepherd/src')], 1_000)
  const first = emitted[0]?.params.metadata as WorkspaceMetadata
  assert(first?.projectName === 'shepherd', 'reports the repository as the project')
  assert(first?.gitBranch === 'main', 'reports the current branch')
  assert(probes === 1, 'probes Git once for the initial cwd')

  await discovery.scan([context('term-1', '/projects/shepherd/src')], 1_500)
  assert(emitted.length === 1, 'deduplicates unchanged metadata')
  assert(probes === 1, 'uses cached Git locations on unchanged scans')

  head = 'ref: refs/heads/feat/live-sidebar'
  await discovery.scan([context('term-1', '/projects/shepherd/src')], 2_000)
  const branchUpdate = emitted[1]?.params.metadata as WorkspaceMetadata
  assert(branchUpdate?.gitBranch === 'feat/live-sidebar', 'detects a branch switch from HEAD')
  assert(probes === 1, 'does not spawn Git to detect a branch switch')

  await discovery.scan([context('term-1', '/tmp/scratch')], 2_500)
  const outsideGit = emitted[2]?.params.metadata as WorkspaceMetadata
  assert(outsideGit?.projectName === 'scratch', 'updates the project after cd')
  assert(outsideGit?.gitBranch === null, 'marks a non-Git directory')
  assert(probes === 2, 're-probes after leaving the cached repository')

  discovery.updateWorkspaces([{ id: 'ws-1', name: '', activeSurfaceId: 'term-2' }])
  await discovery.scan([context('term-1', '/projects/shepherd')], 3_000)
  assert(emitted.length === 3, 'ignores metadata from a non-active terminal')

  interface ScheduledTask {
    cancelled: boolean
    delayMs: number
    run: () => void
  }
  const tasks: ScheduledTask[] = []
  let activityListener: ((activity: TerminalInspectionActivity) => void) | undefined
  let unsubscribed = false
  let runtimeNow = 10_000
  let runtimeHead = 'ref: refs/heads/main'
  const runtimeEmitted: SocketApply[] = []
  const runtime = startWorkspaceMetadataDiscovery((command) => runtimeEmitted.push(command), {
    listContexts: () => [context('term-1', '/projects/shepherd')],
    subscribeActivity: (listener) => {
      activityListener = listener
      return () => {
        unsubscribed = true
      }
    },
    dependencies: {
      probeGit: async () => ({
        root: '/projects/shepherd',
        gitDir: '/projects/shepherd/.git'
      }),
      readGitHead: () => runtimeHead,
      home: '/home/dev'
    },
    now: () => runtimeNow,
    schedule: (task, delayMs) => {
      const scheduled = { cancelled: false, delayMs, run: task }
      tasks.push(scheduled)
      return () => {
        scheduled.cancelled = true
      }
    }
  })
  const runNext = (): ScheduledTask | undefined => {
    let task = tasks.shift()
    while (task?.cancelled) task = tasks.shift()
    task?.run()
    return task
  }
  const pending = (): ScheduledTask[] => tasks.filter((task) => !task.cancelled)
  const settle = async (): Promise<void> => {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }

  runtime.updateWorkspaces([{ id: 'ws-1', name: '', activeSurfaceId: 'term-1' }])
  assert(pending()[0]?.delayMs === 0, 'target changes request metadata immediately')
  runNext()
  await settle()
  assert(runtimeEmitted[0]?.method === 'workspace-metadata', 'reports initial adaptive metadata')
  assert(
    pending()[0]?.delayMs === WORKSPACE_METADATA_ACTIVE_POLL_MS,
    'keeps a short active metadata cadence after a target change'
  )

  const scheduledBeforeOutput = pending()[0]
  activityListener?.({ surfaceId: 'term-1', kind: 'output', timestamp: runtimeNow })
  assert(
    pending()[0] === scheduledBeforeOutput,
    'does not reschedule metadata for output-only churn'
  )
  activityListener?.({ surfaceId: 'term-1', kind: 'input', timestamp: runtimeNow })
  assert(
    pending()[0]?.delayMs === WORKSPACE_METADATA_ACTIVE_POLL_MS,
    'terminal input stays coalesced to the active metadata cadence'
  )

  runtime.setVisible(false)
  assert(
    pending()[0]?.delayMs === WORKSPACE_METADATA_HIDDEN_POLL_MS,
    'uses the hidden metadata fallback'
  )
  runtime.setVisible(true)
  assert(pending()[0]?.delayMs === 0, 'restoring the window requests metadata immediately')

  runtimeHead = 'ref: refs/heads/feat/adaptive'
  runtimeNow += 1_000
  runNext()
  await settle()
  const restored = runtimeEmitted.at(-1)?.params.metadata as WorkspaceMetadata
  assert(restored?.gitBranch === 'feat/adaptive', 'refreshes the branch immediately on restore')

  runtime.stop()
  runtime.stop()
  assert(unsubscribed, 'unsubscribes metadata activity on stop')
  assert(pending().length === 0, 'cancels the metadata timer on stop')

  if (failures > 0) throw new Error(`${failures} live workspace metadata test(s) failed`)
  console.log('\n✅ ALL LIVE WORKSPACE METADATA TESTS PASS')
}

void main()
