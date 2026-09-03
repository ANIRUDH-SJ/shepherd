import net from 'net'
import { existsSync, unlinkSync } from 'fs'
import { Notification } from 'electron'
import type { SocketApply, WorkspacesSync } from '../shared/ipc'
import { normalizeAgentReport } from '../shared/agent'
import {
  AGENT_PROTOCOL_METHODS,
  AGENT_PROTOCOL_SCHEMA,
  agentProtocolCapabilities
} from '../shared/agentProtocol'
import { normalizeAgentQuery, queryAgents } from '../shared/agentQuery'
import type { AgentQuery, AgentQueryResult } from '../shared/agentQuery'
import type { AgentRecord } from '../shared/agent'
import { PRODUCT_NAME, productSocketPaths } from '../shared/product'
import { normalizeWorkspaceName } from '../shared/workspace'
import { normalizeUsageReport } from '../shared/usage'
import { normalizeAgentWait, waitForAgent } from './agentWait'
import { inspectTerminal, normalizeTerminalInspection } from './terminalInspection'
import { createGitWorktree, normalizeWorktreeRequest } from './worktree'

// ─────────────────────────────────────────────────────────────────────────────
// SOCKET SERVER  (main process — the programmable control channel)
// A unix-domain socket speaking newline-terminated JSON `{id, method, params}`.
// Agents (via the `shepherd` CLI) push status/notifications here; we route them
// to the renderer. The legacy socket remains available during the name migration.
// See docs/ARCHITECTURE.md for the public process and protocol overview.
// ─────────────────────────────────────────────────────────────────────────────

type ApplyFn = (cmd: SocketApply) => void

interface SocketServer {
  server: net.Server
  path: string
}

let servers: SocketServer[] = []

const MAX_AGENT_SUBSCRIPTIONS = 64
const MAX_SUBSCRIBER_BUFFER_BYTES = 1024 * 1024

interface AgentSubscriber {
  subscriptionId: number
  conn: net.Socket
  query: AgentQuery
  workspaceId?: string
  sequence: number
  previous: AgentQueryResult
}

const agentSubscribers = new Set<AgentSubscriber>()
let nextSubscriptionId = 1

// A read-only mirror of the renderer's workspaces so we can resolve --workspace
// (by id or name) and default to the active one, without a round-trip.
let mirror: WorkspacesSync = { workspaces: [], activeWorkspaceId: '', agents: [] }

export function socketPath(): string {
  return productSocketPaths(process.env)[0]
}

export function updateWorkspaceMirror(sync: WorkspacesSync): void {
  mirror = sync
  publishAgentUpdates()
}

function querySubscription(subscriber: AgentSubscriber): AgentQueryResult {
  const agents = subscriber.workspaceId
    ? mirror.agents.filter((agent) => agent.workspaceId === subscriber.workspaceId)
    : mirror.agents
  return queryAgents(agents, subscriber.query)
}

function resultAgents(result: AgentQueryResult): Map<string, AgentRecord> {
  return new Map(result.agents.map((agent) => [agent.agentId, agent]))
}

function publishAgentUpdates(): void {
  for (const subscriber of agentSubscribers) {
    if (subscriber.conn.destroyed || subscriber.conn.writableLength > MAX_SUBSCRIBER_BUFFER_BYTES) {
      agentSubscribers.delete(subscriber)
      subscriber.conn.destroy()
      continue
    }
    const current = querySubscription(subscriber)
    if (JSON.stringify(current) === JSON.stringify(subscriber.previous)) continue

    const before = resultAgents(subscriber.previous)
    const after = resultAgents(current)
    const upsert = current.agents.filter(
      (agent) => JSON.stringify(before.get(agent.agentId)) !== JSON.stringify(agent)
    )
    const removed = [...before.keys()].filter((agentId) => !after.has(agentId))
    subscriber.sequence++
    subscriber.previous = current
    subscriber.conn.write(
      JSON.stringify({
        event: 'agent-update',
        subscriptionId: subscriber.subscriptionId,
        data: {
          version: 1,
          sequence: subscriber.sequence,
          generatedAt: Date.now(),
          upsert,
          removed,
          matched: current.matched,
          truncated: current.truncated,
          summary: current.summary
        }
      }) + '\n'
    )
  }
}

