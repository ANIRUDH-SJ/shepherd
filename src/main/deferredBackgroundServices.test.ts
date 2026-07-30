import type { AgentRecord } from '../shared/agent'
import type { WorkspacesSync } from '../shared/ipc'
import {
  DeferredBackgroundServices,
  type DeferredBackgroundServiceName
} from './deferredBackgroundServices'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

interface ScheduledTask {
  cancelled: boolean
  run: () => void
}

function manualScheduler(): {
  tasks: ScheduledTask[]
  schedule: (task: () => void) => () => void
  runNext: () => void
} {
  const tasks: ScheduledTask[] = []
  return {
    tasks,
    schedule: (task) => {
      const scheduled = { cancelled: false, run: task }
      tasks.push(scheduled)
      return () => {
        scheduled.cancelled = true
      }
    },
    runNext: () => {
      const scheduled = tasks.shift()
      if (scheduled && !scheduled.cancelled) scheduled.run()
    }
  }
}

function sync(version: number): WorkspacesSync {
  return {
    activeWorkspaceId: `ws-${version}`,
    workspaces: [
      {
        id: `ws-${version}`,
        name: `Workspace ${version}`,
        activeSurfaceId: `term-${version}`
      }
    ],
    agents: [{ agentId: `agent-${version}` } as AgentRecord]
  }
}

const scheduler = manualScheduler()
const started: DeferredBackgroundServiceName[] = []
const agentUpdates: AgentRecord[][] = []
const workspaceUpdates: WorkspacesSync['workspaces'][] = []
let agentStops = 0
let metadataStops = 0
let readyCount = 0

const services = new DeferredBackgroundServices({
  schedule: scheduler.schedule,
  startAgentDiscovery: () => ({
    updateAgents: (agents) => agentUpdates.push(agents),
    setVisible: () => undefined,
    stop: () => agentStops++
  }),
  startWorkspaceMetadata: () => ({
    updateWorkspaces: (workspaces) => workspaceUpdates.push(workspaces),
    setVisible: () => undefined,
    stop: () => metadataStops++
  }),
  onServiceStarted: (service) => started.push(service),
  onReady: () => readyCount++
})

services.update(sync(1))
services.firstTerminalReady()
services.firstTerminalReady()
assert(started.length === 0, 'does not start background services in the readiness turn')
assert(scheduler.tasks.length === 1, 'schedules readiness only once')

scheduler.runNext()
assert(started.join(',') === 'agent-discovery', 'starts agent discovery on the next turn')
assert(agentUpdates[0]?.[0]?.agentId === 'agent-1', 'replays agents mirrored before readiness')
assert(workspaceUpdates.length === 0, 'spreads metadata startup across another turn')

services.update(sync(2))
assert(agentUpdates.at(-1)?.[0]?.agentId === 'agent-2', 'updates a service that is already live')

scheduler.runNext()
assert(
  started.join(',') === 'agent-discovery,workspace-metadata',
  'starts workspace metadata on the following turn'
)
assert(
  workspaceUpdates[0]?.[0]?.id === 'ws-2',
  'starts the later service with the newest mirrored workspace state'
)
assert(readyCount === 1, 'reports readiness after both services start')

services.update(sync(3))
assert(agentUpdates.at(-1)?.[0]?.agentId === 'agent-3', 'keeps agent discovery synchronized')
assert(workspaceUpdates.at(-1)?.[0]?.id === 'ws-3', 'keeps metadata discovery synchronized')
services.stop()
services.stop()
assert(agentStops === 1 && metadataStops === 1, 'stops each live service exactly once')

const cancelledScheduler = manualScheduler()
let cancelledStarts = 0
const cancelled = new DeferredBackgroundServices({
  schedule: cancelledScheduler.schedule,
  startAgentDiscovery: () => {
    cancelledStarts++
    return {
      updateAgents: () => undefined,
      setVisible: () => undefined,
      stop: () => undefined
    }
  },
  startWorkspaceMetadata: () => ({
    updateWorkspaces: () => undefined,
    setVisible: () => undefined,
    stop: () => undefined
  })
})
cancelled.firstTerminalReady()
cancelled.stop()
cancelledScheduler.runNext()
assert(cancelledStarts === 0, 'cancels scheduled startup during shutdown')

const failureScheduler = manualScheduler()
const errors: DeferredBackgroundServiceName[] = []
let metadataStartedAfterFailure = false
let failureReadyCount = 0
const failure = new DeferredBackgroundServices({
  schedule: failureScheduler.schedule,
  startAgentDiscovery: () => {
    throw new Error('agent discovery unavailable')
  },
  startWorkspaceMetadata: () => {
    metadataStartedAfterFailure = true
    return {
      updateWorkspaces: () => undefined,
      setVisible: () => undefined,
      stop: () => undefined
    }
  },
  onError: (service) => errors.push(service),
  onReady: () => failureReadyCount++
})
failure.firstTerminalReady()
failureScheduler.runNext()
failureScheduler.runNext()
assert(errors.join(',') === 'agent-discovery', 'contains a deferred service startup failure')
assert(metadataStartedAfterFailure, 'continues starting independent services after a failure')
assert(failureReadyCount === 0, 'does not claim full readiness after a startup failure')

if (failures > 0) throw new Error(`${failures} deferred background service test(s) failed`)
console.log('\n✅ ALL DEFERRED BACKGROUND SERVICE TESTS PASS')
