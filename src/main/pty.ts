import { app, ipcMain, Notification, shell, type WebContents } from 'electron'
import { statSync } from 'node:fs'
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
  resizeTerminalInspection,
  terminalInspectionMemorySnapshot
} from './terminalInspection'
import { TerminalOutputBatcher } from './terminalOutputBatcher'
import { TerminalOwnershipRegistry } from './terminalOwnership'
import {
  IPC,
  isTermDataAck,
  type TermCreateOptions,
  type TermInput,
  type TermResize
} from '../shared/ipc'
import {
  isOpenTerminalLinkRequest,
  isResolveTerminalFileLinksRequest,
  type OpenTerminalLinkResult
} from '../shared/terminalLinks'
import type { RuntimePerformanceMarkName } from '../shared/runtimePerformance'
import {
  TERMINAL_MEMORY_LOG_PREFIX,
  terminalMemoryDiagnosticsEnabled,
  type TerminalMemorySnapshot,
  type TerminalMemorySnapshotReason
} from '../shared/terminalMemory'
import { PRODUCT_ENV } from '../shared/product'
import {
  openTerminalLinkTarget,
  readTerminalShellCwd,
  terminalFileReferencesExist,
  type TerminalLinkDependencies
} from './terminalLinks'

// ─────────────────────────────────────────────────────────────────────────────
// PTY MANAGER  (main process — the "real shell" half of the terminal)
// Spawns shells attached to pseudo-terminals, pipes their output to the renderer,
// and feeds keystrokes back in. One entry exists per terminal id.
// ─────────────────────────────────────────────────────────────────────────────

/** Per-terminal state: the shell process, the workspace it belongs to (so OSC
 *  notifications route to the right sidebar row), and a buffer for OSC codes that
 *  split across reads. */
interface TerminalRec {
  proc: pty.IPty
  sender: WebContents
  workspaceId?: string
  oscBuffer: string
  output: TerminalOutputBatcher
  dataSubscription?: pty.IDisposable
  exitSubscription?: pty.IDisposable
}

function subscribeTerminalOwnerLoss(owner: WebContents, listener: () => void): () => void {
  const onDestroyed = (): void => listener()
  const onRendererGone = (): void => listener()
  owner.once('destroyed', onDestroyed)
  owner.once('render-process-gone', onRendererGone)
  return () => {
    owner.removeListener('destroyed', onDestroyed)
    owner.removeListener('render-process-gone', onRendererGone)
  }
}

const terminals = new TerminalOwnershipRegistry<WebContents, TerminalRec>({
  subscribeOwnerLoss: subscribeTerminalOwnerLoss,
  onOwnerLost: (id, terminal) => disposeTerminal(id, terminal, false, 'owner-lost')
})
const memoryDiagnosticsEnabled = terminalMemoryDiagnosticsEnabled(process.env)
const terminalLinkDependencies: TerminalLinkDependencies = {
  homeDirectory: homedir,
  pathKind: (path) => {
    try {
      const stats = statSync(path)
      if (stats.isFile()) return 'file'
      if (stats.isDirectory()) return 'directory'
    } catch {
      // Link candidates are expected to disappear or fail validation sometimes.
    }
    return null
  },
  openExternal: (url) => shell.openExternal(url),
  openPath: (path) => shell.openPath(path)
}

function reportTerminalMemory(reason: TerminalMemorySnapshotReason): void {
  if (!memoryDiagnosticsEnabled) return
  const ownership = terminals.snapshot()
  const inspection = terminalInspectionMemorySnapshot()
  let pendingOutputBytes = 0
  let inFlightOutputBytes = 0
  let pausedTerminalCount = 0
  for (const [, terminal] of terminals.entries()) {
    const output = terminal.output.memorySnapshot()
    pendingOutputBytes += output.pendingBytes
    inFlightOutputBytes += output.inFlightBytes
    if (output.paused) pausedTerminalCount++
  }
  const snapshot: TerminalMemorySnapshot = {
    schemaVersion: 1,
    reason,
    timestamp: Date.now(),
    terminalCount: ownership.terminalCount,
    ownerCount: ownership.ownerCount,
    inspectionTerminalCount: inspection.terminalCount,
    inspectionRetainedBytes: inspection.retainedBytes,
    inspectionDroppedBytes: inspection.droppedBytes,
    pendingOutputBytes,
    inFlightOutputBytes,
    pausedTerminalCount
  }
  try {
    console.log(`${TERMINAL_MEMORY_LOG_PREFIX} ${JSON.stringify(snapshot)}`)
  } catch {
    // Diagnostics must not affect terminal creation or cleanup.
  }
}

