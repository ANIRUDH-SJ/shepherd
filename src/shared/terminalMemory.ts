export const TERMINAL_SCROLLBACK_LINES = 1_000
export const TERMINAL_MEMORY_LOG_PREFIX = '[cmux:memory]'

export function terminalMemoryDiagnosticsEnabled(
  env: Record<string, string | undefined>
): boolean {
  return env.CMUX_MEMORY_DIAGNOSTICS === '1'
}
