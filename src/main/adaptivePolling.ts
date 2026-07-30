type CancelPollingTask = () => void

export interface AdaptivePollingOptions {
  run: () => void | Promise<void>
  activeIntervalMs: number
  idleIntervalMs: number
  hiddenIntervalMs: number
  activeForMs: number
  now?: () => number
  schedule?: (task: () => void, delayMs: number) => CancelPollingTask
  onError?: (error: unknown) => void
}

function schedulePollingTask(task: () => void, delayMs: number): CancelPollingTask {
  const handle = setTimeout(task, delayMs)
  return () => clearTimeout(handle)
}

function positiveDelay(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`)
  return value
}

/**
 * One non-overlapping poll loop with event-driven acceleration and visibility
 * backoff. Triggering never postpones an earlier run, so sustained activity
 * cannot debounce the poll indefinitely.
 */
export class AdaptivePollingLoop {
  private readonly now: () => number
  private readonly schedule: (task: () => void, delayMs: number) => CancelPollingTask
  private readonly activeIntervalMs: number
  private readonly idleIntervalMs: number
  private readonly hiddenIntervalMs: number
  private readonly activeForMs: number
  private cancelScheduled: CancelPollingTask | null = null
  private scheduledAt: number | null = null
  private activeUntil = 0
  private visible = true
  private started = false
  private stopped = false
  private running = false
  private rerun = false

  constructor(private readonly options: AdaptivePollingOptions) {
    this.now = options.now ?? Date.now
    this.schedule = options.schedule ?? schedulePollingTask
    this.activeIntervalMs = positiveDelay(options.activeIntervalMs, 'activeIntervalMs')
    this.idleIntervalMs = positiveDelay(options.idleIntervalMs, 'idleIntervalMs')
    this.hiddenIntervalMs = positiveDelay(options.hiddenIntervalMs, 'hiddenIntervalMs')
    this.activeForMs = positiveDelay(options.activeForMs, 'activeForMs')
  }

  start(): void {
    if (this.started || this.stopped) return
    this.started = true
    this.scheduleIn(0)
  }

  trigger(): void {
    if (this.stopped) return
    this.activeUntil = Math.max(this.activeUntil, this.now() + this.activeForMs)
    if (!this.started) return
    if (this.running) {
      this.rerun = true
      return
    }
    this.scheduleIn(0)
  }

  setVisible(visible: boolean): void {
    if (this.stopped || this.visible === visible) return
    this.visible = visible
    if (!this.started || this.running) return
    if (visible) {
      this.trigger()
    } else {
      this.replaceSchedule(this.hiddenIntervalMs)
    }
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.rerun = false
    this.cancelScheduled?.()
    this.cancelScheduled = null
    this.scheduledAt = null
  }

  private scheduleIn(delayMs: number): void {
    if (this.stopped) return
    const dueAt = this.now() + delayMs
    if (this.scheduledAt !== null && this.scheduledAt <= dueAt) return
    this.replaceSchedule(delayMs)
  }

  private replaceSchedule(delayMs: number): void {
    this.cancelScheduled?.()
    this.scheduledAt = this.now() + delayMs
    this.cancelScheduled = this.schedule(() => {
      this.cancelScheduled = null
      this.scheduledAt = null
      void this.execute()
    }, delayMs)
  }

  private async execute(): Promise<void> {
    if (this.stopped || this.running) return
    this.running = true
    try {
      await this.options.run()
    } catch (error) {
      try {
        this.options.onError?.(error)
      } catch {
        // A diagnostic callback must not stop future recovery polls.
      }
    } finally {
      this.running = false
    }
    if (this.stopped) return
    if (this.rerun) {
      this.rerun = false
      this.scheduleIn(0)
    } else {
      this.scheduleIn(this.nextDelay())
    }
  }

  private nextDelay(): number {
    if (!this.visible) return this.hiddenIntervalMs
    const activeRemaining = this.activeUntil - this.now()
    return activeRemaining > 0
      ? Math.min(this.activeIntervalMs, activeRemaining)
      : this.idleIntervalMs
  }
}
