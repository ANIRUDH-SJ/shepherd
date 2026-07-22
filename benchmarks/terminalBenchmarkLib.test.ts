import {
  aggregateProcesses,
  boundedInteger,
  createFixture,
  fixtureDigest,
  parseProcStat,
  parseSmapsRollup,
  selectCleanupProcessIds,
  selectMeasuredProcessIds,
  summarizeSamples,
  validateBenchmarkConfig,
  type ProcessUsage
} from './terminalBenchmarkLib'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

function rejects(run: () => unknown, message: string): void {
  try {
    run()
    assert(false, message)
  } catch {
    assert(true, message)
  }
}

const summary = summarizeSamples([9, 1, 5, 3, 7])
assert(summary.median === 5, 'calculates the median')
assert(summary.p95 === 9, 'uses nearest-rank p95')
assert(summary.mean === 5, 'calculates the arithmetic mean')
assert(summary.mad === 2, 'calculates median absolute deviation')
rejects(() => summarizeSamples([]), 'rejects an empty sample set')
rejects(() => boundedInteger('0', 5, 'samples', 1, 100), 'bounds integer options')

const memory = parseSmapsRollup(
  [
    'Rss: 120 kB',
    'Pss: 80 kB',
    'Private_Clean: 10 kB',
    'Private_Dirty: 30 kB',
    'SwapPss: 4 kB'
  ].join('\n')
)
assert(memory.rssKiB === 120 && memory.pssKiB === 80, 'parses RSS and PSS')
assert(memory.privateKiB === 40 && memory.swapPssKiB === 4, 'parses private and swap memory')
rejects(() => parseSmapsRollup('Rss: 120 kB\nPss: 80 kB'), 'rejects incomplete memory data')

const stat = parseProcStat('123 (terminal worker) S 45 1 1 0 0 0 0 0 0 0 20 7 0 0 0')
assert(stat.command === 'terminal worker', 'parses process names containing spaces')
assert(stat.ppid === 45 && stat.cpuTicks === 27, 'parses parent and CPU ticks')

const processes: ProcessUsage[] = [
  {
    pid: 1,
    ppid: 0,
    command: 'one',
    cpuTicks: 2,
    rssKiB: 5,
    pssKiB: 3,
    privateKiB: 2,
    swapPssKiB: 1
  },
  {
    pid: 2,
    ppid: 1,
    command: 'two',
    cpuTicks: 4,
    rssKiB: 7,
    pssKiB: 4,
    privateKiB: 3,
    swapPssKiB: 0
  }
]
const aggregate = aggregateProcesses(processes)
assert(aggregate.rssKiB === 12 && aggregate.pssKiB === 7, 'aggregates process-tree memory')

const identities = [
  { pid: 1, ppid: 0, command: 'systemd', marked: false },
  { pid: 10, ppid: 1, command: 'launcher', marked: true },
  { pid: 11, ppid: 10, command: 'renderer', marked: false },
  { pid: 20, ppid: 30, command: 'node', marked: true },
  { pid: 30, ppid: 1, command: 'terminal-server', marked: true },
  { pid: 40, ppid: 1, command: 'unrelated', marked: false }
]
const owned = selectMeasuredProcessIds(identities, 10, ['terminal-server'])
assert(owned.has(10) && owned.has(11), 'selects the launcher process tree')
assert(owned.has(20) && owned.has(30), 'selects marked workers and approved ancestors')
assert(!owned.has(1), 'does not cross an unapproved ancestor boundary')

const cleanup = selectCleanupProcessIds(identities, 10, ['terminal-server'])
assert(cleanup.has(10) && cleanup.has(11) && cleanup.has(20), 'selects benchmark-owned cleanup')
assert(!cleanup.has(30), 'does not terminate a marked shared terminal server')
assert(!selectCleanupProcessIds(identities, 1).has(40), 'does not follow an unmarked launcher tree')

const fixture = createFixture('unicode', 4096)
assert(fixture.length >= 4096, 'creates a fixture at least as large as requested')
assert(fixture.toString('utf8').includes('日本語'), 'preserves valid Unicode fixture content')
assert(fixtureDigest(fixture).length === 64, 'hashes fixture contents')

const validConfig = validateBenchmarkConfig({
  schemaVersion: 1,
  display: ':1',
  subjects: [
    {
      id: 'kitty',
      label: 'Kitty',
      mode: 'terminal',
      command: '/tmp/kitty',
      args: ['--config', 'NONE', '{shell}'],
      versionCommand: '/tmp/kitty',
      versionArgs: ['--version'],
      source: 'official release'
    }
  ]
})
assert(validConfig.subjects[0].id === 'kitty', 'validates a terminal subject')
rejects(
  () =>
    validateBenchmarkConfig({
      ...validConfig,
      subjects: [{ ...validConfig.subjects[0], command: 'kitty' }]
    }),
  'rejects relative executable paths'
)
rejects(
  () =>
    validateBenchmarkConfig({
      ...validConfig,
      subjects: [{ ...validConfig.subjects[0], args: [] }]
    }),
  'requires the worker placeholder for terminal subjects'
)

if (failures > 0) throw new Error(`${failures} terminal benchmark library test(s) failed`)
console.log('\n✅ ALL TERMINAL BENCHMARK LIBRARY TESTS PASS')
