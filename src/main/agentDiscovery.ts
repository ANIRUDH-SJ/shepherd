import type { AgentProvider, AgentRecord, AgentState } from '../shared/agent'
import { normalizeAgentReport } from '../shared/agent'
import type { SocketApply } from '../shared/ipc'
import {
  listTerminalProcessContexts,
  subscribeTerminalInspectionActivity,
  type ForegroundProcess,
  type TerminalInspectionActivity,
  type TerminalProcessContext
} from './terminalInspection'
import { AdaptivePollingLoop } from './adaptivePolling'

export const AUTOMATIC_AGENT_SOURCE = 'process:auto'
export const AUTOMATIC_AGENT_SCAN_MS = 1_000
export const AUTOMATIC_AGENT_ACTIVE_MS = 3_000
export const AUTOMATIC_AGENT_ACTIVE_POLL_MS = 1_000
export const AUTOMATIC_AGENT_QUIET_POLL_MS = 5_000
export const AUTOMATIC_AGENT_HIDDEN_POLL_MS = 15_000
export const AUTOMATIC_AGENT_BURST_MS = 4_000

export interface AgentProcessMatch {
  provider: AgentProvider
  displayName: string
  process: ForegroundProcess
}

interface AgentRule {
  aliases: string[]
  provider: AgentProvider
  displayName: string
}

const AGENT_RULES: AgentRule[] = [
  { aliases: ['codex', 'codex-cli'], provider: 'codex', displayName: 'Codex' },
  { aliases: ['claude', 'claude-code'], provider: 'claude', displayName: 'Claude Code' },
  { aliases: ['opencode'], provider: 'opencode', displayName: 'OpenCode' },
  { aliases: ['kimi', 'kimi-cli', 'kimi-code'], provider: 'custom', displayName: 'Kimi' },
  { aliases: ['aider'], provider: 'custom', displayName: 'Aider' },
  { aliases: ['goose'], provider: 'custom', displayName: 'Goose' },
  { aliases: ['amp'], provider: 'custom', displayName: 'Amp' },
  { aliases: ['gemini', 'gemini-cli'], provider: 'custom', displayName: 'Gemini CLI' },
  { aliases: ['qwen-code', 'qwen'], provider: 'custom', displayName: 'Qwen Code' },
  { aliases: ['copilot', 'copilot-cli', 'gh-copilot'], provider: 'custom', displayName: 'Copilot' },
  { aliases: ['cursor-agent'], provider: 'custom', displayName: 'Cursor Agent' },
  { aliases: ['crush'], provider: 'custom', displayName: 'Crush' },
  { aliases: ['cody'], provider: 'custom', displayName: 'Cody' },
  { aliases: ['plandex'], provider: 'custom', displayName: 'Plandex' },
  { aliases: ['mentat'], provider: 'custom', displayName: 'Mentat' }
]

function normalizedProcessName(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/\.(?:c?js|mjs|py)$/i, '')
    .replace(/_/g, '-')
    .replace(/[^a-z0-9@+.-]/g, '')
}

function matchesAlias(candidate: string, alias: string): boolean {
  return (
    candidate === alias ||
    candidate.startsWith(`${alias}-`) ||
    candidate.endsWith(`-${alias}`) ||
    candidate.includes(`@${alias}`)
  )
}

function genericAgentName(candidate: string): string | undefined {
  if (!/(^|[-_.])(agent|assistant|copilot)([-_.]|$)/.test(candidate)) return undefined
  const words = candidate
    .replace(/^@/, '')
    .split(/[-_.]+/)
    .filter(Boolean)
    .slice(0, 5)
  if (words.length === 0) return undefined
  return words.map((word) => word[0].toUpperCase() + word.slice(1)).join(' ')
}

/** The process list is ordered foreground-first and then through its parents. */
export function classifyAgentProcesses(processes: ForegroundProcess[]): AgentProcessMatch | null {
  for (const process of processes) {
    const candidates = [process.command, process.name]
      .map(normalizedProcessName)
      .filter((candidate, index, values) => candidate && values.indexOf(candidate) === index)
    for (const candidate of candidates) {
      for (const rule of AGENT_RULES) {
        if (rule.aliases.some((alias) => matchesAlias(candidate, alias))) {
          return { provider: rule.provider, displayName: rule.displayName, process }
        }
      }
      const displayName = genericAgentName(candidate)
      if (displayName) return { provider: 'custom', displayName, process }
    }
  }
  return null
}

export function automaticAgentState(lastActivityAt: number, now: number): AgentState {
  return now - lastActivityAt <= AUTOMATIC_AGENT_ACTIVE_MS ? 'working' : 'idle'
}

interface ActiveDiscovery {
  agentId: string
  workspaceId: string
  signature: string
}

export class AutomaticAgentDiscovery {
  private readonly active = new Map<string, ActiveDiscovery>()
  private agents: AgentRecord[] = []
  private richAgentSignature = '[]'

