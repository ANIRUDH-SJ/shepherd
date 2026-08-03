// ─────────────────────────────────────────────────────────────────────────────

import type { AgentRecord } from './agent'
import type { RendererRuntimePerformanceMarkName } from './runtimePerformance'
import type {
  OpenTerminalLinkRequest,
  OpenTerminalLinkResult,
  ResolveTerminalFileLinksRequest
} from './terminalLinks'
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
  TERM_DATA_ACK: 'terminal:data-ack',
  TERM_RESOLVE_FILE_LINKS: 'terminal:resolve-file-links',
  TERM_OPEN_LINK: 'terminal:open-link',
  PREVIEW_OPEN_EXTERNAL: 'preview:open-external',
  // main → renderer  (push via webContents.send / ipcRenderer.on)
  TERM_DATA: 'terminal:data',
  TERM_EXIT: 'terminal:exit',
  // app ⇄ socket
  SOCKET_COMMAND: 'socket:command', // main → renderer
  WORKSPACES_SYNC: 'workspaces:sync', // renderer → main
  // session persistence
  SESSION_LOAD_SYNC: 'session:load', // renderer → main (synchronous, once at startup)
  SESSION_SAVE: 'session:save', // renderer → main (debounced)
  // one-shot startup lifecycle
  STARTUP_FIRST_TERMINAL_READY: 'startup:first-terminal-ready', // renderer → main
  // opt-in startup diagnostics
  PERFORMANCE_MARK: 'performance:mark' // renderer → main
} as const

// ── Message payloads ─────────────────────────────────────────────────────────

/** Ask the backend to spawn a shell. `id` is minted by the renderer. */
export interface TermCreateOptions {
  id: string
  workspaceId?: string
  cols: number
  rows: number
  cwd?: string
  startupPerformanceCandidate?: boolean
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
  sequence?: number
}

/** Renderer confirmation that xterm consumed one output batch. */
export interface TermDataAck {
  id: string
  sequence: number
}

export function isTermDataAck(value: unknown): value is TermDataAck {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<TermDataAck>
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    candidate.id.length <= 256 &&
    typeof candidate.sequence === 'number' &&
    Number.isSafeInteger(candidate.sequence) &&
    candidate.sequence > 0
  )
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
  workspaces: { id: string; name: string; activeSurfaceId?: string }[]
  activeWorkspaceId: string
  agents: AgentRecord[]
}

export type PreviewOpenExternalResult = { ok: true } | { ok: false; error: string }

// ── The bridge surface exposed as `window.api` (implemented in preload) ───────
export interface ShepherdApi {
  version: string
  terminal: {
    /** Spawn a shell bound to `opts.id`. */
    create(opts: TermCreateOptions): Promise<void>
    /** Send keystrokes to a shell. */
    input(msg: TermInput): void
    /** Tell a shell its terminal was resized. */
    resize(msg: TermResize): void
    /** Check which syntactic file references currently resolve for this shell. */
    resolveFileLinks(request: ResolveTerminalFileLinksRequest): Promise<boolean[]>
    /** Open one validated URL or local file reference. */
    openLink(request: OpenTerminalLinkRequest): Promise<OpenTerminalLinkResult>
    /** Kill a shell and forget it. */
    dispose(id: string): void
    /** Subscribe to a shell's output. Returns an unsubscribe function. */
    onData(id: string, cb: (data: string, acknowledge: () => void) => void): () => void
    /** Subscribe to a shell's exit. Returns an unsubscribe function. */
    onExit(id: string, cb: (exitCode: number) => void): () => void
  }
  preview: {
    /** Open one validated loopback preview URL in the system browser. */
    openExternal(url: string): Promise<PreviewOpenExternalResult>
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
  startup: {
    /** Report that the first focused xterm and PTY are ready for interaction. */
    firstTerminalReady(): void
  }
  performance: {
    /** True only when product performance diagnostics were enabled before launch. */
    enabled: boolean
    /** Report one of the fixed, content-free startup milestones. */
    mark(name: RendererRuntimePerformanceMarkName): void
  }
}
