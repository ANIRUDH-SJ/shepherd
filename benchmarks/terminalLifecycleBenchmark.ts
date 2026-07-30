import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import {
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  aggregateProcesses,
  assertRunId,
  boundedInteger,
  parseProcStat,
  parseSmapsRollup,
  selectCleanupProcessIds,
  selectMeasuredProcessIds,
  validateBenchmarkConfig,
  type BenchmarkConfig,
  type ProcessUsage,
  type SubjectDefinition
} from './terminalBenchmarkLib'
import {
  latestTerminalMemorySnapshot,
  parseTerminalMemorySnapshots,
  summarizeLifecycleRun,
  type LifecycleLevelSample
} from './terminalLifecycleBenchmarkLib'

interface CliOptions {
  configPath: string
  outputPath: string
  runs: number
  samplesPerLevel: number
  settleMs: number
  sampleIntervalMs: number
  cycles: number
  cycleSettleMs: number
  timeoutMs: number
  allowPressure: boolean
  subjectIds?: Set<string>
}

interface MemoryPressure {
  memTotalKiB: number
  memAvailableKiB: number
  swapTotalKiB: number
  swapFreeKiB: number
  availableRatio: number
  swapUsedRatio: number
  reasons: string[]
}

interface ProcessComposition {
  command: string
  count: number
  rssKiB: number
  pssKiB: number
  privateKiB: number
  swapPssKiB: number
}

interface LevelObservation extends LifecycleLevelSample {
  composition: ProcessComposition[]
}

interface LifecycleRun {
  subjectId: string
  round: number
  levels: LevelObservation[]
  recoveries: Array<{
    cycle: number
    pssKiB: number
    rssKiB: number
    privateKiB: number
    swapPssKiB: number
    processCount: number
    resourceSnapshot: ReturnType<typeof latestTerminalMemorySnapshot>
  }>
  diagnosticSnapshotCount: number
  finalResourceSnapshot: ReturnType<typeof latestTerminalMemorySnapshot>
  resourceCountsReturnedToBaseline: boolean | null
  summary: ReturnType<typeof summarizeLifecycleRun>
}

interface BenchmarkFailure {
  subjectId: string
  round: number
  message: string
  logPath: string
}

interface WorkspaceRecord {
  id: string
}

const benchmarkDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(benchmarkDir, '..')
const terminalLevels = [1, 2, 4, 8] as const
const allowedChildEnvironment = [
  'DBUS_SESSION_BUS_ADDRESS',
  'HOME',
  'LANG',
  'LC_ALL',
  'LOGNAME',
  'PATH',
  'USER',
  'XAUTHORITY',
  'XDG_CURRENT_DESKTOP',
  'XDG_RUNTIME_DIR',
  'XDG_SESSION_TYPE'
]
let activeCleanup: (() => Promise<void>) | undefined
let signalCleanupStarted = false

function usage(): never {
  console.error(`Usage:
  npm run benchmark:lifecycle -- run --config FILE --output FILE [options]

Options:
  --runs N                 fresh application runs per subject (default 5)
  --samples-per-level N    settled samples at 1/2/4/8 terminals (default 3)
  --settle-ms N            settle before each level (default 2000)
  --sample-interval-ms N   delay between level samples (default 250)
  --cycles N               repeated 8-to-1 close cycles (default 10)
  --cycle-settle-ms N      settle after each close cycle (default 750)
  --timeout-ms N           socket and readiness timeout (default 20000)
  --subjects A,B           run only listed subject ids
  --allow-pressure         allow a clearly labelled pilot under host pressure`)
  process.exit(2)
}

