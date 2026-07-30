import {
  RUNTIME_PERFORMANCE_SCHEMA_VERSION,
  type RuntimePerformanceEvent,
  type RuntimePerformanceMarkName,
  type RuntimePerformanceSummary
} from '../shared/runtimePerformance'

export const RUNTIME_PERFORMANCE_LOG_PREFIX = '[shepherd:perf] '

const STARTUP_READY_REQUIRED_MARKS: ReadonlySet<RuntimePerformanceMarkName> = new Set([
  'main-process-start',
  'main-module-loaded',
  'electron-ready',
  'backend-services-started',
  'window-created',
  'renderer-bootstrap',
  'renderer-mounted',
  'terminal-opened',
  'terminal-fitted',
  'pty-spawn-requested',
  'pty-spawned',
  'pty-first-output',
  'terminal-first-output-written',
  'window-visible'
])

interface RuntimePerformanceRecorderOptions {
  enabled: boolean
  now?: () => number
  output?: (line: string) => void
}

function roundedMilliseconds(value: number): number {
  return Math.round(Math.max(0, value) * 1000) / 1000
}

export class RuntimePerformanceRecorder {
  readonly enabled: boolean
  private readonly now: () => number
  private readonly output: (line: string) => void
  private readonly events = new Map<RuntimePerformanceMarkName, RuntimePerformanceEvent>()
  private emitted = false

  constructor(options: RuntimePerformanceRecorderOptions) {
    this.enabled = options.enabled
    this.now = options.now ?? (() => performance.now())
    this.output = options.output ?? ((line) => console.info(line))
  }

  mark(name: RuntimePerformanceMarkName, elapsedMs = this.now()): void {
    if (!this.enabled || this.events.has(name) || !Number.isFinite(elapsedMs)) return
    this.events.set(name, { name, elapsedMs: roundedMilliseconds(elapsedMs) })
    this.advance()
  }

  snapshot(complete = this.isComplete()): RuntimePerformanceSummary {
    return {
      schemaVersion: RUNTIME_PERFORMANCE_SCHEMA_VERSION,
      kind: 'startup',
      complete,
      events: [...this.events.values()].sort((left, right) => left.elapsedMs - right.elapsedMs)
    }
  }

  flush(): void {
    if (!this.enabled || this.emitted) return
    this.emit(this.isComplete())
  }

  private isComplete(): boolean {
    return (
      this.events.has('startup-ready') &&
      this.events.has('first-terminal-ready') &&
      this.events.has('background-services-started')
    )
  }

  private isStartupReady(): boolean {
    const hasRenderer =
      this.events.has('terminal-renderer-webgl') || this.events.has('terminal-renderer-fallback')
    return hasRenderer && [...STARTUP_READY_REQUIRED_MARKS].every((name) => this.events.has(name))
  }

  private advance(): void {
    if (!this.events.has('startup-ready') && this.isStartupReady()) {
      this.events.set('startup-ready', {
        name: 'startup-ready',
        elapsedMs: roundedMilliseconds(this.now())
      })
    }
    if (!this.emitted && this.isComplete()) this.emit(true)
  }

  private emit(complete: boolean): void {
    this.emitted = true
    try {
      this.output(`${RUNTIME_PERFORMANCE_LOG_PREFIX}${JSON.stringify(this.snapshot(complete))}`)
    } catch {
      // Opt-in diagnostics must never take down the application.
    }
  }
}