function resolveWorkspace(params: Record<string, unknown>): string | null {
  const w = params.workspace
  if (typeof w === 'string' && w) {
    const byId = mirror.workspaces.find((x) => x.id === w)
    if (byId) return byId.id
    const byName = mirror.workspaces.find((x) => x.name === w)
    return byName ? byName.id : null
  }
  return mirror.activeWorkspaceId || null
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Resolve a workspace, retrying briefly. The renderer→main mirror can lag just
 *  after a new-workspace, so a back-to-back `select-workspace --workspace <name>`
 *  could otherwise miss it. Only retries when a name/id was actually requested. */
async function resolveWorkspaceRetry(params: Record<string, unknown>): Promise<string | null> {
  const named = typeof params.workspace === 'string' && params.workspace !== ''
  for (let i = 0; i < 10; i++) {
    const resolved = resolveWorkspace(params)
    if (resolved || !named) return resolved
    await delay(50)
  }
  return null
}

function send(conn: net.Socket, id: unknown, result: unknown, error?: string): void {
  conn.write(JSON.stringify(error ? { id, error } : { id, result }) + '\n')
}

async function handleLine(line: string, conn: net.Socket, apply: ApplyFn): Promise<void> {
  let msg: { id?: unknown; method?: string; params?: Record<string, unknown> }
  try {
    msg = JSON.parse(line)
  } catch {
    conn.write(JSON.stringify({ error: 'invalid json' }) + '\n')
    return
  }
  const { id, method, params = {} } = msg

  switch (method) {
    case 'ping':
      send(conn, id, { ok: true })
      return
    case 'capabilities':
      send(conn, id, {
        methods: [
          'ping',
          'capabilities',
          'identify',
          'list-workspaces',
          'new-workspace',
          'new-worktree',
          'rename-workspace',
          'select-workspace',
          'close-workspace',
          'new-split',
          'send-text',
          'send-key',
          'set-status',
          ...AGENT_PROTOCOL_METHODS,
          'report-usage',
          'log',
          'notify'
        ]
      })
      return
    case 'agent-schema':
      send(conn, id, AGENT_PROTOCOL_SCHEMA)
      return
    case 'agent-capabilities': {
      const result = agentProtocolCapabilities(params.provider)
      if (!result.ok) send(conn, id, null, result.error)
      else send(conn, id, result.capabilities)
      return
    }
    case 'identify': {
      // Fall back to the requested id/name if the mirror can't resolve it yet
      // (e.g. early startup), so identify doesn't report null for a valid caller.
      const requested =
        typeof params.workspace === 'string' && params.workspace ? params.workspace : null
      const wid = resolveWorkspace(params) ?? requested
      const ws = mirror.workspaces.find((w) => w.id === wid)
      send(conn, id, {
        workspace: wid,
        name: ws ? ws.name : null,
        activeWorkspace: mirror.activeWorkspaceId || null
      })
      return
    }
    case 'list-workspaces':
      send(conn, id, { workspaces: mirror.workspaces })
      return
    case 'list-agents':
    case 'agent-snapshot': {
      const validation = normalizeAgentQuery(params)
      if (!validation.ok) {
        send(conn, id, null, validation.error)
        return
      }
      let agents = mirror.agents
      let workspaces = mirror.workspaces
      if (typeof params.workspace === 'string' && params.workspace) {
        const workspaceId = await resolveWorkspaceRetry(params)
        if (!workspaceId) {
          send(conn, id, null, `no matching workspace: ${String(params.workspace)}`)
          return
        }
        agents = agents.filter((agent) => agent.workspaceId === workspaceId)
        workspaces = workspaces.filter((workspace) => workspace.id === workspaceId)
      }
      const result = queryAgents(agents, validation.query)
      if (method === 'list-agents') {
        send(conn, id, result)
      } else {
        send(conn, id, {
          version: 1,
          generatedAt: Date.now(),
          activeWorkspaceId: mirror.activeWorkspaceId || null,
          workspaces,
          ...result
        })
      }
      return
    }
    case 'subscribe-agents': {
      if (agentSubscribers.size >= MAX_AGENT_SUBSCRIPTIONS) {
        send(conn, id, null, `agent subscription limit reached: ${MAX_AGENT_SUBSCRIPTIONS}`)
        return
      }
      const validation = normalizeAgentQuery(params)
      if (!validation.ok) {
        send(conn, id, null, validation.error)
        return
      }
      let workspaceId: string | undefined
      if (typeof params.workspace === 'string' && params.workspace) {
        workspaceId = (await resolveWorkspaceRetry(params)) ?? undefined
        if (!workspaceId) {
          send(conn, id, null, `no matching workspace: ${String(params.workspace)}`)
          return
        }
      }
      const subscriber: AgentSubscriber = {
        subscriptionId: nextSubscriptionId++,
        conn,
        query: validation.query,
        ...(workspaceId ? { workspaceId } : {}),
        sequence: 0,
        previous: queryAgents(
          workspaceId
            ? mirror.agents.filter((agent) => agent.workspaceId === workspaceId)
            : mirror.agents,
          validation.query
        )
      }
      agentSubscribers.add(subscriber)
      send(conn, id, {
        subscriptionId: subscriber.subscriptionId,
        version: 1,
        sequence: 0,
        snapshot: {
          version: 1,
          generatedAt: Date.now(),
          activeWorkspaceId: mirror.activeWorkspaceId || null,
          workspaces: workspaceId
            ? mirror.workspaces.filter((workspace) => workspace.id === workspaceId)
            : mirror.workspaces,
          ...subscriber.previous
        }
      })
      return
    }
    case 'focus-agent': {
      const agentId = typeof params.agentId === 'string' ? params.agentId.trim() : ''
      if (!agentId) {
        send(conn, id, null, 'focus-agent requires an agent id')
        return
      }
      const agent = mirror.agents.find((candidate) => candidate.agentId === agentId)
      if (!agent) {
        send(conn, id, null, `no matching agent: ${agentId}`)
        return
      }
      apply({ method, workspaceId: agent.workspaceId, params: { agentId } })
      send(conn, id, { ok: true })
      return
    }
    case 'inspect-agent': {
      const agentId = typeof params.agentId === 'string' ? params.agentId.trim() : ''
      if (!agentId) {
        send(conn, id, null, 'inspect-agent requires an agent id')
        return
      }
      const validation = normalizeTerminalInspection(params)
      if (!validation.ok) {
        send(conn, id, null, validation.error)
        return
      }
      const agent = mirror.agents.find((candidate) => candidate.agentId === agentId)
      if (!agent) {
        send(conn, id, null, `no matching agent: ${agentId}`)
        return
      }
      const terminal = inspectTerminal(agent.surfaceId, validation.options)
      if (!terminal || terminal.workspaceId !== agent.workspaceId) {
        send(conn, id, null, `agent terminal is not running: ${agentId}`)
        return
      }
      send(conn, id, { agent, terminal })
      return
    }
    case 'wait-agent': {
      const validation = normalizeAgentWait(params)
      if (!validation.ok) {
        send(conn, id, null, validation.error)
        return
      }
      const result = await waitForAgent(() => mirror.agents, validation.options)
      if (!result.ok) send(conn, id, null, result.error)
      else send(conn, id, { agent: result.agent })
      return
    }
    case 'new-worktree': {
      const validation = normalizeWorktreeRequest(params)
      if (!validation.ok) {
        send(conn, id, null, validation.error)
        return
      }
      const result = await createGitWorktree(validation.request)
      if (!result.ok) {
        send(conn, id, null, result.error)
        return
      }
      apply({
        method: 'new-workspace',
        workspaceId: null,
        params: { name: validation.request.name, cwd: result.worktree.path }
      })
      send(conn, id, { worktree: result.worktree })
      return
    }
    case 'new-workspace':
      apply({ method, workspaceId: null, params })
      send(conn, id, { ok: true })
      return
    case 'select-workspace':
    case 'close-workspace':
    case 'new-split': {
      const workspaceId = await resolveWorkspaceRetry(params)
      if (!workspaceId) {
        send(conn, id, null, `no matching workspace: ${String(params.workspace ?? '(active)')}`)
        return
      }
      apply({ method, workspaceId, params })
      send(conn, id, { ok: true })
      return
    }
    case 'rename-workspace': {
      if (typeof params.name !== 'string') {
        send(conn, id, null, 'rename-workspace requires --name')
        return
      }
      const workspaceId = await resolveWorkspaceRetry(params)
      if (!workspaceId) {
        send(conn, id, null, `no matching workspace: ${String(params.workspace ?? '(active)')}`)
        return
      }
      apply({
        method,
        workspaceId,
        params: { ...params, name: normalizeWorkspaceName(params.name) }
      })
      send(conn, id, { ok: true })
      return
    }
    case 'send-text':
    case 'send-key': {
      // Validate the payload so an empty command isn't silently accepted.
      const arg = String((method === 'send-key' ? (params.key ?? params.text) : params.text) ?? '')
      if (!arg) {
        send(
          conn,
          id,
          null,
          method === 'send-key' ? 'send-key requires a key' : 'send-text requires text'
        )
        return
      }
      const workspaceId = await resolveWorkspaceRetry(params)
      if (!workspaceId) {
        send(conn, id, null, `no matching workspace: ${String(params.workspace ?? '(active)')}`)
        return
      }
      apply({ method, workspaceId, params })
      send(conn, id, { ok: true })
      return
    }
    case 'set-status':
    case 'log':
    case 'notify': {
      const workspaceId = await resolveWorkspaceRetry(params)
      if (!workspaceId) {
        send(conn, id, null, `no matching workspace: ${String(params.workspace ?? '(active)')}`)
        return
      }
      apply({ method, workspaceId, params })
      if (method === 'notify' && Notification.isSupported()) {
        new Notification({
          title: String(params.title ?? PRODUCT_NAME),
          body: String(params.body ?? '')
        }).show()
      }
      send(conn, id, { ok: true })
      return
    }
    case 'report-usage': {
      const validation = normalizeUsageReport(params)
      if (!validation.ok) {
        send(conn, id, null, validation.error)
        return
      }
      const workspaceId = await resolveWorkspaceRetry(params)
      if (!workspaceId) {
        send(conn, id, null, `no matching workspace: ${String(params.workspace ?? '(active)')}`)
        return
      }
      apply({ method, workspaceId, params: { report: validation.report } })
      send(conn, id, { ok: true })
      return
    }
    case 'agent-report': {
      const workspaceId = await resolveWorkspaceRetry(params)
      if (!workspaceId) {
        send(conn, id, null, `no matching workspace: ${String(params.workspace ?? '(active)')}`)
        return
      }
      const validation = normalizeAgentReport({ ...params, workspaceId })
      if (!validation.ok) {
        send(conn, id, null, validation.error)
        return
      }
      apply({ method, workspaceId, params: { report: validation.report } })
      send(conn, id, { ok: true })
      return
    }
    case 'agent-clear': {
      const agentId = typeof params.agentId === 'string' ? params.agentId.trim() : ''
      if (!agentId) {
        send(conn, id, null, 'agent-clear requires an agent id')
        return
      }
      const agent = mirror.agents.find((candidate) => candidate.agentId === agentId)
      if (!agent) {
        send(conn, id, null, `no matching agent: ${agentId}`)
        return
      }
      const source = typeof params.source === 'string' ? params.source.trim() : undefined
      if (source && source !== agent.source) {
        send(conn, id, null, `agent source mismatch: ${source}`)
        return
      }
      apply({
        method,
        workspaceId: agent.workspaceId,
        params: { agentId, ...(source ? { source } : {}) }
      })
      send(conn, id, { ok: true })
      return
    }
    default:
      send(conn, id, null, `unknown method: ${method}`)
  }
}

function createSocketServer(apply: ApplyFn): net.Server {
  return net.createServer((conn) => {
    // Message framing: a single 'data' event may contain partial or multiple JSON
    // lines, so we buffer and split on '\n'.
    let buffer = ''
    conn.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (line) void handleLine(line, conn, apply)
      }
    })
    conn.on('error', () => {
      /* ignore per-connection errors */
    })
    conn.on('close', () => {
      for (const subscriber of agentSubscribers) {
        if (subscriber.conn === conn) agentSubscribers.delete(subscriber)
      }
    })
  })
}

export function startSocketServer(
  apply: ApplyFn,
  paths: string[] = productSocketPaths(process.env)
): void {
  for (const path of paths) {
    // Clean up a stale socket file left by a previous crash.
    if (existsSync(path)) {
      try {
        unlinkSync(path)
      } catch {
        /* ignore */
      }
    }

    const server = createSocketServer(apply)
    servers.push({ server, path })
    server.on('error', (err) => console.error('[shepherd:socket] server error:', err))
    server.listen(path, () => console.log('[shepherd:socket] listening on', path))
  }
}

export function stopSocketServer(): void {
  for (const subscriber of agentSubscribers) subscriber.conn.destroy()
  agentSubscribers.clear()
  for (const { server, path } of servers) {
    server.close()
    if (existsSync(path)) {
      try {
        unlinkSync(path)
      } catch {
        /* ignore */
      }
    }
  }
  servers = []
}
