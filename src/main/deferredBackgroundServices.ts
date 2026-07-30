import type { WorkspacesSync } from '../shared/ipc'
import type { AutomaticAgentDiscoveryRuntime } from './agentDiscovery'
import type { WorkspaceMetadataRuntime } from './workspaceMetadata'

export type DeferredBackgroundServiceName = 'agent-discovery' | 'workspace-metadata'

type CancelScheduledTask = () => void

interface DeferredBackgroundServicesOptions {
  startAgentDiscovery: () => AutomaticAgentDiscoveryRuntime
  startWorkspaceMetadata: () => WorkspaceMetadataRuntime
  schedule?: (task: () => void) => CancelScheduledTask
  onServiceStarted?: (service: DeferredBackgroundServiceName) => void
  onReady?: () => void
  onError?: (service: DeferredBackgroundServiceName, error: unknown) => void
}

function scheduleNextTurn(task: () => void): CancelScheduledTask {
  const handle = setImmediate(task)
  return () => clearImmediate(handle)
}

export class DeferredBackgroundServices {
  private latestSync: WorkspacesSync | null = null
  private agentDiscovery: AutomaticAgentDiscoveryRuntime | null = null
  private workspaceMetadata: WorkspaceMetadataRuntime | null = null
  private cancelPendingTask: CancelScheduledTask | null = null
  private state: 'waiting' | 'starting' | 'started' | 'stopped' = 'waiting'
  private visible = true

  constructor(private readonly options: DeferredBackgroundServicesOptions) {}

  update(sync: WorkspacesSync): void {
    if (this.state === 'stopped') return
    this.latestSync = sync
    this.agentDiscovery?.updateAgents(sync.agents)
    this.workspaceMetadata?.updateWorkspaces(sync.workspaces)
  }

  setVisible(visible: boolean): void {
    if (this.state === 'stopped' || this.visible === visible) return
    this.visible = visible
    this.agentDiscovery?.setVisible(visible)
    this.workspaceMetadata?.setVisible(visible)
  }

  firstTerminalReady(): void {
    if (this.state !== 'waiting') return
    this.state = 'starting'
    this.queue(() => this.startAgentDiscovery())
  }

  stop(): void {
    if (this.state === 'stopped') return
    this.state = 'stopped'
    this.cancelPendingTask?.()
    this.cancelPendingTask = null
    this.agentDiscovery?.stop()
    this.agentDiscovery = null
    this.workspaceMetadata?.stop()
    this.workspaceMetadata = null
  }

  private queue(task: () => void): void {
    const schedule = this.options.schedule ?? scheduleNextTurn
    this.cancelPendingTask = schedule(() => {
      this.cancelPendingTask = null
      if (this.state !== 'starting') return
      task()
    })
  }

  private startAgentDiscovery(): void {
    this.agentDiscovery = this.startService('agent-discovery', this.options.startAgentDiscovery)
    if (this.agentDiscovery) {
      try {
        this.agentDiscovery.setVisible(this.visible)
        if (this.latestSync) this.agentDiscovery.updateAgents(this.latestSync.agents)
      } catch (error) {
        this.reportError('agent-discovery', error)
      }
    }
    this.queue(() => this.startWorkspaceMetadata())
  }

  private startWorkspaceMetadata(): void {
    this.workspaceMetadata = this.startService(
      'workspace-metadata',
      this.options.startWorkspaceMetadata
    )
    if (this.workspaceMetadata) {
      try {
        this.workspaceMetadata.setVisible(this.visible)
        if (this.latestSync) this.workspaceMetadata.updateWorkspaces(this.latestSync.workspaces)
      } catch (error) {
        this.reportError('workspace-metadata', error)
      }
    }
    this.state = 'started'
    if (this.agentDiscovery && this.workspaceMetadata) {
      try {
        this.options.onReady?.()
      } catch {
        // Observability callbacks must not break live background services.
      }
    }
  }

  private startService<T>(name: DeferredBackgroundServiceName, start: () => T): T | null {
    try {
      const service = start()
      try {
        this.options.onServiceStarted?.(name)
      } catch {
        // Observability callbacks must not discard a service that already started.
      }
      return service
    } catch (error) {
      this.reportError(name, error)
      return null
    }
  }

  private reportError(name: DeferredBackgroundServiceName, error: unknown): void {
    try {
      this.options.onError?.(name, error)
    } catch {
      // A diagnostic reporter is less important than keeping startup alive.
    }
  }
}