  constructor(private readonly emit: (command: SocketApply) => void) {}

  updateAgents(agents: AgentRecord[]): boolean {
    this.agents = agents
    const signature = JSON.stringify(
      agents
        .filter((agent) => agent.source !== AUTOMATIC_AGENT_SOURCE)
        .map((agent) => [agent.agentId, agent.surfaceId, agent.source])
        .sort(([left], [right]) => String(left).localeCompare(String(right)))
    )
    if (signature === this.richAgentSignature) return false
    this.richAgentSignature = signature
    return true
  }

  scan(contexts: TerminalProcessContext[], now = Date.now()): void {
    const seen = new Set<string>()
    for (const context of contexts) {
      seen.add(context.surfaceId)
      const richReport = this.agents.some(
        (agent) => agent.surfaceId === context.surfaceId && agent.source !== AUTOMATIC_AGENT_SOURCE
      )
      if (richReport || !context.workspaceId) {
        this.clear(context.surfaceId)
        continue
      }

      const match = classifyAgentProcesses(context.processes)
      if (!match) {
        this.clear(context.surfaceId)
        continue
      }

      const state = automaticAgentState(context.lastActivityAt, now)
      const agentId = `${match.provider}:auto:${context.surfaceId}`
      const command = match.process.command ?? match.process.name
      const signature = JSON.stringify([
        context.workspaceId,
        agentId,
        match.displayName,
        match.process.pid,
        command,
        state
      ])
      const previous = this.active.get(context.surfaceId)
      if (previous?.signature === signature) continue
      if (previous && previous.agentId !== agentId) this.emitClear(previous)

      const validation = normalizeAgentReport(
        {
          agentId,
          provider: match.provider,
          displayName: match.displayName,
          workspaceId: context.workspaceId,
          surfaceId: context.surfaceId,
          state,
          source: AUTOMATIC_AGENT_SOURCE,
          message: `Auto-detected ${command}`
        },
        now
      )
      if (!validation.ok) continue
      this.active.set(context.surfaceId, {
        agentId,
        workspaceId: context.workspaceId,
        signature
      })
      this.emit({
        method: 'agent-report',
        workspaceId: context.workspaceId,
        params: { report: validation.report }
      })
    }

    for (const surfaceId of this.active.keys()) {
      if (!seen.has(surfaceId)) this.clear(surfaceId)
    }
  }

  clearAll(): void {
    for (const active of this.active.values()) this.emitClear(active)
    this.active.clear()
  }

  private clear(surfaceId: string): void {
    const active = this.active.get(surfaceId)
    if (!active) return
    this.emitClear(active)
    this.active.delete(surfaceId)
  }

  private emitClear(active: ActiveDiscovery): void {
    this.emit({
      method: 'agent-clear',
      workspaceId: active.workspaceId,
      params: { agentId: active.agentId, source: AUTOMATIC_AGENT_SOURCE }
    })
  }
}

export interface AutomaticAgentDiscoveryRuntime {
  updateAgents(agents: AgentRecord[]): void
  setVisible(visible: boolean): void
  stop(): void
}

interface AutomaticAgentDiscoveryRuntimeOptions {
  listContexts?: () => TerminalProcessContext[]
  subscribeActivity?: (
    listener: (activity: TerminalInspectionActivity) => void
  ) => () => void
  now?: () => number
  schedule?: (task: () => void, delayMs: number) => () => void
}

export function startAutomaticAgentDiscovery(
  emit: (command: SocketApply) => void,
  options: AutomaticAgentDiscoveryRuntimeOptions = {}
): AutomaticAgentDiscoveryRuntime {
  const discovery = new AutomaticAgentDiscovery(emit)
  const now = options.now ?? Date.now
  const loop = new AdaptivePollingLoop({
    run: () => discovery.scan((options.listContexts ?? listTerminalProcessContexts)(), now()),
    activeIntervalMs: AUTOMATIC_AGENT_ACTIVE_POLL_MS,
    idleIntervalMs: AUTOMATIC_AGENT_QUIET_POLL_MS,
    hiddenIntervalMs: AUTOMATIC_AGENT_HIDDEN_POLL_MS,
    activeForMs: AUTOMATIC_AGENT_BURST_MS,
    now,
    ...(options.schedule ? { schedule: options.schedule } : {})
  })
  const unsubscribeActivity = (
    options.subscribeActivity ?? subscribeTerminalInspectionActivity
  )(() => loop.trigger())
  loop.start()
  return {
    updateAgents: (agents) => {
      if (discovery.updateAgents(agents)) loop.triggerNow()
    },
    setVisible: (visible) => loop.setVisible(visible),
    stop: () => {
      unsubscribeActivity()
      loop.stop()
      discovery.clearAll()
    }
  }
}
