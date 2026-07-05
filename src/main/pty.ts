import { ipcMain, type WebContents } from 'electron'
import * as pty from 'node-pty'
import { homedir, platform } from 'os'
import {
  IPC,
  type TermCreateOptions,
  type TermInput,
  type TermResize
} from '../shared/ipc'

// ─────────────────────────────────────────────────────────────────────────────
// PTY MANAGER  (main process — the "real shell" half of the terminal)
// Spawns shells attached to pseudo-terminals, pipes their output to the renderer,
// and feeds keystrokes back in. One entry per terminal id. See textbook/06.
// ─────────────────────────────────────────────────────────────────────────────

/** One live shell process per terminal id. */
const terminals = new Map<string, pty.IPty>()

/** Pick a shell: the user's $SHELL, else a sensible platform default. */
function defaultShell(): string {
  if (process.env.SHELL) return process.env.SHELL
  return platform() === 'win32' ? 'powershell.exe' : 'bash'
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
function createTerminal(sender: WebContents, opts: TermCreateOptions): void {
  // Defensive: if this id already has a shell, kill the old one first.
  terminals.get(opts.id)?.kill()

  const proc = pty.spawn(defaultShell(), [], {
    name: 'xterm-color',
    cols: opts.cols || 80,
    rows: opts.rows || 24,
    cwd: opts.cwd || homedir(),
    env: currentEnv()
  })
  terminals.set(opts.id, proc)

  // Shell output → renderer (guard against a closed window).
  proc.onData((data) => {
    if (!sender.isDestroyed()) sender.send(IPC.TERM_DATA, { id: opts.id, data })
  })

  // Shell exited → tell the renderer, then forget it.
  proc.onExit(({ exitCode }) => {
    if (!sender.isDestroyed()) sender.send(IPC.TERM_EXIT, { id: opts.id, exitCode })
    terminals.delete(opts.id)
  })
}

/** Register every terminal IPC handler. Call once at startup. */
export function registerPtyIpc(): void {
  // request/response: spawn a shell
  ipcMain.handle(IPC.TERM_CREATE, (event, opts: TermCreateOptions) => {
    createTerminal(event.sender, opts)
  })

  // fire-and-forget: keystrokes in
  ipcMain.on(IPC.TERM_INPUT, (_event, msg: TermInput) => {
    terminals.get(msg.id)?.write(msg.data)
  })

  // fire-and-forget: resize
  ipcMain.on(IPC.TERM_RESIZE, (_event, msg: TermResize) => {
    terminals.get(msg.id)?.resize(Math.max(1, msg.cols), Math.max(1, msg.rows))
  })

  // fire-and-forget: kill one shell
  ipcMain.on(IPC.TERM_DISPOSE, (_event, id: string) => {
    terminals.get(id)?.kill()
    terminals.delete(id)
  })
}

/** Kill every shell — called on quit so we never leave zombie processes. */
export function killAllTerminals(): void {
  for (const proc of terminals.values()) proc.kill()
  terminals.clear()
}
