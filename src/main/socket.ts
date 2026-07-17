import net from 'net'
import { existsSync, unlinkSync } from 'fs'
import { Notification } from 'electron'
import type { SocketApply, WorkspacesSync } from '../shared/ipc'
import { normalizeAgentReport } from '../shared/agent'
import { normalizeUsageReport } from '../shared/usage'
import { normalizeAgentWait, waitForAgent } from './agentWait'

// ─────────────────────────────────────────────────────────────────────────────
// SOCKET SERVER  (main process — the programmable control channel)
// A unix-domain socket speaking newline-terminated JSON `{id, method, params}`.
// Agents (via the `cmux` CLI) push status/notifications here; we route them to the
// renderer to update the sidebar. This is the backbone of the cmux "feel".
// See textbook/11 (the socket API) and FEATURES.md Part 2.
// ─────────────────────────────────────────────────────────────────────────────

type ApplyFn = (cmd: SocketApply) => void

let server: net.Server | null = null

// A read-only mirror of the renderer's workspaces so we can resolve --workspace
// (by id or name) and default to the active one, without a round-trip.
let mirror: WorkspacesSync = { workspaces: [], activeWorkspaceId: '', agents: [] }

export function socketPath(): string {
  return process.env.CMUX_SOCKET_PATH || '/tmp/cmux-linux.sock'
}

export function updateWorkspaceMirror(sync: WorkspacesSync): void {
  mirror = sync
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
          'select-workspace',
          'close-workspace',
          'new-split',
          'send-text',
          'send-key',
          'set-status',
          'agent-report',
          'agent-clear',
          'list-agents',
          'focus-agent',
          'wait-agent',
          'report-usage',
          'log',
          'notify'
        ]
      })
      return
    case 'identify': {
      // Fall back to the requested id/name if the mirror can't resolve it yet
      // (e.g. early startup), so identify doesn't report null for a valid caller.
      const requested = typeof params.workspace === 'string' && params.workspace ? params.workspace : null
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
    case 'list-agents': {
      let agents = mirror.agents
      if (typeof params.workspace === 'string' && params.workspace) {
        const workspaceId = await resolveWorkspaceRetry(params)
        if (!workspaceId) {
          send(conn, id, null, `no matching workspace: ${String(params.workspace)}`)
          return
        }
        agents = agents.filter((agent) => agent.workspaceId === workspaceId)
      }
      send(conn, id, { agents })
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
    case 'send-text':
    case 'send-key': {
      // Validate the payload so an empty command isn't silently accepted.
      const arg = String((method === 'send-key' ? (params.key ?? params.text) : params.text) ?? '')
      if (!arg) {
        send(conn, id, null, method === 'send-key' ? 'send-key requires a key' : 'send-text requires text')
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
          title: String(params.title ?? 'cmux-linux'),
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

export function startSocketServer(apply: ApplyFn): void {
  const path = socketPath()
  // Clean up a stale socket file left by a previous crash.
  if (existsSync(path)) {
    try {
      unlinkSync(path)
    } catch {
      /* ignore */
    }
  }

  server = net.createServer((conn) => {
    // Message framing: a single 'data' event may contain partial or multiple JSON
    // lines, so we buffer and split on '\n'. (textbook/11 §gotchas)
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
  })

  server.on('error', (err) => console.error('[socket] server error:', err))
  server.listen(path, () => console.log('[socket] listening on', path))
}

export function stopSocketServer(): void {
  server?.close()
  server = null
  const path = socketPath()
  if (existsSync(path)) {
    try {
      unlinkSync(path)
    } catch {
      /* ignore */
    }
  }
}