function parseCli(argv: string[]): CliOptions {
  if (argv[0] !== 'run') usage()
  const values = new Map<string, string>()
  let allowPressure = false
  for (let index = 1; index < argv.length; index++) {
    const token = argv[index]
    if (token === '--allow-pressure') {
      allowPressure = true
      continue
    }
    if (!token.startsWith('--') || index + 1 >= argv.length) usage()
    values.set(token.slice(2), argv[++index])
  }
  const config = values.get('config')
  const output = values.get('output')
  if (!config || !output) usage()
  const subjectValue = values.get('subjects')
  const subjectIds = subjectValue
    ? new Set(
        subjectValue
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      )
    : undefined
  if (subjectIds?.size === 0) throw new Error('subjects must include at least one id')
  return {
    configPath: resolve(config),
    outputPath: resolve(output),
    runs: boundedInteger(values.get('runs'), 5, 'runs', 1, 20),
    samplesPerLevel: boundedInteger(values.get('samples-per-level'), 3, 'samples-per-level', 1, 20),
    settleMs: boundedInteger(values.get('settle-ms'), 2000, 'settle-ms', 100, 60_000),
    sampleIntervalMs: boundedInteger(
      values.get('sample-interval-ms'),
      250,
      'sample-interval-ms',
      0,
      10_000
    ),
    cycles: boundedInteger(values.get('cycles'), 10, 'cycles', 1, 50),
    cycleSettleMs: boundedInteger(
      values.get('cycle-settle-ms'),
      750,
      'cycle-settle-ms',
      100,
      60_000
    ),
    timeoutMs: boundedInteger(values.get('timeout-ms'), 20_000, 'timeout-ms', 1000, 120_000),
    allowPressure,
    subjectIds
  }
}

