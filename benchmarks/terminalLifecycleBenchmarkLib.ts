import {
  TERMINAL_MEMORY_LOG_PREFIX,
  type TerminalMemorySnapshot,
  type TerminalMemorySnapshotReason
} from '../src/shared/terminalMemory'
import {
  summarizeSamples,
  type MemoryUsage,
  type ProcessIdentity,
  type SampleSummary
} from './terminalBenchmarkLib'

const SNAPSHOT_REASONS = new Set<TerminalMemorySnapshotReason>([
  'created',
  'disposed',
  'exited',
  'owner-lost',
  'replaced',
  'shutdown'
])

const SNAPSHOT_COUNTS = [
  'timestamp',
  'terminalCount',
  'ownerCount',
  'inspectionTerminalCount',
  'inspectionRetainedBytes',
  'inspectionDroppedBytes',
  'pendingOutputBytes',
  'inFlightOutputBytes',
  'pausedTerminalCount'
] as const

export interface LifecycleLevelSample extends MemoryUsage {
  terminalCount: number
  processCount: number
}

export interface LifecycleRunSummary {
  levels: Record<
    string,
    {
      pssKiB: SampleSummary
      rssKiB: SampleSummary
      privateKiB: SampleSummary
      swapPssKiB: SampleSummary
      processCount: SampleSummary
    }
  >
  incrementalPssKiBPerTerminal: number
  finalRecoveryDeltaKiB: number
  recoveryStrictlyIncreasing: boolean
}

export function markDirectChildOwnership<T extends ProcessIdentity>(
  processes: T[],
  rootPid: number
): T[] {
  return processes.map((process) =>
    process.pid === rootPid ? { ...process, marked: true } : process
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function parseTerminalMemorySnapshots(log: string): TerminalMemorySnapshot[] {
  const snapshots: TerminalMemorySnapshot[] = []
  for (const line of log.split('\n')) {
    const prefix = line.indexOf(TERMINAL_MEMORY_LOG_PREFIX)
    if (prefix < 0) continue
    const payload = line.slice(prefix + TERMINAL_MEMORY_LOG_PREFIX.length).trim()
    let value: unknown
    try {
      value = JSON.parse(payload)
    } catch {
      continue
    }
    if (
      !isRecord(value) ||
      value.schemaVersion !== 1 ||
      typeof value.reason !== 'string' ||
      !SNAPSHOT_REASONS.has(value.reason as TerminalMemorySnapshotReason) ||
      SNAPSHOT_COUNTS.some((field) => !isNonNegativeInteger(value[field]))
    ) {
      continue
    }
    snapshots.push(value as unknown as TerminalMemorySnapshot)
  }
  return snapshots
}

export function latestTerminalMemorySnapshot(
  log: string,
  terminalCount?: number
): TerminalMemorySnapshot | null {
  const snapshots = parseTerminalMemorySnapshots(log)
  const matching =
    terminalCount === undefined
      ? snapshots
      : snapshots.filter((snapshot) => snapshot.terminalCount === terminalCount)
  return matching.at(-1) ?? null
}

export function summarizeLifecycleRun(
  levels: LifecycleLevelSample[],
  recoveryPssKiB: number[]
): LifecycleRunSummary {
  if (levels.length === 0) throw new Error('lifecycle run requires level samples')
  if (recoveryPssKiB.length === 0) throw new Error('lifecycle run requires recovery samples')
  const counts = [...new Set(levels.map((sample) => sample.terminalCount))].sort((a, b) => a - b)
  const summaries = Object.fromEntries(
    counts.map((terminalCount) => {
      const samples = levels.filter((sample) => sample.terminalCount === terminalCount)
      return [
        String(terminalCount),
        {
          pssKiB: summarizeSamples(samples.map((sample) => sample.pssKiB)),
          rssKiB: summarizeSamples(samples.map((sample) => sample.rssKiB)),
          privateKiB: summarizeSamples(samples.map((sample) => sample.privateKiB)),
          swapPssKiB: summarizeSamples(samples.map((sample) => sample.swapPssKiB)),
          processCount: summarizeSamples(samples.map((sample) => sample.processCount))
        }
      ]
    })
  )
  const firstCount = counts[0]
  const lastCount = counts.at(-1)!
  const firstPss = summaries[String(firstCount)].pssKiB.median
  const lastPss = summaries[String(lastCount)].pssKiB.median
  return {
    levels: summaries,
    incrementalPssKiBPerTerminal:
      lastCount === firstCount ? 0 : (lastPss - firstPss) / (lastCount - firstCount),
    finalRecoveryDeltaKiB: recoveryPssKiB.at(-1)! - recoveryPssKiB[0],
    recoveryStrictlyIncreasing: recoveryPssKiB.every(
      (sample, index) => index === 0 || sample > recoveryPssKiB[index - 1]
    )
  }
}
