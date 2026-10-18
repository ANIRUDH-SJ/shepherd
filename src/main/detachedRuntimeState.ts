/** Terminal ownership independent of any window. A disconnected observer does
 * not kill its process; the next observer gets bounded output replay. */
export const MAX_TERMINAL_REPLAY_BYTES = 512 * 1024
export const MAX_RUNTIME_TERMINALS = 128

export interface RuntimeProcess {
  pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: (exitCode: number) => void): { dispose(): void }
}

export interface RuntimeCreateOptions {
  id: string
  workspaceId?: string
  cwd?: string
  cols: number
  rows: number
}

export interface RuntimeObserver {
  output(id: string, data: string): void
  exit(id: string, code: number): void
}

interface TerminalRecord {
  process: RuntimeProcess
  workspaceId?: string
  replay: TerminalReplayBuffer
  observer: RuntimeObserver | null
  dataSubscription: { dispose(): void }
  exitSubscription: { dispose(): void }
}

export interface RuntimeTerminalSummary {
  id: string
  workspaceId?: string
  pid: number
  attached: boolean
}

/** Never retain unbounded output from a detached, chatty process. */
export class TerminalReplayBuffer {
  private chunks: Buffer[] = []
  private bytes = 0
  private dropped = false

  constructor(private readonly maxBytes = MAX_TERMINAL_REPLAY_BYTES) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('invalid replay limit')
  }

  append(data: string): void {
    if (!data) return
    const encoded = Buffer.from(data)
    if (encoded.length > this.maxBytes) {
      this.chunks = [encoded.subarray(encoded.length - this.maxBytes)]
      this.bytes = this.maxBytes
      this.dropped = true
      return
    }
    this.chunks.push(encoded)
    this.bytes += encoded.length
    while (this.bytes > this.maxBytes) {
      const oldest = this.chunks.shift()!
      this.bytes -= oldest.length
      this.dropped = true
    }
  }

  snapshot(): { data: string; truncated: boolean } {
    return {
      data: Buffer.concat(this.chunks, this.bytes).toString('utf8'),
      truncated: this.dropped
    }
  }
}

export class DetachedRuntimeState {
  private readonly terminals = new Map<string, TerminalRecord>()

  constructor(private readonly spawn: (options: RuntimeCreateOptions) => RuntimeProcess) {}

  create(options: RuntimeCreateOptions): RuntimeTerminalSummary {
    if (this.terminals.has(options.id)) throw new Error('terminal already exists')
    if (this.terminals.size >= MAX_RUNTIME_TERMINALS) throw new Error('terminal limit reached')
    const process = this.spawn(options)
    const record: TerminalRecord = {
      process,
      workspaceId: options.workspaceId,
      replay: new TerminalReplayBuffer(),
      observer: null,
      dataSubscription: { dispose() {} },
      exitSubscription: { dispose() {} }
    }
    this.terminals.set(options.id, record)
    record.dataSubscription = process.onData((data) => {
      record.replay.append(data)
      record.observer?.output(options.id, data)
    })
    record.exitSubscription = process.onExit((exitCode) => {
      if (this.terminals.get(options.id) !== record) return
      this.terminals.delete(options.id)
      record.dataSubscription.dispose()
      record.exitSubscription.dispose()
      record.observer?.exit(options.id, exitCode)
    })
    return this.summary(options.id, record)
  }

  attach(id: string, observer: RuntimeObserver): { replay: string; truncated: boolean } {
    const terminal = this.require(id)
    if (terminal.observer && terminal.observer !== observer) {
      throw new Error('terminal is attached to another client')
    }
    // Assign before replay is returned so output arriving afterwards goes to
    // this observer. The transport must send the replay before queued events.
    terminal.observer = observer
    const snapshot = terminal.replay.snapshot()
    return { replay: snapshot.data, truncated: snapshot.truncated }
  }

  detach(id: string, observer: RuntimeObserver): void {
    const terminal = this.require(id)
    if (terminal.observer === observer) terminal.observer = null
  }

  detachAll(observer: RuntimeObserver): void {
    for (const terminal of this.terminals.values()) {
      if (terminal.observer === observer) terminal.observer = null
    }
  }

  input(id: string, observer: RuntimeObserver, data: string): void {
    const terminal = this.require(id)
    if (terminal.observer !== observer) throw new Error('terminal is not attached to this client')
    terminal.process.write(data)
  }

  resize(id: string, observer: RuntimeObserver, cols: number, rows: number): void {
    const terminal = this.require(id)
    if (terminal.observer !== observer) throw new Error('terminal is not attached to this client')
    terminal.process.resize(cols, rows)
  }

  dispose(id: string, observer: RuntimeObserver): void {
    const terminal = this.require(id)
    if (terminal.observer !== observer) throw new Error('terminal is not attached to this client')
    this.terminals.delete(id)
    terminal.dataSubscription.dispose()
    terminal.exitSubscription.dispose()
    terminal.process.kill()
  }

  list(): RuntimeTerminalSummary[] {
    return [...this.terminals].map(([id, terminal]) => this.summary(id, terminal))
  }

  private require(id: string): TerminalRecord {
    const terminal = this.terminals.get(id)
    if (!terminal) throw new Error('terminal not found')
    return terminal
  }

  private summary(id: string, terminal: TerminalRecord): RuntimeTerminalSummary {
    return {
      id,
      ...(terminal.workspaceId ? { workspaceId: terminal.workspaceId } : {}),
      pid: terminal.process.pid,
      attached: terminal.observer !== null
    }
  }
}