function isInside(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

function prepareOutputPath(path: string): void {
  const outputRoot = isInside(tmpdir(), path) ? tmpdir() : join(repoRoot, 'benchmarks', 'results')
  if (!isInside(outputRoot, path)) {
    throw new Error('output must stay under /tmp or benchmarks/results')
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const realParent = realpathSync(dirname(path))
  if (!isInside(realpathSync(outputRoot), realParent)) {
    throw new Error('output parent escapes its allowed root')
  }
  if (existsSync(path)) throw new Error(`output already exists: ${path}`)
}

function loadConfig(path: string): BenchmarkConfig {
  const stats = statSync(path)
  if (!stats.isFile() || stats.size > 256 * 1024) {
    throw new Error('benchmark config must be a file no larger than 256 KiB')
  }
  const config = validateBenchmarkConfig(JSON.parse(readFileSync(path, 'utf8')))
  if (config.subjects.some((subject) => subject.mode !== 'cmux')) {
    throw new Error('lifecycle subjects must use cmux mode')
  }
  return config
}

function validateExecutable(path: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`subject executable does not exist: ${path}`)
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

function memoryPressure(): MemoryPressure {
  const values = new Map<string, number>()
  for (const line of readFileSync('/proc/meminfo', 'utf8').split('\n')) {
    const match = /^(MemTotal|MemAvailable|SwapTotal|SwapFree):\s+(\d+)\s+kB$/.exec(line)
    if (match) values.set(match[1], Number(match[2]))
  }
  const memTotalKiB = values.get('MemTotal') ?? 0
  const memAvailableKiB = values.get('MemAvailable') ?? 0
  const swapTotalKiB = values.get('SwapTotal') ?? 0
  const swapFreeKiB = values.get('SwapFree') ?? 0
  const availableRatio = memTotalKiB > 0 ? memAvailableKiB / memTotalKiB : 0
  const swapUsedRatio = swapTotalKiB > 0 ? (swapTotalKiB - swapFreeKiB) / swapTotalKiB : 0
  const reasons: string[] = []
  if (availableRatio < 0.25) reasons.push('less than 25% of memory is available')
  if (swapUsedRatio > 0.5) reasons.push('more than 50% of swap is in use')
  return {
    memTotalKiB,
    memAvailableKiB,
    swapTotalKiB,
    swapFreeKiB,
    availableRatio,
    swapUsedRatio,
    reasons
  }
}

function processIdentities(runId: string): Array<{
  pid: number
  ppid: number
  command: string
  marked: boolean
}> {
  assertRunId(runId)
  const marker = `CMUX_BENCH_RUN_ID=${runId}`
  const identities: Array<{ pid: number; ppid: number; command: string; marked: boolean }> = []
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    const pid = Number(entry)
    try {
      const stat = parseProcStat(readFileSync(`/proc/${pid}/stat`, 'utf8'))
      let marked = false
      try {
        const environment = readFileSync(`/proc/${pid}/environ`)
        marked =
          environment.length <= 1024 * 1024 && environment.toString().split('\0').includes(marker)
      } catch {
        // Descendant ancestry still proves ownership when environ is restricted.
      }
      identities.push({ pid, ppid: stat.ppid, command: stat.command, marked })
    } catch {
      // Processes can exit between /proc enumeration and inspection.
    }
  }
  return identities.sort((a, b) => a.pid - b.pid)
}

function measuredProcesses(runId: string, rootPid: number): ProcessUsage[] {
  const identities = processIdentities(runId)
  const ids = selectMeasuredProcessIds(identities, rootPid)
  const byPid = new Map(identities.map((identity) => [identity.pid, identity]))
  const processes: ProcessUsage[] = []
  for (const pid of ids) {
    const identity = byPid.get(pid)
    if (!identity) continue
    try {
      const stat = parseProcStat(readFileSync(`/proc/${pid}/stat`, 'utf8'))
      const memory = parseSmapsRollup(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'))
      processes.push({ pid, ...stat, ...memory })
    } catch {
      throw new Error(`could not inspect memory for owned pid ${pid}`)
    }
  }
  if (processes.length === 0) throw new Error('no owned application processes found')
  return processes.sort((a, b) => a.pid - b.pid)
}

function processComposition(processes: ProcessUsage[]): ProcessComposition[] {
  const groups = new Map<string, ProcessUsage[]>()
  for (const process of processes) {
    const group = groups.get(process.command) ?? []
    group.push(process)
    groups.set(process.command, group)
  }
  return [...groups]
    .map(([command, group]) => ({
      command,
      count: group.length,
      ...aggregateProcesses(group)
    }))
    .sort((a, b) => b.pssKiB - a.pssKiB || a.command.localeCompare(b.command))
}

async function terminateOwnedProcesses(runId: string, child: ChildProcess): Promise<void> {
  const terminate = (signal: NodeJS.Signals): void => {
    const identities = processIdentities(runId)
    const ids = child.pid ? selectCleanupProcessIds(identities, child.pid) : new Set<number>()
    for (const pid of [...ids].sort((a, b) => b - a)) {
      try {
        process.kill(pid, signal)
      } catch {
        // It already exited.
      }
    }
  }
  terminate('SIGTERM')
  await delay(300)
  terminate('SIGKILL')
}

function childEnvironment(
  config: BenchmarkConfig,
  subject: SubjectDefinition,
  runId: string,
  runDir: string,
  socketPath: string
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const name of allowedChildEnvironment) {
    if (process.env[name] !== undefined) environment[name] = process.env[name]
  }
  return {
    ...environment,
    ...subject.env,
    DISPLAY: config.display,
    CMUX_BENCH_RUN_ID: runId,
    CMUX_MEMORY_DIAGNOSTICS: '1',
    CMUX_SOCKET_PATH: socketPath,
    XDG_CONFIG_HOME: join(runDir, 'config'),
    XDG_CACHE_HOME: join(runDir, 'cache'),
    XDG_DATA_HOME: join(runDir, 'data')
  }
}

async function socketRequest(
  socketPath: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number
): Promise<unknown> {
  return new Promise((resolveRequest, rejectRequest) => {
    const connection = net.createConnection(socketPath)
    let buffer = ''
    let settled = false
    const finish = (error?: Error, result?: unknown): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      connection.destroy()
      if (error) rejectRequest(error)
      else resolveRequest(result)
    }
    const timer = setTimeout(
      () => finish(new Error(`socket request timed out: ${method}`)),
      timeoutMs
    )
    connection.once('connect', () => {
      connection.write(`${JSON.stringify({ id: 1, method, params })}\n`)
    })
    connection.on('data', (chunk) => {
      buffer += chunk.toString()
      if (buffer.length > 1024 * 1024) {
        finish(new Error('socket response exceeded 1 MiB'))
        return
      }
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      try {
        const response = JSON.parse(buffer.slice(0, newline)) as {
          error?: unknown
          result?: unknown
        }
        if (typeof response.error === 'string') finish(new Error(response.error))
        else finish(undefined, response.result)
      } catch {
        finish(new Error('socket returned invalid JSON'))
      }
    })
    connection.once('error', (error) => finish(error))
  })
}

function workspaceRecords(value: unknown): WorkspaceRecord[] {
  if (!value || typeof value !== 'object') throw new Error('invalid workspace response')
  const workspaces = (value as { workspaces?: unknown }).workspaces
  if (!Array.isArray(workspaces)) throw new Error('invalid workspace list')
  return workspaces.map((workspace) => {
    const id =
      workspace && typeof workspace === 'object' ? (workspace as { id?: unknown }).id : undefined
    if (typeof id !== 'string' || id.length === 0 || id.length > 256) {
      throw new Error('workspace list contains an invalid id')
    }
    return { id }
  })
}

