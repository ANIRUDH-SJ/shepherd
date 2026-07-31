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

const socketPath = path.join(os.tmpdir(), `shepherd-rename-test-${process.pid}.sock`)
const cliPath = path.join(__dirname, 'shepherd')

async function main() {
  let request
  const server = net.createServer((connection) => {
    let buffer = ''
    connection.on('data', (chunk) => {
      buffer += chunk.toString()
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      request = JSON.parse(buffer.slice(0, newline))
      connection.end(`${JSON.stringify({ id: request.id, result: { ok: true } })}\n`)
    })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })

  const child = spawn(
    cliPath,
    ['rename-workspace', '--workspace', 'ws-old', '--name', 'build agent'],
    {
      env: {
        ...process.env,
        SHEPHERD_ELECTRON: '',
        SHEPHERD_SOCKET_PATH: socketPath
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
  assert(request?.method === 'rename-workspace', 'sends the rename-workspace method')
  assert(request?.params.workspace === 'ws-old', 'sends the target workspace')
  assert(request?.params.name === 'build agent', 'preserves the new workspace name')

  if (failures > 0) throw new Error(`${failures} rename CLI test(s) failed`)
  console.log('\n✅ ALL WORKSPACE-RENAME CLI TESTS PASS')
}

main().finally(() => {
  try {
    fs.unlinkSync(socketPath)
  } catch {
    // The socket is already gone or was never created.
  }
})
