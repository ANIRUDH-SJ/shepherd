import { app, ipcMain, Notification, type WebContents } from 'electron'
import * as pty from 'node-pty'
import { homedir, platform } from 'os'
import { join } from 'path'
import { socketPath } from './socket'
import { parseOsc } from './osc'
import {
  appendTerminalInspectionOutput,
  clearTerminalInspections,
  registerTerminalInspection,
  recordTerminalInspectionInput,
  removeTerminalInspection,
  resizeTerminalInspection
} from './terminalInspection'
import { IPC, type TermCreateOptions, type TermInput, type TermResize } from '../shared/ipc'
import type { RuntimePerformanceMarkName } from '../shared/runtimePerformance'

// ─────────────────────────────────────────────────────────────────────────────
// PTY MANAGER  (main process — the "real shell" half of the terminal)
// Spawns shells attached to pseudo-terminals, pipes their output to the renderer,
// and feeds keystrokes back in. One entry per terminal id. See textbook/06.
// ─────────────────────────────────────────────────────────────────────────────

/** Per-terminal state: the shell process, the workspace it belongs to (so OSC
 *  notifications route to the right sidebar row), and a buffer for OSC codes that
 *  split across reads. */
interface TerminalRec {
  proc: pty.IPty
  workspaceId?: string
  oscBuffer: string
}
const terminals = new Map<string, TerminalRec>()

/** Pick a shell: the user's $SHELL, else a sensible platform default. */
function defaultShell(): string {
  if (process.env.SHELL) return process.env.SHELL
  return platform() === 'win32' ? 'powershell.exe' : 'bash'
}

/** Where the bundled `cmux` CLI lives: the unpacked resources dir once packaged,
 *  the repo's bin/ in dev. `process.cwd()` is useless here — a packaged app
 *  inherits whatever directory the user launched it from. */
function cliBinDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'bin') : join(app.getAppPath(), 'bin')
}

/** A clean env for the child (drop undefined values node-pty can't use). */
function currentEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value
  }
  return env
}

/** Spawn a shell and stream its output to the window that asked for it. */
function createTerminal(
  sender: WebContents,
  opts: TermCreateOptions,
  markPerformance?: (name: RuntimePerformanceMarkName) => void
): void {
  // Defensive: if this id already has a shell, kill the old one first.
  terminals.get(opts.id)?.proc.kill()
  removeTerminalInspection(opts.id)

  // Inject cmux env so a `cmux …` command run INSIDE this pane targets the right
  // workspace by default and can reach the socket. (textbook/11 §env injection)
  const env = currentEnv()
  env.CMUX_SURFACE_ID = opts.id
  if (opts.workspaceId) env.CMUX_WORKSPACE_ID = opts.workspaceId
  env.CMUX_SOCKET_PATH = socketPath()
  // Make the `cmux` CLI resolvable inside panes, and hand it our Electron binary
  // so it runs without a system Node (see bin/cmux). Never append to an empty
  // PATH: the trailing colon would leave an empty element, which POSIX reads as
  // the current directory — so the shell would search cwd for commands.
  const parentPath = env.PATH
  env.PATH = parentPath ? `${cliBinDir()}:${parentPath}` : cliBinDir()
  env.CMUX_ELECTRON = process.execPath

  const cols = opts.cols || 80
  const rows = opts.rows || 24
  const cwd = !opts.cwd || opts.cwd === '~' ? homedir() : opts.cwd
  const proc = pty.spawn(defaultShell(), [], {
    name: 'xterm-color',
    cols,
    rows,
    cwd,
    env
  })
  if (opts.startupPerformanceCandidate) markPerformance?.('pty-spawned')
  terminals.set(opts.id, { proc, workspaceId: opts.workspaceId, oscBuffer: '' })
  registerTerminalInspection({
    surfaceId: opts.id,
    ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}),
    pid: proc.pid,
    cols,
    rows,
    cwd
  })

  // Shell output → renderer (guard against a closed window), then sniff for OSC
  // notification codes (a copy — the raw data still goes to xterm untouched).
  const forwardData = (data: string): void => {
    appendTerminalInspectionOutput(opts.id, data)
    if (!sender.isDestroyed()) sender.send(IPC.TERM_DATA, { id: opts.id, data })
    sniffOsc(opts.id, sender, data)
  }
  if (markPerformance && opts.startupPerformanceCandidate) {
    let waitingForFirstOutput = true
    proc.onData((data) => {
      if (waitingForFirstOutput) {
        waitingForFirstOutput = false
        markPerformance('pty-first-output')
      }
      forwardData(data)
    })
  } else {
    proc.onData(forwardData)
  }

  // Shell exited → tell the renderer, then forget it.
  proc.onExit(({ exitCode }) => {
    if (!sender.isDestroyed()) sender.send(IPC.TERM_EXIT, { id: opts.id, exitCode })
    if (terminals.get(opts.id)?.proc === proc) {
      terminals.delete(opts.id)
      removeTerminalInspection(opts.id)
    }
  })
}

/** Sniff a chunk of output for OSC notifications and route each one to the sidebar
 *  (the same `notify` path the socket uses) plus a desktop toast. See osc.ts. */
function sniffOsc(id: string, sender: WebContents, data: string): void {
  const rec = terminals.get(id)
  if (!rec) return
  const { notifications, rest } = parseOsc(rec.oscBuffer + data)
  rec.oscBuffer = rest
  for (const n of notifications) {
    if (!sender.isDestroyed()) {
      sender.send(IPC.SOCKET_COMMAND, {
        method: 'notify',
        workspaceId: rec.workspaceId ?? null,
        params: { title: n.title, body: n.body }
      })
    }
    if (Notification.isSupported()) new Notification({ title: n.title, body: n.body }).show()
  }
}

/** Register every terminal IPC handler. Call once at startup. */
export function registerPtyIpc(markPerformance?: (name: RuntimePerformanceMarkName) => void): void {
  // request/response: spawn a shell
  ipcMain.handle(IPC.TERM_CREATE, (event, opts: TermCreateOptions) => {
    if (opts.startupPerformanceCandidate) markPerformance?.('pty-spawn-requested')
    createTerminal(event.sender, opts, markPerformance)
  })

  // fire-and-forget: keystrokes in
  ipcMain.on(IPC.TERM_INPUT, (_event, msg: TermInput) => {
    recordTerminalInspectionInput(msg.id)
    terminals.get(msg.id)?.proc.write(msg.data)
  })

  // fire-and-forget: resize
  ipcMain.on(IPC.TERM_RESIZE, (_event, msg: TermResize) => {
    const cols = Math.max(1, msg.cols)
    const rows = Math.max(1, msg.rows)
    terminals.get(msg.id)?.proc.resize(cols, rows)
    resizeTerminalInspection(msg.id, cols, rows)
  })

  // fire-and-forget: kill one shell
  ipcMain.on(IPC.TERM_DISPOSE, (_event, id: string) => {
    terminals.get(id)?.proc.kill()
    terminals.delete(id)
    removeTerminalInspection(id)
  })
}

/** Kill every shell — called on quit so we never leave zombie processes. */
export function killAllTerminals(): void {
  for (const rec of terminals.values()) rec.proc.kill()
  terminals.clear()
  clearTerminalInspections()
}