async function listWorkspaces(socketPath: string, timeoutMs: number): Promise<WorkspaceRecord[]> {
  return workspaceRecords(await socketRequest(socketPath, 'list-workspaces', {}, timeoutMs))
}

async function waitForWorkspaceCount(
  socketPath: string,
  expected: number,
  timeoutMs: number,
  child: ChildProcess
): Promise<WorkspaceRecord[]> {
  const deadline = Date.now() + timeoutMs
  let lastError: Error | undefined
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`application exited before ${expected} workspaces were ready`)
    }
    try {
      const workspaces = await listWorkspaces(socketPath, Math.min(1000, timeoutMs))
      if (workspaces.length === expected) return workspaces
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
    await delay(50)
  }
  throw new Error(
    lastError
      ? `timed out waiting for ${expected} workspaces: ${lastError.message}`
      : `timed out waiting for ${expected} workspaces`
  )
}

async function growTo(
  socketPath: string,
  expected: number,
  timeoutMs: number,
  child: ChildProcess,
  sequence: () => number
): Promise<void> {
  let workspaces = await listWorkspaces(socketPath, timeoutMs)
  while (workspaces.length < expected) {
    await socketRequest(
      socketPath,
      'new-workspace',
      { name: `memory-bench-${sequence()}` },
      timeoutMs
    )
    workspaces = await waitForWorkspaceCount(socketPath, workspaces.length + 1, timeoutMs, child)
  }
  if (workspaces.length !== expected) throw new Error(`cannot shrink to ${expected} workspaces`)
}

async function closeToOne(
  socketPath: string,
  timeoutMs: number,
  child: ChildProcess
): Promise<void> {
  let workspaces = await listWorkspaces(socketPath, timeoutMs)
  while (workspaces.length > 1) {
    await socketRequest(
      socketPath,
      'close-workspace',
      { workspace: workspaces.at(-1)!.id },
      timeoutMs
    )
    workspaces = await waitForWorkspaceCount(socketPath, workspaces.length - 1, timeoutMs, child)
  }
}

async function waitForDiagnosticCount(
  logPath: string,
  terminalCount: number,
  timeoutMs: number,
  afterSnapshotIndex = 0
): Promise<ReturnType<typeof latestTerminalMemorySnapshot>> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const snapshots = parseTerminalMemorySnapshots(readFileSync(logPath, 'utf8')).slice(
      afterSnapshotIndex
    )
    const snapshot =
      snapshots.filter((candidate) => candidate.terminalCount === terminalCount).at(-1) ?? null
    if (snapshot) return snapshot
    await delay(25)
  }
  return null
}

function observeLevel(runId: string, rootPid: number, terminalCount: number): LevelObservation {
  const processes = measuredProcesses(runId, rootPid)
  return {
    terminalCount,
    processCount: processes.length,
    ...aggregateProcesses(processes),
    composition: processComposition(processes)
  }
}