/** Pick a shell: the user's $SHELL, else a sensible platform default. */
function defaultShell(): string {
  if (process.env.SHELL) return process.env.SHELL
  return platform() === 'win32' ? 'powershell.exe' : 'bash'
}

/** Where the bundled Shepherd CLI lives: the unpacked resources dir once packaged,
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
  const previous = terminals.getOwned(opts.id, sender)
  if (terminals.has(opts.id) && !previous) {
    throw new Error('terminal id belongs to another renderer')
  }
  if (previous) disposeTerminal(opts.id, previous, true, 'replaced')

  // Inject the new Shepherd environment and its compatibility aliases so CLI
  // commands inside a pane target that pane without breaking existing hooks.
  const env = currentEnv()
  env[PRODUCT_ENV.surfaceId] = opts.id
  env[PRODUCT_ENV.legacySurfaceId] = opts.id
  if (opts.workspaceId) {
    env[PRODUCT_ENV.workspaceId] = opts.workspaceId
    env[PRODUCT_ENV.legacyWorkspaceId] = opts.workspaceId
  }
  const activeSocketPath = socketPath()
  env[PRODUCT_ENV.socketPath] = activeSocketPath
  env[PRODUCT_ENV.legacySocketPath] = activeSocketPath
  // Make the CLI resolvable inside panes, and hand it our Electron binary so it
  // runs without a system Node. Never append to an empty
  // PATH: the trailing colon would leave an empty element, which POSIX reads as
  // the current directory — so the shell would search cwd for commands.
  const parentPath = env.PATH
  env.PATH = parentPath ? `${cliBinDir()}:${parentPath}` : cliBinDir()
  env[PRODUCT_ENV.electron] = process.execPath
  env[PRODUCT_ENV.legacyElectron] = process.execPath

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
  const output = new TerminalOutputBatcher({
    send: (data, sequence) => {
      appendTerminalInspectionOutput(opts.id, data)
      let expectsAcknowledgement = false
      if (!sender.isDestroyed()) {
        try {
          sender.send(IPC.TERM_DATA, { id: opts.id, data, sequence })
          expectsAcknowledgement = true
        } catch {
          // The window can close between isDestroyed() and send().
        }
      }
      sniffOsc(opts.id, sender, data)
      return expectsAcknowledgement
    },
    pause: () => proc.pause(),
    resume: () => proc.resume()
  })
  const terminal: TerminalRec = {
    proc,
    sender,
    workspaceId: opts.workspaceId,
    oscBuffer: '',
    output
  }
  terminals.add(opts.id, sender, terminal)
  registerTerminalInspection({
    surfaceId: opts.id,
    ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}),
    pid: proc.pid,
    cols,
    rows,
    cwd
  })
  reportTerminalMemory('created')

  // Shell output is coalesced into bounded, acknowledged renderer batches. The
  // first chunk bypasses the timer so startup and prompt latency stay direct.
  if (markPerformance && opts.startupPerformanceCandidate) {
    let waitingForFirstOutput = true
    terminal.dataSubscription = proc.onData((data) => {
      if (waitingForFirstOutput) {
        waitingForFirstOutput = false
        markPerformance('pty-first-output')
      }
      output.push(data)
    })
  } else {
    terminal.dataSubscription = proc.onData((data) => output.push(data))
  }

  // Shell exited → tell the renderer, then forget it.
  terminal.exitSubscription = proc.onExit(({ exitCode }) => {
    if (terminals.get(opts.id) !== terminal) return
    terminal.dataSubscription?.dispose()
    terminal.exitSubscription?.dispose()
    output.drain()
    if (!sender.isDestroyed()) {
      try {
        sender.send(IPC.TERM_EXIT, { id: opts.id, exitCode })
      } catch {
        // Cleanup still has to run if the window closes during process exit.
      }
    }
    output.dispose()
    terminals.remove(opts.id, terminal)
    removeTerminalInspection(opts.id)
    reportTerminalMemory('exited')
  })
}

function disposeTerminal(
  id: string,
  terminal: TerminalRec,
  flushPendingOutput: boolean,
  reason: TerminalMemorySnapshotReason
): void {
  terminal.dataSubscription?.dispose()
  terminal.exitSubscription?.dispose()
  if (flushPendingOutput) terminal.output.drain()
  terminal.output.dispose()
  try {
    terminal.proc.kill()
  } catch {
    // The PTY may have exited between lookup and explicit disposal.
  }
  terminals.remove(id, terminal)
  removeTerminalInspection(id)
  reportTerminalMemory(reason)
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
        params: {
          title: n.title,
          body: n.body,
          surfaceId: id,
          notificationSource: 'osc',
          createdAt: Date.now()
        }
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
  ipcMain.on(IPC.TERM_INPUT, (event, msg: TermInput) => {
    const terminal = terminals.getOwned(msg.id, event.sender)
    if (!terminal) return
    recordTerminalInspectionInput(msg.id)
    terminal.output.markInteractive()
    terminal.proc.write(msg.data)
  })

  // Renderer confirms xterm consumed a sequenced batch. Unknown, duplicate, or
  // cross-window acknowledgements cannot release another terminal's queue.
  ipcMain.on(IPC.TERM_DATA_ACK, (event, msg: unknown) => {
    if (!isTermDataAck(msg)) return
    terminals.getOwned(msg.id, event.sender)?.output.acknowledge(msg.sequence)
  })

  // Resolve syntactic file references lazily when xterm asks about a hovered
  // line. The requesting renderer must own the PTY, and relative paths use the
  // shell's live cwd rather than stale renderer state.
  ipcMain.handle(IPC.TERM_RESOLVE_FILE_LINKS, (event, request: unknown): boolean[] => {
    if (!isResolveTerminalFileLinksRequest(request)) return []
    const terminal = terminals.getOwned(request.id, event.sender)
    if (!terminal) return request.candidates.map(() => false)
    const cwd = readTerminalShellCwd(terminal.proc.pid)
    if (!cwd) return request.candidates.map(() => false)
    return terminalFileReferencesExist(request.candidates, cwd, terminalLinkDependencies)
  })

  // Revalidate on activation because files and cwd can change between hover and
  // Ctrl-click. Electron's shell APIs receive argv-free values; no shell runs.
  ipcMain.handle(
    IPC.TERM_OPEN_LINK,
    async (event, request: unknown): Promise<OpenTerminalLinkResult> => {
      if (!isOpenTerminalLinkRequest(request)) return { ok: false, error: 'invalid-request' }
      const terminal = terminals.getOwned(request.id, event.sender)
      if (!terminal) return { ok: false, error: 'terminal-not-found' }
      const cwd = readTerminalShellCwd(terminal.proc.pid) ?? ''
      return openTerminalLinkTarget(request.target, cwd, terminalLinkDependencies)
    }
  )

  // fire-and-forget: resize
  ipcMain.on(IPC.TERM_RESIZE, (event, msg: TermResize) => {
    const terminal = terminals.getOwned(msg.id, event.sender)
    if (!terminal) return
    const cols = Math.max(1, msg.cols)
    const rows = Math.max(1, msg.rows)
    terminal.proc.resize(cols, rows)
    resizeTerminalInspection(msg.id, cols, rows)
  })

  // fire-and-forget: kill one shell
  ipcMain.on(IPC.TERM_DISPOSE, (event, id: string) => {
    const terminal = terminals.getOwned(id, event.sender)
    if (terminal) disposeTerminal(id, terminal, true, 'disposed')
  })
}

/** Kill every shell — called on quit so we never leave zombie processes. */
export function killAllTerminals(): void {
  for (const [id, terminal] of terminals.clear()) {
    disposeTerminal(id, terminal, false, 'shutdown')
  }
  clearTerminalInspections()
}
