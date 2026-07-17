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

  async function runCli(args) {
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