async function runSubject(
  config: BenchmarkConfig,
  subject: SubjectDefinition,
  options: CliOptions,
  round: number,
  logRoot: string
): Promise<LifecycleRun> {
  const runId = `${subject.id}-${round}-${process.pid}-${Date.now()}`
  assertRunId(runId)
  const runDir = mkdtempSync(join(tmpdir(), 'cmux-terminal-lifecycle-run-'))
  const socketPath = join(runDir, 'cmux.sock')
  const logPath = join(logRoot, `${subject.id}-round-${round}.log`)
  const log = openSync(logPath, 'w', 0o600)
  const child = spawn(subject.command, subject.args, {
    cwd: runDir,
    detached: true,
    env: childEnvironment(config, subject, runId, runDir, socketPath),
    stdio: ['ignore', log, log]
  })
  closeSync(log)
  let launchError: Error | undefined
  child.once('error', (error) => {
    launchError = error
  })
  let cleanupPromise: Promise<void> | undefined
  const cleanup = (): Promise<void> => {
    cleanupPromise ??= terminateOwnedProcesses(runId, child)
    return cleanupPromise
  }
  activeCleanup = cleanup

  try {
    if (!child.pid) {
      await new Promise<void>((resolveTurn) => setImmediate(resolveTurn))
      throw launchError ?? new Error('application did not receive a process id')
    }
    await waitForWorkspaceCount(socketPath, 1, options.timeoutMs, child)
    await delay(Math.min(250, options.settleMs))
    const diagnosticsAvailable =
      parseTerminalMemorySnapshots(readFileSync(logPath, 'utf8')).length > 0
    let sequenceValue = 0
    const sequence = (): number => ++sequenceValue
    const levels: LevelObservation[] = []

    for (const terminalCount of terminalLevels) {
      await growTo(socketPath, terminalCount, options.timeoutMs, child, sequence)
      if (diagnosticsAvailable) {
        const snapshot = await waitForDiagnosticCount(logPath, terminalCount, options.timeoutMs)
        if (!snapshot) throw new Error(`missing ${terminalCount}-terminal resource snapshot`)
      }
      await delay(options.settleMs)
      for (let sample = 0; sample < options.samplesPerLevel; sample++) {
        levels.push(observeLevel(runId, child.pid, terminalCount))
        if (sample + 1 < options.samplesPerLevel) await delay(options.sampleIntervalMs)
      }
    }

    const oneTerminalPss = summarizeLifecycleRun(
      levels,
      levels.filter((sample) => sample.terminalCount === 1).map((sample) => sample.pssKiB)
    ).levels['1'].pssKiB.median
    const recoveries: LifecycleRun['recoveries'] = [
      {
        cycle: 0,
        pssKiB: oneTerminalPss,
        rssKiB: levels.find((sample) => sample.terminalCount === 1)!.rssKiB,
        privateKiB: levels.find((sample) => sample.terminalCount === 1)!.privateKiB,
        swapPssKiB: levels.find((sample) => sample.terminalCount === 1)!.swapPssKiB,
        processCount: levels.find((sample) => sample.terminalCount === 1)!.processCount,
        resourceSnapshot: diagnosticsAvailable
          ? latestTerminalMemorySnapshot(readFileSync(logPath, 'utf8'), 1)
          : null
      }
    ]

    for (let cycle = 1; cycle <= options.cycles; cycle++) {
      const diagnosticCursor = diagnosticsAvailable
        ? parseTerminalMemorySnapshots(readFileSync(logPath, 'utf8')).length
        : 0
      if (cycle > 1) await growTo(socketPath, 8, options.timeoutMs, child, sequence)
      await closeToOne(socketPath, options.timeoutMs, child)
      const resourceSnapshot = diagnosticsAvailable
        ? await waitForDiagnosticCount(logPath, 1, options.timeoutMs, diagnosticCursor)
        : null
      if (diagnosticsAvailable && !resourceSnapshot) {
        throw new Error(`missing one-terminal resource snapshot after cycle ${cycle}`)
      }
      await delay(options.cycleSettleMs)
      const observation = observeLevel(runId, child.pid, 1)
      recoveries.push({
        cycle,
        pssKiB: observation.pssKiB,
        rssKiB: observation.rssKiB,
        privateKiB: observation.privateKiB,
        swapPssKiB: observation.swapPssKiB,
        processCount: observation.processCount,
        resourceSnapshot
      })
    }

    const logText = readFileSync(logPath, 'utf8')
    const snapshots = parseTerminalMemorySnapshots(logText)
    const finalResourceSnapshot = diagnosticsAvailable
      ? latestTerminalMemorySnapshot(logText, 1)
      : null
    const resourceCountsReturnedToBaseline = diagnosticsAvailable
      ? !!finalResourceSnapshot &&
        finalResourceSnapshot.terminalCount === 1 &&
        finalResourceSnapshot.ownerCount === 1 &&
        finalResourceSnapshot.inspectionTerminalCount === 1 &&
        finalResourceSnapshot.pausedTerminalCount === 0
      : null
    return {
      subjectId: subject.id,
      round,
      levels,
      recoveries,
      diagnosticSnapshotCount: snapshots.length,
      finalResourceSnapshot,
      resourceCountsReturnedToBaseline,
      summary: summarizeLifecycleRun(
        levels,
        recoveries.map((recovery) => recovery.pssKiB)
      )
    }
  } finally {
    await cleanup()
    if (activeCleanup === cleanup) activeCleanup = undefined
  }
}

function captureCommand(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 10_000 })
  return `${result.stdout}${result.stderr}`.trim().slice(0, 32 * 1024)
}

function shuffledSubjects(subjects: SubjectDefinition[], round: number): SubjectDefinition[] {
  if (subjects.length < 2) return subjects
  return round % 2 === 0 ? subjects : [...subjects].reverse()
}

