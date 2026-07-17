import net from 'net'
import { existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { SocketApply, WorkspacesSync } from '../shared/ipc'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

interface Response {
  id?: unknown
  result?: Record<string, unknown>
  error?: string
}

async function main(): Promise<void> {
  const path = join(tmpdir(), `cmux-socket-test-${process.pid}.sock`)
  process.env.CMUX_SOCKET_PATH = path
  const { startSocketServer, stopSocketServer, updateWorkspaceMirror } = await import('./socket')
  const { appendTerminalInspectionOutput, registerTerminalInspection, removeTerminalInspection } =
    await import('./terminalInspection')

  const applied: SocketApply[] = []
  const mirror: WorkspacesSync = {
    workspaces: [{ id: 'ws-1', name: 'project' }],
    activeWorkspaceId: 'ws-1',
    agents: []
  }
  updateWorkspaceMirror(mirror)
  startSocketServer((command) => applied.push(command))

  for (let attempt = 0; attempt < 100 && !existsSync(path); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }

  async function request(method: string, params: Record<string, unknown>): Promise<Response> {
    return new Promise((resolve, reject) => {
      const connection = net.createConnection(path, () => {
        connection.write(`${JSON.stringify({ id: method, method, params })}\n`)
      })
      let buffer = ''
      connection.on('data', (chunk) => {
        buffer += chunk.toString()
        const newline = buffer.indexOf('\n')
        if (newline < 0) return
        resolve(JSON.parse(buffer.slice(0, newline)) as Response)
        connection.end()
      })
      connection.once('error', reject)
    })
  }

  const capabilities = await request('capabilities', {})
  assert(
    (capabilities.result?.methods as string[]).includes('agent-snapshot'),
    'advertises the agent snapshot query'
  )
  assert(
    (capabilities.result?.methods as string[]).includes('agent-schema'),
    'advertises the agent protocol schema'
  )

  const schema = await request('agent-schema', {})
  assert(schema.result?.version === 1, 'returns the versioned agent protocol schema')
  assert(
    typeof (schema.result?.methods as Record<string, unknown>)['agent-report'] === 'object',
    'schema describes agent report parameters'
  )

  const providerCapabilities = await request('agent-capabilities', { provider: 'codex' })
  const adapters = providerCapabilities.result?.adapters as Array<Record<string, unknown>>
  assert(adapters.length === 1, 'filters adapter capabilities by provider')
  assert(adapters[0]?.cleanup === 'stale-expiry', 'describes provider cleanup behavior')
  const invalidCapabilities = await request('agent-capabilities', { provider: 'other' })
  assert(
    invalidCapabilities.error?.includes('provider must be') === true,
    'rejects an unknown capability provider'
  )

  const invalidWorktree = await request('new-worktree', {
    repo: '/tmp/repo',
    path: '/tmp/worktree'
  })
  assert(
    invalidWorktree.error?.includes('exactly one') === true,
    'validates worktree branch mode before mutation'
  )

  const reported = await request('agent-report', {
    workspace: 'project',
    surfaceId: 'term-1',
    provider: 'codex',
    state: 'working',
    activity: 'web-search',
    source: 'codex:hooks'
  })
  assert(reported.result?.ok === true, 'accepts a valid agent report')
  assert(applied[0]?.method === 'agent-report', 'routes agent report to the renderer')
  assert(applied[0]?.workspaceId === 'ws-1', 'resolves workspace names before reporting')
  const normalized = applied[0]?.params.report as Record<string, unknown>
  assert(normalized?.workspaceId === 'ws-1', 'normalizes the report to a workspace id')
  assert(normalized?.activity === 'web-search', 'preserves validated activity detail')

  const invalid = await request('agent-report', {
    workspace: 'project',
    surfaceId: 'term-1',
    provider: 'codex',
    state: 'idle',
    activity: 'testing',
    source: 'codex:hooks'
  })
  assert(typeof invalid.error === 'string', 'rejects invalid semantic/detail combinations')
  assert(applied.length === 1, 'does not route rejected reports')

  mirror.agents = [
    {
      agentId: 'codex:hooks:term-1',
      provider: 'codex',
      displayName: 'Codex',
      workspaceId: 'ws-1',
      paneId: 'pane-1',
      surfaceId: 'term-1',
      state: 'blocked',
      blockReason: 'approval',
      source: 'codex:hooks',
      revision: 2,
      updatedAt: 20
    },
    {
      agentId: 'opencode:plugin:term-2',
      provider: 'opencode',
      displayName: 'OpenCode',
      workspaceId: 'ws-1',
      paneId: 'pane-2',
      surfaceId: 'term-2',
      state: 'done',
      source: 'opencode:plugin',
      sessionId: 'session-2',
      revision: 3,
      updatedAt: 30
    }
  ]
  updateWorkspaceMirror(mirror)

  const listed = await request('list-agents', { workspace: 'project' })
  const agents = listed.result?.agents as unknown[]
  assert(agents.length === 2, 'lists agents for a resolved workspace')
  assert(listed.result?.matched === 2, 'reports the total query match count')

  const filtered = await request('list-agents', {
    workspace: 'project',
    provider: 'codex',
    state: 'blocked',
    limit: 1
  })
  const filteredAgents = filtered.result?.agents as Array<Record<string, unknown>>
  assert(filteredAgents.length === 1, 'filters agents by provider and state')
  assert(filteredAgents[0]?.agentId === 'codex:hooks:term-1', 'returns the matching identity')
  const summary = filtered.result?.summary as Record<string, unknown>
  assert(summary?.actionable === 1, 'summarizes actionable query matches')

  const invalidQuery = await request('list-agents', { state: 'busy' })
  assert(invalidQuery.error?.includes('state must be') === true, 'rejects invalid query filters')

  const snapshot = await request('agent-snapshot', { updatedAfter: 20 })
  const snapshotAgents = snapshot.result?.agents as Array<Record<string, unknown>>
  assert(snapshot.result?.version === 1, 'versions reconnect snapshots')
  assert(snapshotAgents.length === 1, 'snapshot applies the shared query filters')
  assert(
    (snapshot.result?.workspaces as unknown[]).length === 1,
    'snapshot includes workspace identity'
  )

  registerTerminalInspection({
    surfaceId: 'term-1',
    workspaceId: 'ws-1',
    pid: process.pid,
    cols: 90,
    rows: 28,
    cwd: '/project',
    createdAt: 10
  })
  appendTerminalInspectionOutput('term-1', '\x1b[32mone\x1b[0m\ntwo\nthree')
  const inspected = await request('inspect-agent', {
    agentId: 'codex:hooks:term-1',
    lines: 2,
    maxBytes: 100
  })
  const terminal = inspected.result?.terminal as Record<string, unknown>
  const output = terminal?.output as Record<string, unknown>
  assert(output?.text === 'two\nthree', 'returns bounded plain-text agent output')
  assert(terminal?.cols === 90 && terminal.rows === 28, 'returns terminal dimensions')
  const invalidInspection = await request('inspect-agent', {
    agentId: 'codex:hooks:term-1',
    lines: 501
  })
  assert(invalidInspection.error?.includes('lines must be') === true, 'bounds inspection lines')
  removeTerminalInspection('term-1')

  const focused = await request('focus-agent', { agentId: 'codex:hooks:term-1' })
  assert(focused.result?.ok === true, 'accepts an existing focus target')
  assert(applied[1]?.method === 'focus-agent', 'routes exact agent focus')

  const waited = await request('wait-agent', {
    agentId: 'codex:hooks:term-1',
    state: 'blocked',
    timeoutMs: 50
  })
  assert(
    (waited.result?.agent as Record<string, unknown>)?.state === 'blocked',
    'resolves an already-satisfied semantic wait'
  )

  const mismatch = await request('agent-clear', {
    agentId: 'codex:hooks:term-1',
    source: 'other:source'
  })
  assert(mismatch.error?.includes('source mismatch') === true, 'protects reporter authority')

  const cleared = await request('agent-clear', {
    agentId: 'codex:hooks:term-1',
    source: 'codex:hooks'
  })
  assert(cleared.result?.ok === true, 'accepts an authorized clear')
  assert(applied[2]?.method === 'agent-clear', 'routes authorized agent clear')

  stopSocketServer()
  if (failures > 0) throw new Error(`${failures} socket test(s) failed`)
  console.log('\n✅ ALL SOCKET TESTS PASS')
}

void main().finally(() => {
  const path = process.env.CMUX_SOCKET_PATH
  if (path && existsSync(path)) unlinkSync(path)
})
