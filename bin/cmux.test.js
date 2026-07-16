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
  let request
  const server = net.createServer((conn) => {
    let buffer = ''
    conn.on('data', (chunk) => {
      buffer += chunk.toString()
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      request = JSON.parse(buffer.slice(0, newline))
      conn.end(`${JSON.stringify({ id: request.id, result: { ok: true } })}\n`)
    })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })

  const child = spawn(
    cliPath,
    [
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
    ],
    {
      env: {
        ...process.env,
        CMUX_ELECTRON: '',
        CMUX_SOCKET_PATH: socketPath,
        CMUX_WORKSPACE_ID: 'ws-test'
      }
    }
  )

  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })
  const exitCode = await new Promise((resolve) => child.once('exit', resolve))
  server.close()

  assert(exitCode === 0, `CLI exits successfully${stderr ? `: ${stderr}` : ''}`)
  assert(request?.method === 'report-usage', 'sends the report-usage method')
  assert(request?.params.inputTokens === '1200', 'maps --input-tokens to inputTokens')
  assert(request?.params.outputTokens === '300', 'maps --output-tokens to outputTokens')
  assert(request?.params.cachedTokens === '800', 'maps --cached-tokens to cachedTokens')
  assert(request?.params.costUsd === '0.042', 'maps --cost-usd to costUsd')
  assert(request?.params.workspace === 'ws-test', 'defaults to the pane workspace')
  assert(request?.params.accuracy === 'exact', 'preserves accuracy provenance')

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
