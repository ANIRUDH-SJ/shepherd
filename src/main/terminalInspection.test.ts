import {
  appendTerminalInspectionOutput,
  clearTerminalInspections,
  inspectTerminal,
  listTerminalProcessContexts,
  normalizeTerminalInspection,
  recordTerminalInspectionInput,
  registerTerminalInspection,
  removeTerminalInspection,
  resizeTerminalInspection,
  subscribeTerminalInspectionActivity,
  type TerminalInspectionActivity
} from './terminalInspection'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

const defaults = normalizeTerminalInspection({})
assert(defaults.ok && defaults.options.lines === 50, 'supplies a bounded line default')
assert(defaults.ok && defaults.options.maxBytes === 16_384, 'supplies a bounded byte default')
assert(!normalizeTerminalInspection({ lines: 0 }).ok, 'rejects an invalid line limit')
assert(!normalizeTerminalInspection({ maxBytes: 65_537 }).ok, 'rejects an invalid byte limit')

const activities: TerminalInspectionActivity[] = []
const unsubscribeActivity = subscribeTerminalInspectionActivity((activity) =>
  activities.push(activity)
)
const unsubscribeThrowingActivity = subscribeTerminalInspectionActivity(() => {
  throw new Error('observer failure')
})

registerTerminalInspection({
  surfaceId: 'term-1',
  workspaceId: 'ws-1',
  pid: 42,
  cols: 80,
  rows: 24,
  cwd: '/project',
  createdAt: 10
})
appendTerminalInspectionOutput('term-1', '\x1b[31mfirst\x1b[0m\r\nsecond\nthird', 20)
recordTerminalInspectionInput('term-1', 30)
resizeTerminalInspection('term-1', 100, 30)
assert(
  activities
    .filter((activity) => activity.surfaceId === 'term-1')
    .map((activity) => activity.kind)
    .join(',') === 'registered,output,input',
  'publishes content-free terminal lifecycle and activity signals'
)
assert(activities[1]?.timestamp === 20, 'preserves the observed activity timestamp')

const inspection = inspectTerminal('term-1', { lines: 2, maxBytes: 100 }, () => ({
  foreground: { pid: 50, name: 'node' },
  cwd: '/project/src'
}))
assert(inspection?.output.text === 'second\nthird', 'returns only requested recent lines')
assert(inspection?.output.truncated === true, 'marks line-limited output as truncated')
assert(inspection?.foreground?.name === 'node', 'returns safe foreground process identity')
assert(inspection?.cwd === '/project/src', 'returns live process cwd when available')
assert(inspection?.cols === 100 && inspection.rows === 30, 'tracks terminal dimensions')

const processContexts = listTerminalProcessContexts(() => ({
  foreground: { pid: 50, name: 'node', command: 'codex' },
  processes: [
    { pid: 50, name: 'node', command: 'codex' },
    { pid: 42, name: 'zsh', command: 'zsh' }
  ],
  cwd: '/project/src'
}))
assert(processContexts[0]?.lastActivityAt === 30, 'tracks recent PTY activity for discovery')
assert(processContexts[0]?.processes[0]?.command === 'codex', 'returns a safe process ancestry')
assert(processContexts[0]?.cwd === '/project/src', 'returns live cwd for workspace metadata')

const byteLimited = inspectTerminal('term-1', { lines: 10, maxBytes: 5 }, () => ({
  foreground: null
}))
assert(byteLimited?.output.bytes === 5, 'enforces the output byte limit')
assert(byteLimited?.output.truncated === true, 'marks byte-limited output as truncated')

registerTerminalInspection({
  surfaceId: 'term-cap',
  pid: 43,
  cols: 80,
  rows: 24,
  cwd: '/project'
})
appendTerminalInspectionOutput('term-cap', `discard${'x'.repeat(262_144)}`)
const capped = inspectTerminal('term-cap', { lines: 1, maxBytes: 10 }, () => ({
  foreground: null
}))
assert(capped?.output.truncated === true, 'reports capture-ring truncation')

removeTerminalInspection('term-1')
removeTerminalInspection('term-cap')
assert(inspectTerminal('term-1', { lines: 1, maxBytes: 1 }) === null, 'removes closed terminals')
assert(
  activities.filter((activity) => activity.kind === 'removed').length === 2,
  'publishes removal only for registered terminals'
)
const activityCount = activities.length
unsubscribeActivity()
unsubscribeThrowingActivity()
registerTerminalInspection({
  surfaceId: 'term-unsubscribed',
  pid: 44,
  cols: 80,
  rows: 24,
  cwd: '/project'
})
assert(activities.length === activityCount, 'unsubscribes terminal activity observers')
clearTerminalInspections()

if (failures > 0) throw new Error(`${failures} terminal inspection test(s) failed`)
console.log('\n✅ ALL TERMINAL INSPECTION TESTS PASS')
