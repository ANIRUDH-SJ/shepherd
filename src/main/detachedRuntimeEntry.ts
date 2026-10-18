import { spawn } from 'node-pty'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { createDetachedRuntimeServer } from './detachedRuntimeServer'
import {
  DetachedRuntimeState,
  type RuntimeCreateOptions,
  type RuntimeProcess
} from './detachedRuntimeState'
import { PRODUCT_ENV } from '../shared/product'

/** A separate Node-mode Electron process can own PTYs independently of the UI.
 * This entry has no Electron app import or renderer state. */
function spawnTerminal(options: RuntimeCreateOptions): RuntimeProcess {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string' && key !== 'SHEPHERD_RUNTIME_TOKEN') env[key] = value
  }
  env[PRODUCT_ENV.surfaceId] = options.id
  env[PRODUCT_ENV.legacySurfaceId] = options.id
  if (options.workspaceId) {
    env[PRODUCT_ENV.workspaceId] = options.workspaceId
    env[PRODUCT_ENV.legacyWorkspaceId] = options.workspaceId
  }
  const cliDirectory = process.env.SHEPHERD_RUNTIME_CLI_DIR
  if (cliDirectory) env.PATH = env.PATH ? `${cliDirectory}:${env.PATH}` : cliDirectory
  const commandSocket = process.env.SHEPHERD_RUNTIME_COMMAND_SOCKET
  if (commandSocket) {
    env[PRODUCT_ENV.socketPath] = commandSocket
    env[PRODUCT_ENV.legacySocketPath] = commandSocket
  }
  const electronPath = process.env.SHEPHERD_RUNTIME_ELECTRON
  if (electronPath) {
    env[PRODUCT_ENV.electron] = electronPath
    env[PRODUCT_ENV.legacyElectron] = electronPath
  }
  const cwd = options.cwd && options.cwd !== '~' ? resolve(options.cwd) : homedir()
  const proc = spawn(process.env.SHELL || 'bash', [], {
    name: 'xterm-color',
    cols: options.cols,
    rows: options.rows,
    cwd,
    env
  })
  return {
    pid: proc.pid,
    write: (data) => proc.write(data),
    resize: (cols, rows) => proc.resize(cols, rows),
    kill: () => proc.kill(),
    onData: (listener) => proc.onData(listener),
    onExit: (listener) => proc.onExit(({ exitCode }) => listener(exitCode))
  }
}

const socketPath = process.env.SHEPHERD_RUNTIME_SOCKET
const token = process.env.SHEPHERD_RUNTIME_TOKEN
if (!socketPath || !token) throw new Error('runtime socket and token are required')

const runtime = new DetachedRuntimeState(spawnTerminal)
const server = createDetachedRuntimeServer(socketPath, token, runtime)
server.listen(socketPath)
server.on('error', (error) => {
  console.error('[runtime] socket failed:', error)
  process.exitCode = 1
})
