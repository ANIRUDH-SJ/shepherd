export const RUNTIME_PERFORMANCE_SCHEMA_VERSION = 1
export const RUNTIME_PERFORMANCE_DIAGNOSTICS_ENV = 'CMUX_PERF_DIAGNOSTICS'

export const RUNTIME_PERFORMANCE_MARK_NAMES = [
  'main-process-start',
  'main-module-loaded',
  'electron-ready',
  'backend-services-started',
  'window-created',
  'renderer-bootstrap',
  'renderer-mounted',
  'terminal-opened',
  'terminal-fitted',
  'terminal-renderer-webgl',
  'terminal-renderer-fallback',
  'pty-spawn-requested',
  'pty-spawned',
  'pty-first-output',
  'terminal-first-output-written',
  'first-terminal-ready',
  'window-visible',
  'startup-ready',
  'agent-discovery-started',
  'workspace-metadata-started',
  'background-services-started'
] as const

export type RuntimePerformanceMarkName = (typeof RUNTIME_PERFORMANCE_MARK_NAMES)[number]

const runtimePerformanceMarkNames = new Set<string>(RUNTIME_PERFORMANCE_MARK_NAMES)

export const RENDERER_RUNTIME_PERFORMANCE_MARK_NAMES = [
  'renderer-bootstrap',
  'renderer-mounted',
  'terminal-opened',
  'terminal-fitted',
  'terminal-renderer-webgl',
  'terminal-renderer-fallback',
  'terminal-first-output-written'
] as const satisfies readonly RuntimePerformanceMarkName[]

export type RendererRuntimePerformanceMarkName =
  (typeof RENDERER_RUNTIME_PERFORMANCE_MARK_NAMES)[number]

const rendererRuntimePerformanceMarkNames = new Set<string>(RENDERER_RUNTIME_PERFORMANCE_MARK_NAMES)

export function isRuntimePerformanceMarkName(value: unknown): value is RuntimePerformanceMarkName {
  return typeof value === 'string' && runtimePerformanceMarkNames.has(value)
}

export function isRendererRuntimePerformanceMarkName(
  value: unknown
): value is RendererRuntimePerformanceMarkName {
  return typeof value === 'string' && rendererRuntimePerformanceMarkNames.has(value)
}

export function runtimePerformanceDiagnosticsEnabled(
  env: Readonly<Record<string, string | undefined>>
): boolean {
  return env[RUNTIME_PERFORMANCE_DIAGNOSTICS_ENV] === '1'
}

export interface RuntimePerformanceEvent {
  name: RuntimePerformanceMarkName
  elapsedMs: number
}

export interface RuntimePerformanceSummary {
  schemaVersion: typeof RUNTIME_PERFORMANCE_SCHEMA_VERSION
  kind: 'startup'
  complete: boolean
  events: RuntimePerformanceEvent[]
}