async function exitAfterSignal(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  const exitCode = signal === 'SIGINT' ? 130 : 143
  if (signalCleanupStarted) process.exit(exitCode)
  signalCleanupStarted = true
  try {
    await activeCleanup?.()
  } catch (error) {
    console.error(`lifecycle benchmark cleanup after ${signal} failed: ${String(error)}`)
  }
  process.exit(exitCode)
}

process.on('SIGINT', () => void exitAfterSignal('SIGINT'))
process.on('SIGTERM', () => void exitAfterSignal('SIGTERM'))

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2))
  prepareOutputPath(options.outputPath)
  const config = loadConfig(options.configPath)
  const subjects = options.subjectIds
    ? config.subjects.filter((subject) => options.subjectIds!.has(subject.id))
    : config.subjects
  if (subjects.length === 0) throw new Error('subject filter matched nothing')
  if (options.subjectIds && subjects.length !== options.subjectIds.size) {
    throw new Error('subject filter contains an unknown id')
  }
  for (const subject of subjects) validateExecutable(subject.command)

  const pressureBefore = memoryPressure()
  if (pressureBefore.reasons.length > 0 && !options.allowPressure) {
    throw new Error(
      `host pressure gate failed: ${pressureBefore.reasons.join('; ')}; use --allow-pressure only for a pilot`
    )
  }
  const pilot =
    options.allowPressure ||
    options.runs < 5 ||
    options.samplesPerLevel < 3 ||
    options.cycles < 10 ||
    pressureBefore.reasons.length > 0
  const workRoot = mkdtempSync(join(tmpdir(), 'cmux-terminal-lifecycle-suite-'))
  const logRoot = join(workRoot, 'logs')
  mkdirSync(logRoot, { mode: 0o700 })
  const runs: LifecycleRun[] = []
  const failures: BenchmarkFailure[] = []

  for (let round = 0; round < options.runs; round++) {
    for (const subject of shuffledSubjects(subjects, round)) {
      console.log(`run ${round + 1}/${options.runs}: ${subject.label}`)
      try {
        runs.push(await runSubject(config, subject, options, round, logRoot))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`  failed: ${message}`)
        failures.push({
          subjectId: subject.id,
          round,
          message,
          logPath: join(logRoot, `${subject.id}-round-${round}.log`)
        })
      }
    }
  }

  const pressureAfter = memoryPressure()
  const result = {
    schemaVersion: 1,
    classification: pilot ? 'pilot' : 'publishable',
    generatedAt: new Date().toISOString(),
    methodology:
      'fresh isolated production app; settled marked-process PSS/RSS at 1/2/4/8 real PTYs; repeated 8-to-1 lifecycle recovery',
    levels: terminalLevels,
    options: {
      runs: options.runs,
      samplesPerLevel: options.samplesPerLevel,
      settleMs: options.settleMs,
      sampleIntervalMs: options.sampleIntervalMs,
      cycles: options.cycles,
      cycleSettleMs: options.cycleSettleMs,
      timeoutMs: options.timeoutMs,
      allowPressure: options.allowPressure,
      alternatingSubjectOrder: true
    },
    environment: {
      capturedAt: new Date().toISOString(),
      repositoryHead: captureCommand('/usr/bin/git', ['-C', repoRoot, 'rev-parse', 'HEAD']),
      kernel: captureCommand('/usr/bin/uname', ['-a']),
      cpu: captureCommand('/usr/bin/lscpu', []),
      display: config.display,
      node: process.version,
      loadAverage: readFileSync('/proc/loadavg', 'utf8').trim(),
      subjects: subjects.map((subject) => ({
        id: subject.id,
        label: subject.label,
        source: subject.source,
        version: captureCommand(subject.versionCommand, subject.versionArgs)
      }))
    },
    pressureBefore,
    pressureAfter,
    runs,
    failures
  }
  const temporaryOutput = `${options.outputPath}.tmp-${process.pid}`
  writeFileSync(temporaryOutput, `${JSON.stringify(result, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx'
  })
  try {
    linkSync(temporaryOutput, options.outputPath)
  } finally {
    unlinkSync(temporaryOutput)
  }
  console.log(`wrote ${pilot ? 'pilot' : 'publishable'} results to ${options.outputPath}`)
  if (failures.length > 0 || runs.length !== subjects.length * options.runs) process.exitCode = 1
}

main().catch((error: unknown) => {
  console.error(`lifecycle benchmark: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
