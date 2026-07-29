export const TERMINAL_OUTPUT_BATCH_BYTES = 32 * 1024
export const TERMINAL_OUTPUT_MAX_DELAY_MS = 4
export const TERMINAL_OUTPUT_MAX_IN_FLIGHT_BYTES = 128 * 1024
export const TERMINAL_OUTPUT_PAUSE_BYTES = 256 * 1024
export const TERMINAL_OUTPUT_RESUME_BYTES = 64 * 1024
export const TERMINAL_OUTPUT_INTERACTIVE_MS = 50

type CancelScheduledFlush = () => void

interface TerminalOutputBatcherOptions {
  send(data: string, sequence: number): boolean
  pause?: () => void
  resume?: () => void
  now?: () => number
  schedule?: (task: () => void, delayMs: number) => CancelScheduledFlush
  targetBatchBytes?: number
  maxDelayMs?: number
  maxInFlightBytes?: number
  pauseAtBytes?: number
  resumeAtBytes?: number
  interactiveMs?: number
}

function scheduleFlush(task: () => void, delayMs: number): CancelScheduledFlush {
  const handle = setTimeout(task, delayMs)
  return () => clearTimeout(handle)
}

export class TerminalOutputBatcher {
  private readonly now: () => number
  private readonly schedule: (task: () => void, delayMs: number) => CancelScheduledFlush
  private readonly targetBatchBytes: number
  private readonly maxDelayMs: number
  private readonly maxInFlightBytes: number
  private readonly pauseAtBytes: number
  private readonly resumeAtBytes: number
  private readonly interactiveMs: number
  private pendingChunks: string[] = []
  private pendingBytes = 0
  private readonly inFlight = new Map<number, number>()
  private inFlightBytes = 0
  private nextSequence = 1
  private cancelScheduledFlush: CancelScheduledFlush | null = null
  private flushDue = false
  private interactiveUntil = 0
  private firstChunk = true
  private paused = false
  private disposed = false

  constructor(private readonly options: TerminalOutputBatcherOptions) {
    this.now = options.now ?? (() => performance.now())
    this.schedule = options.schedule ?? scheduleFlush
    this.targetBatchBytes = options.targetBatchBytes ?? TERMINAL_OUTPUT_BATCH_BYTES
    this.maxDelayMs = options.maxDelayMs ?? TERMINAL_OUTPUT_MAX_DELAY_MS
    this.maxInFlightBytes = options.maxInFlightBytes ?? TERMINAL_OUTPUT_MAX_IN_FLIGHT_BYTES
    this.pauseAtBytes = options.pauseAtBytes ?? TERMINAL_OUTPUT_PAUSE_BYTES
    this.resumeAtBytes = options.resumeAtBytes ?? TERMINAL_OUTPUT_RESUME_BYTES
    this.interactiveMs = options.interactiveMs ?? TERMINAL_OUTPUT_INTERACTIVE_MS
  }

  push(data: string): void {
    if (this.disposed || data.length === 0) return
    this.pendingChunks.push(data)
    this.pendingBytes += Buffer.byteLength(data)

    const now = this.now()
    const immediate = this.firstChunk || now <= this.interactiveUntil
    this.firstChunk = false
    if (immediate) this.flush(true)
    else if (this.pendingBytes >= this.targetBatchBytes) this.flush()
    else this.ensureScheduledFlush()
    this.updateBackpressure()
  }

  acknowledge(sequence: number): void {
    if (this.disposed) return
    const bytes = this.inFlight.get(sequence)
    if (bytes === undefined) return
    this.inFlight.delete(sequence)
    this.inFlightBytes -= bytes
    this.updateBackpressure()

    if (this.pendingBytes === 0) return
    if (
      this.flushDue ||
      this.pendingBytes >= this.targetBatchBytes ||
      this.now() <= this.interactiveUntil
    ) {
      this.flush()
    } else {
      this.ensureScheduledFlush()
    }
  }

  markInteractive(): void {
    if (this.disposed) return
    this.interactiveUntil = this.now() + this.interactiveMs
    this.flush(true)
  }

  drain(): void {
    if (this.disposed) return
    this.flush(true)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancelTimer()
    this.pendingChunks = []
    this.pendingBytes = 0
    this.inFlight.clear()
    this.inFlightBytes = 0
    if (this.paused) {
      this.paused = false
      this.options.resume?.()
    }
  }

  private ensureScheduledFlush(): void {
    if (this.cancelScheduledFlush || this.flushDue || this.pendingBytes === 0) return
    this.cancelScheduledFlush = this.schedule(() => {
      this.cancelScheduledFlush = null
      this.flushDue = true
      this.flush()
    }, this.maxDelayMs)
  }

  private flush(force = false): void {
    if (this.disposed || this.pendingBytes === 0) return
    if (
      !force &&
      this.inFlightBytes > 0 &&
      this.inFlightBytes + this.pendingBytes > this.maxInFlightBytes
    ) {
      this.flushDue = true
      return
    }

    this.cancelTimer()
    this.flushDue = false
    const data =
      this.pendingChunks.length === 1 ? this.pendingChunks[0] : this.pendingChunks.join('')
    const bytes = this.pendingBytes
    this.pendingChunks = []
    this.pendingBytes = 0

    const sequence = this.nextSequence++
    this.inFlight.set(sequence, bytes)
    this.inFlightBytes += bytes
    let expectsAcknowledgement = false
    try {
      expectsAcknowledgement = this.options.send(data, sequence)
    } catch {
      // A closed renderer must not break PTY processing or retain queued output.
    }
    if (!expectsAcknowledgement) {
      this.inFlight.delete(sequence)
      this.inFlightBytes -= bytes
    }
    this.updateBackpressure()
  }

  private updateBackpressure(): void {
    const queuedBytes = this.pendingBytes + this.inFlightBytes
    if (!this.paused && queuedBytes >= this.pauseAtBytes) {
      this.paused = true
      this.options.pause?.()
    } else if (this.paused && queuedBytes <= this.resumeAtBytes) {
      this.paused = false
      this.options.resume?.()
    }
  }

  private cancelTimer(): void {
    this.cancelScheduledFlush?.()
    this.cancelScheduledFlush = null
  }
}
