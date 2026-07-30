import assert from 'node:assert/strict'
import {
  latestTerminalMemorySnapshot,
  markDirectChildOwnership,
  parseTerminalMemorySnapshots,
  summarizeLifecycleRun,
  type LifecycleLevelSample
} from './terminalLifecycleBenchmarkLib'

const diagnostic =
  'noise\n[cmux:memory] {"schemaVersion":1,"reason":"created","timestamp":1,' +
  '"terminalCount":2,"ownerCount":1,"inspectionTerminalCount":2,' +
  '"inspectionRetainedBytes":10,"inspectionDroppedBytes":3,"pendingOutputBytes":4,' +
  '"inFlightOutputBytes":5,"pausedTerminalCount":0}\n'
const snapshots = parseTerminalMemorySnapshots(
  `${diagnostic}[cmux:memory] not-json\n[cmux:memory] {"schemaVersion":2}\n`
)
assert.equal(snapshots.length, 1)
assert.equal(snapshots[0]?.terminalCount, 2)
assert.equal(latestTerminalMemorySnapshot(diagnostic, 2)?.inspectionRetainedBytes, 10)
assert.equal(latestTerminalMemorySnapshot(diagnostic, 1), null)

const ownership = markDirectChildOwnership(
  [
    { pid: 10, ppid: 1, command: 'runner', marked: false },
    { pid: 11, ppid: 10, command: 'helper', marked: false }
  ],
  10
)
assert.equal(ownership[0]?.marked, true)
assert.equal(ownership[1]?.marked, false)

const sample = (
  terminalCount: number,
  pssKiB: number,
  processCount: number
): LifecycleLevelSample => ({
  terminalCount,
  processCount,
  pssKiB,
  rssKiB: pssKiB * 2,
  privateKiB: pssKiB - 10,
  swapPssKiB: 0
})
const summary = summarizeLifecycleRun(
  [sample(1, 100, 4), sample(1, 120, 4), sample(2, 150, 5), sample(2, 170, 5)],
  [110, 115, 112]
)
assert.equal(summary.levels['1']?.pssKiB.median, 110)
assert.equal(summary.levels['2']?.pssKiB.median, 160)
assert.equal(summary.incrementalPssKiBPerTerminal, 50)
assert.equal(summary.finalRecoveryDeltaKiB, 2)
assert.equal(summary.recoveryStrictlyIncreasing, false)

console.log('✅ ALL TERMINAL LIFECYCLE BENCHMARK LIBRARY TESTS PASS')
