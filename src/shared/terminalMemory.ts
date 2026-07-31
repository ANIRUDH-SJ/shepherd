import { PRODUCT_ENV, productDiagnosticsEnabled } from './product'

export const TERMINAL_SCROLLBACK_LINES = 1_000
export const TERMINAL_MEMORY_LOG_PREFIX = '[shepherd:memory]'

export type TerminalMemorySnapshotReason =
  'created' | 'disposed' | 'exited' | 'owner-lost' | 'replaced' | 'shutdown'

export interface TerminalMemorySnapshot {
  schemaVersion: 1
  reason: TerminalMemorySnapshotReason
  timestamp: number
  terminalCount: number
  ownerCount: number
  inspectionTerminalCount: number
  inspectionRetainedBytes: number
  inspectionDroppedBytes: number
  pendingOutputBytes: number
  inFlightOutputBytes: number
  pausedTerminalCount: number
}

export function terminalMemoryDiagnosticsEnabled(env: Record<string, string | undefined>): boolean {
  return productDiagnosticsEnabled(
    env,
    PRODUCT_ENV.memoryDiagnostics,
    PRODUCT_ENV.legacyMemoryDiagnostics
  )
}
