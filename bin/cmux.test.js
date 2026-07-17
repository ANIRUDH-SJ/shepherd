'use strict'
const net = require('net')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

let failures = 0
function assert(condition, message) {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

const socketPath = path.join(os.tmpdir(), `cmux-cli-test-${process.pid}.sock`)
const cliPath = path.join(__dirname, 'cmux')

async function main() {
  const requests = []
  const server = net.createServer((conn) => {
    let buffer = ''
    conn.on('data', (chunk) => {
      buffer += chunk.toString()
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      const request = JSON.parse(buffer.slice(0, newline))
      requests.push(request)
      conn.end(`${JSON.stringify({ id: request.id, result: { ok: true } })}\n`)
    })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })

  async function runCli(args, input) {
    const child = spawn(cliPath, args, {
      env: {
        ...process.env,
        CMUX_ELECTRON: '',
        CMUX_SOCKET_PATH: socketPath,
        CMUX_WORKSPACE_ID: 'ws-test',
        CMUX_SURFACE_ID: 'term-test'
      }
    })

    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    if (input !== undefined) child.stdin.end(input)
    const exitCode = await new Promise((resolve) => child.once('exit', resolve))
    assert(exitCode === 0, `CLI exits successfully${stderr ? `: ${stderr}` : ''}`)
  }

  await runCli([
    'report-usage',
    '--input-tokens',
    '1200',
    '--output-tokens',
    '300',
    '--cached-tokens',
    '800',
    '--cost-usd',
    '0.042',
    '--accuracy',
    'exact',
    '--provider',
    'provider-a',
    '--model',
    'model-a'
  ])
  const usage = requests[0]
  assert(usage?.method === 'report-usage', 'sends the report-usage method')
  assert(usage?.params.inputTokens === '1200', 'maps --input-tokens to inputTokens')
  assert(usage?.params.outputTokens === '300', 'maps --output-tokens to outputTokens')
  assert(usage?.params.cachedTokens === '800', 'maps --cached-tokens to cachedTokens')
  assert(usage?.params.costUsd === '0.042', 'maps --cost-usd to costUsd')
  assert(usage?.params.workspace === 'ws-test', 'defaults to the pane workspace')
  assert(usage?.params.accuracy === 'exact', 'preserves accuracy provenance')

  await runCli([
    'agent-report',
    '--provider',
    'codex',
    '--state',
    'working',
    '--activity',
    'web-search',
    '--message',
    'researching APIs'
  ])
  const report = requests[1]
  assert(report?.method === 'agent-report', 'sends the agent-report method')
  assert(report?.params.provider === 'codex', 'preserves the agent provider')
  assert(report?.params.state === 'working', 'preserves semantic state')
  assert(report?.params.activity === 'web-search', 'preserves activity detail')
  assert(report?.params.source === 'cli:codex', 'derives a CLI reporter source')
  assert(report?.params.surfaceId === 'term-test', 'targets the calling terminal surface')

  await runCli(['focus-agent', 'codex:term-test'])
  const focus = requests[2]
  assert(focus?.method === 'focus-agent', 'sends the focus-agent method')
  assert(focus?.params.agentId === 'codex:term-test', 'maps positional agent id')

  await runCli(['wait-agent', 'codex:term-test', '--state', 'done', '--timeout-ms', '100'])
  const wait = requests[3]
  assert(wait?.method === 'wait-agent', 'sends the wait-agent method')
  assert(wait?.params.agentId === 'codex:term-test', 'targets the requested agent wait')
  assert(wait?.params.state === 'done', 'preserves the requested wait state')

  await runCli([
    'list-agents',
    '--provider',
    'codex,claude',
    '--state',
    'blocked,done',
    '--updated-after',
    '100',
    '--limit',
    '25'
  ])
  const list = requests[4]
  assert(list?.method === 'list-agents', 'sends the filtered agent-list method')
  assert(list?.params.provider === 'codex,claude', 'preserves provider query values')
  assert(list?.params.state === 'blocked,done', 'preserves semantic-state query values')
  assert(list?.params.updatedAfter === '100', 'maps the update cursor')
  assert(list?.params.limit === '25', 'maps the query result limit')

  await runCli(['agent-snapshot', '--session-id', 'session-1'])
  const snapshot = requests[5]
  assert(snapshot?.method === 'agent-snapshot', 'sends the agent snapshot method')
  assert(snapshot?.params.sessionId === 'session-1', 'maps the provider session filter')

  await runCli(['agent-schema'])
  const schema = requests[6]
  assert(schema?.method === 'agent-schema', 'requests the machine-readable agent schema')

  await runCli(['agent-capabilities', 'codex'])
  const capabilities = requests[7]
  assert(capabilities?.method === 'agent-capabilities', 'requests agent capabilities')
  assert(capabilities?.params.provider === 'codex', 'maps the positional capability provider')

  await runCli(['inspect-agent', 'codex:term-test', '--lines', '25', '--max-bytes', '4096'])
  const inspection = requests[8]
  assert(inspection?.method === 'inspect-agent', 'requests bounded agent inspection')
  assert(inspection?.params.agentId === 'codex:term-test', 'maps the inspected agent id')
  assert(inspection?.params.lines === '25', 'maps the inspection line limit')
  assert(inspection?.params.maxBytes === '4096', 'maps the inspection byte limit')

  await runCli(
    ['agent-hook', 'codex'],
    JSON.stringify({
      hook_event_name: 'PermissionRequest',
      session_id: 'session-1',
      tool_name: 'Bash'
    })
  )
  const hook = requests[9]
  assert(hook?.method === 'agent-report', 'hook event becomes an agent report')
  assert(hook?.params.provider === 'codex', 'hook preserves provider identity')
  assert(hook?.params.state === 'blocked', 'permission hook reports blocked')
  assert(hook?.params.blockReason === 'approval', 'permission hook reports approval reason')
  assert(hook?.params.sessionId === 'session-1', 'hook preserves native session id')

  await new Promise((resolve) => server.close(resolve))

  if (failures > 0) throw new Error(`${failures} CLI test(s) failed`)
  console.log('\n✅ ALL CLI TESTS PASS')
}

main().finally(() => {
  try {
    fs.unlinkSync(socketPath)
  } catch {
    // The socket is already gone or was never created.
  }
})
