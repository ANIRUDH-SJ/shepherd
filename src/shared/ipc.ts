// ─────────────────────────────────────────────────────────────────────────────

import type { AgentRecord } from './agent'
// SHARED IPC CONTRACT
// Imported by ALL THREE sides (main, preload, renderer) so they agree on channel
// names and message shapes. Types here are compile-time only — they vanish at
// runtime, so payloads crossing IPC are still plain JSON (see textbook/09).
// ─────────────────────────────────────────────────────────────────────────────

/** Channel names. Grouped by direction so it's obvious who sends what. */
export const IPC = {
  // renderer → main  (request/response via invoke/handle)
  TERM_CREATE: 'terminal:create',
  // renderer → main  (fire-and-forget via send/on)
  TERM_INPUT: 'terminal:input',
  TERM_RESIZE: 'terminal:resize',
  TERM_DISPOSE: 'terminal:dispose',
  // main → renderer  (push via webContents.send / ipcRenderer.on)
  TERM_DATA: 'terminal:data',
  TERM_EXIT: 'terminal:exit',
  // app ⇄ socket
  SOCKET_COMMAND: 'socket:command', // main → renderer
  WORKSPACES_SYNC: 'workspaces:sync', // renderer → main
  // session persistence
  SESSION_LOAD_SYNC: 'session:load', // renderer → main (synchronous, once at startup)
  SESSION_SAVE: 'session:save' // renderer → main (debounced)
} as const

// ── Message payloads ─────────────────────────────────────────────────────────

/** Ask the backend to spawn a shell. `id` is minted by the renderer. */
export interface TermCreateOptions {
  id: string
  workspaceId?: string
  cols: number
  rows: number
  cwd?: string
}

/** A chunk of keystrokes headed for a shell. */
export interface TermInput {
  id: string
  data: string
}

/** The terminal was resized; the shell needs the new grid size. */
export interface TermResize {
  id: string
  cols: number
  rows: number
}

/** A chunk of shell output headed for the terminal UI. */
export interface TermData {
  id: string
  data: string
}

/** A shell exited. */
export interface TermExit {
  id: string
  exitCode: number
}

/** A socket command routed from main to the renderer to apply to app state. */
export interface SocketApply {
  method: string
  workspaceId: string | null
  params: Record<string, unknown>
}

/** The renderer's workspace list, mirrored to main so the socket can resolve ids/names. */
export interface WorkspacesSync {
  workspaces: { id: string; name: string }[]
  activeWorkspaceId: string
  agents: AgentRecord[]
}

// ── The bridge surface exposed as `window.api` (implemented in preload) ───────
export interface CmuxApi {
  version: string
  terminal: {
    /** Spawn a shell bound to `opts.id`. */
    create(opts: TermCreateOptions): Promise<void>
    /** Send keystrokes to a shell. */
    input(msg: TermInput): void
    /** Tell a shell its terminal was resized. */
    resize(msg: TermResize): void
    /** Kill a shell and forget it. */
    dispose(id: string): void
    /** Subscribe to a shell's output. Returns an unsubscribe function. */
    onData(id: string, cb: (data: string) => void): () => void
    /** Subscribe to a shell's exit. Returns an unsubscribe function. */
    onExit(id: string, cb: (exitCode: number) => void): () => void
  }
  socket: {
    /** Mirror the renderer's workspace list to main (for id/name resolution). */
    syncWorkspaces(sync: WorkspacesSync): void
    /** Subscribe to socket commands routed from main. Returns an unsubscribe fn. */
    onCommand(cb: (cmd: SocketApply) => void): () => void
  }
  session: {
    /** Load the saved session synchronously at startup (null if none). */
    loadSync(): unknown
    /** Persist the current app state (called debounced on change). */
    save(state: unknown): void
  }
}
