import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import {
  accessSync,
  closeSync,
  constants as fsConstants,
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
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import {
  aggregateProcesses,
  assertRunId,
  boundedInteger,
  createFixture,
  fixtureDigest,
  parseProcStat,
  parseSmapsRollup,
  selectCleanupProcessIds,
  selectMeasuredProcessIds,
  summarizeSamples,
  validateBenchmarkConfig,
  type BenchmarkConfig,
  type FixtureKind,
  type ProcessUsage,
  type SubjectDefinition
} from './terminalBenchmarkLib'

interface CliOptions {
  configPath: string
  outputPath: string
  warmups: number
  samples: number
  settleMs: number
  cpuMs: number
  timeoutMs: number
  fixtureKind: FixtureKind
  fixtureBytes: number
  allowPressure: boolean
  subjectIds?: Set<string>
}

interface ControlRecord {
  runId: string
  pid: number
  hrtimeNs: string
  fixtureBytes?: number
  message?: string
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

interface BenchmarkSample {
  subjectId: string
  round: number
  warmup: boolean
  startupMs: number
  idleCpuPercent: number
  processCount: number
  processCommands: string[]
  rssKiB: number
  pssKiB: number
  privateKiB: number
  swapPssKiB: number
  parserRoundTripMs: number
  parserMiBPerSecond: number
}

interface BenchmarkFailure {
  subjectId: string
  round: number
  warmup: boolean
  message: string
  logPath: string
}

const benchmarkDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(benchmarkDir, '..')
const workerPath = join(benchmarkDir, 'terminalBenchmarkWorker.ts')
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
let activeRunCleanup: (() => Promise<void>) | undefined
let signalCleanupStarted = false

async function exitAfterSignal(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  const exitCode = signal === 'SIGINT' ? 130 : 143
  if (signalCleanupStarted) process.exit(exitCode)
  signalCleanupStarted = true
  try {
    await activeRunCleanup?.()
  } catch (error) {
    console.error(`benchmark: cleanup after ${signal} failed: ${String(error)}`)
  }
  process.exit(exitCode)
}

process.on('SIGINT', () => void exitAfterSignal('SIGINT'))
process.on('SIGTERM', () => void exitAfterSignal('SIGTERM'))

function usage(): never {
  console.error(`Usage:
  npm run benchmark -- run --config FILE --output FILE [options]

Options:
  --warmups N          warmup rounds per subject (default 5)
  --samples N          measured rounds per subject (default 20)
  --settle-ms N        idle settling time (default 2000)
  --cpu-ms N           idle CPU sample window (default 1000)
  --timeout-ms N       readiness/parser timeout (default 20000)
  --fixture KIND       ascii, unicode, or ansi (default ansi)
  --fixture-bytes N    minimum fixture bytes (default 8388608)
  --subjects A,B       run only listed subject ids
  --allow-pressure     allow a clearly labelled pilot under memory/swap pressure`)
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

  const configValue = values.get('config')
  const outputValue = values.get('output')
  if (!configValue || !outputValue) usage()
  const fixtureKind = values.get('fixture') ?? 'ansi'
  if (fixtureKind !== 'ascii' && fixtureKind !== 'unicode' && fixtureKind !== 'ansi') {
    throw new Error('fixture must be ascii, unicode, or ansi')
  }
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
    configPath: resolve(configValue),
    outputPath: resolve(outputValue),
    warmups: boundedInteger(values.get('warmups'), 5, 'warmups', 0, 20),
    samples: boundedInteger(values.get('samples'), 20, 'samples', 1, 100),
    settleMs: boundedInteger(values.get('settle-ms'), 2000, 'settle-ms', 100, 60_000),
    cpuMs: boundedInteger(values.get('cpu-ms'), 1000, 'cpu-ms', 100, 60_000),
    timeoutMs: boundedInteger(values.get('timeout-ms'), 20_000, 'timeout-ms', 1000, 120_000),
    fixtureKind,
    fixtureBytes: boundedInteger(
      values.get('fixture-bytes'),
      8 * 1024 * 1024,
      'fixture-bytes',
      1024,
      256 * 1024 * 1024
    ),
    allowPressure,
    subjectIds
  }
}

function isInside(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

function validateInputPath(path: string): void {
  const stats = statSync(path)
  if (!stats.isFile() || stats.size > 256 * 1024) {
    throw new Error('benchmark config must be a file no larger than 256 KiB')
  }
}

function prepareOutputPath(path: string): void {
  const outputRoot = isInside(tmpdir(), path) ? tmpdir() : join(repoRoot, 'benchmarks', 'results')
  if (!isInside(outputRoot, path)) {
    throw new Error('output must stay under /tmp or benchmarks/results')
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const realParent = realpathSync(dirname(path))
  if (!isInside(realpathSync(outputRoot), realParent))
    throw new Error('output parent escapes its allowed root')
  if (existsSync(path)) throw new Error(`output already exists: ${path}`)
}

function validateExecutable(path: string, label: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${label} does not exist: ${path}`)
  }
  try {
    accessSync(path, fsConstants.X_OK)
  } catch {
    throw new Error(`${label} is not executable: ${path}`)
  }
}

function loadConfig(path: string): BenchmarkConfig {
  validateInputPath(path)
  return validateBenchmarkConfig(JSON.parse(readFileSync(path, 'utf8')))
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

function readControlRecord(path: string, runId: string): ControlRecord {
  const stats = statSync(path)
  if (!stats.isFile() || stats.size > 4096) throw new Error(`invalid control record: ${path}`)
  const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<ControlRecord>
  if (
    value.runId !== runId ||
    !Number.isSafeInteger(value.pid) ||
    typeof value.hrtimeNs !== 'string' ||
    !/^\d+$/.test(value.hrtimeNs)
  ) {
    throw new Error(`malformed control record: ${path}`)
  }
  return value as ControlRecord
}

async function waitForRecord(
  path: string,
  errorPath: string,
  runId: string,
  timeoutMs: number,
  child: ChildProcess,
  launchError: () => Error | undefined
): Promise<ControlRecord> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const error = launchError()
    if (error) throw new Error(`could not launch subject: ${error.message}`)
    if (existsSync(errorPath)) {
      const error = readControlRecord(errorPath, runId)
      throw new Error(error.message ?? 'benchmark worker failed')
    }
    if (existsSync(path)) return readControlRecord(path, runId)
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`subject exited before readiness (${child.exitCode ?? child.signalCode})`)
    }
    await delay(5)
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for ${path}`)
}

function processIdentities(runId: string): Array<{
  pid: number
  ppid: number
  command: string
  marked: boolean
}> {
  assertRunId(runId)
  const marker = `SHEPHERD_BENCH_RUN_ID=${runId}`
  const processes: Array<{ pid: number; ppid: number; command: string; marked: boolean }> = []
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
        // Some sandboxed children expose stat but not environ; ancestry still owns them.
      }
      processes.push({ pid, ppid: stat.ppid, command: stat.command, marked })
    } catch {
      // A process may exit or deny inspection between directory reads.
    }
  }
  return processes.sort((a, b) => a.pid - b.pid)
}

function measuredProcesses(
  runId: string,
  rootPid: number,
  workerPid: number,
  relatedCommands: string[] = []
): ProcessUsage[] {
  const identities = processIdentities(runId)
  const ids = selectMeasuredProcessIds(identities, rootPid, relatedCommands)
  ids.delete(workerPid)
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
  return processes.sort((a, b) => a.pid - b.pid)
}

async function terminateOwnedProcesses(
  runId: string,
  child: ChildProcess,
  workerPid: number | undefined,
  protectedCommands: string[] = []
): Promise<void> {
  const terminate = (signal: NodeJS.Signals): void => {
    const identities = processIdentities(runId)
    const ids = child.pid
      ? selectCleanupProcessIds(identities, child.pid, protectedCommands)
      : new Set<number>()
    const worker = workerPid ? identities.find((identity) => identity.pid === workerPid) : undefined
    if (worker?.marked) ids.add(worker.pid)
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

function childEnvironment(config: BenchmarkConfig, subject: SubjectDefinition): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const name of allowedChildEnvironment) {
    if (process.env[name] !== undefined) environment[name] = process.env[name]
  }
  environment.DISPLAY = config.display
  return { ...environment, ...subject.env }
}

function writeWorkerShell(path: string): void {
  writeFileSync(path, '#!/bin/sh\nexec "$SHEPHERD_BENCH_NODE" "$SHEPHERD_BENCH_WORKER"\n', {
    mode: 0o700,
    flag: 'wx'
  })
}

function compileWorker(path: string): void {
  const source = readFileSync(workerPath, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022
    },
    fileName: workerPath,
    reportDiagnostics: true
  })
  const errors = output.diagnostics?.filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  )
  if (errors && errors.length > 0) throw new Error('could not compile benchmark worker')
  writeFileSync(path, output.outputText, { mode: 0o600, flag: 'wx' })
}

function ticksPerSecond(): number {
  const result = spawnSync('/usr/bin/getconf', ['CLK_TCK'], { encoding: 'utf8', timeout: 5000 })
  const ticks = Number(result.stdout.trim())
  if (result.status !== 0 || !Number.isFinite(ticks) || ticks <= 0) {
    throw new Error('could not determine CLK_TCK')
  }
  return ticks
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

function captureCommand(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 10_000 })
  return `${result.stdout}${result.stderr}`.trim().slice(0, 32 * 1024)
}

function captureEnvironment(config: BenchmarkConfig): Record<string, unknown> {
  const glxinfo = process.env.SHEPHERD_BENCH_GLXINFO || process.env.CMUX_BENCH_GLXINFO
  const glx =
    glxinfo && isAbsolute(glxinfo) && existsSync(glxinfo)
      ? captureCommand(glxinfo, ['-B'])
      : undefined
  return {
    capturedAt: new Date().toISOString(),
    repositoryHead: captureCommand('/usr/bin/git', ['-C', repoRoot, 'rev-parse', 'HEAD']),
    kernel: captureCommand('/usr/bin/uname', ['-a']),
    cpu: captureCommand('/usr/bin/lscpu', []),
    gpu: captureCommand('/usr/bin/lspci', ['-nn']),
    display: config.display,
    displayGeometry: existsSync('/usr/bin/xrandr')
      ? captureCommand('/usr/bin/xrandr', ['--current'])
      : undefined,
    glx,
    node: process.version,
    loadAverage: readFileSync('/proc/loadavg', 'utf8').trim(),
    pressure: memoryPressure(),
    subjects: config.subjects.map((subject) => ({
      id: subject.id,
      label: subject.label,
      source: subject.source,
      command: subject.command,
      version: captureCommand(subject.versionCommand, subject.versionArgs)
    }))
  }
}

function shuffledSubjects(subjects: SubjectDefinition[], round: number): SubjectDefinition[] {
  const result = [...subjects]
  let state = (0x6d2b79f5 ^ round) >>> 0
  for (let index = result.length - 1; index > 0; index--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const target = state % (index + 1)
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result
}

async function runSubject(
  config: BenchmarkConfig,
  subject: SubjectDefinition,
  options: CliOptions,
  fixturePath: string,
  compiledWorkerPath: string,
  fixtureBytes: number,
  round: number,
  warmup: boolean,
  clockTicks: number,
  logRoot: string
): Promise<BenchmarkSample> {
  const runId = `${subject.id}-${round}-${process.pid}-${Date.now()}`
  assertRunId(runId)
  const runDir = mkdtempSync(join(tmpdir(), 'shepherd-terminal-bench-run-'))
  const readyFile = join(runDir, 'ready.json')
  const doneFile = join(runDir, 'done.json')
  const errorFile = join(runDir, 'error.json')
  const stopFile = join(runDir, 'stop')
  const workerShell = join(runDir, 'worker-shell')
  const logPath = join(logRoot, `${subject.id}-round-${round}${warmup ? '-warmup' : ''}.log`)
  writeWorkerShell(workerShell)

  const environment: NodeJS.ProcessEnv = {
    ...childEnvironment(config, subject),
    SHEPHERD_BENCH_RUN_ID: runId,
    SHEPHERD_BENCH_READY_FILE: readyFile,
    SHEPHERD_BENCH_DONE_FILE: doneFile,
    SHEPHERD_BENCH_ERROR_FILE: errorFile,
    SHEPHERD_BENCH_STOP_FILE: stopFile,
    SHEPHERD_BENCH_FIXTURE_FILE: fixturePath,
    SHEPHERD_BENCH_RESPONSE_TIMEOUT_MS: String(options.timeoutMs),
    SHEPHERD_BENCH_NODE: process.execPath,
    SHEPHERD_BENCH_WORKER: compiledWorkerPath,
    XDG_CONFIG_HOME: join(runDir, 'config'),
    XDG_CACHE_HOME: join(runDir, 'cache'),
    XDG_DATA_HOME: join(runDir, 'data'),
    SHEPHERD_SOCKET_PATH: join(runDir, 'shepherd.sock')
  }
  if (subject.mode === 'shepherd') environment.SHELL = workerShell
  const args = subject.args.map((argument) => (argument === '{shell}' ? workerShell : argument))
  const log = openSync(logPath, 'w', 0o600)
  const startNs = process.hrtime.bigint()
  const child = spawn(subject.command, args, {
    cwd: runDir,
    detached: true,
    env: environment,
    stdio: ['ignore', log, log]
  })
  let launchError: Error | undefined
  child.once('error', (error) => {
    launchError = error
  })
  closeSync(log)
  let workerPid: number | undefined
  let cleanupPromise: Promise<void> | undefined
  const cleanup = (): Promise<void> => {
    cleanupPromise ??= (async () => {
      if (!existsSync(stopFile)) writeFileSync(stopFile, '', { mode: 0o600 })
      await terminateOwnedProcesses(runId, child, workerPid, subject.relatedCommands)
    })()
    return cleanupPromise
  }
  activeRunCleanup = cleanup

  try {
    if (!child.pid) {
      await new Promise<void>((resolveTurn) => setImmediate(resolveTurn))
      throw launchError ?? new Error('benchmark subject did not receive a pid')
    }
    const ready = await waitForRecord(
      readyFile,
      errorFile,
      runId,
      options.timeoutMs,
      child,
      () => launchError
    )
    workerPid = ready.pid
    const startupMs = Number(BigInt(ready.hrtimeNs) - startNs) / 1_000_000
    if (ready.fixtureBytes !== fixtureBytes)
      throw new Error('worker loaded an unexpected fixture size')
    await delay(options.settleMs)

    const before = measuredProcesses(runId, child.pid, ready.pid, subject.relatedCommands)
    if (before.length === 0) throw new Error('no owned subject processes found')
    const beforeTicks = new Map(before.map((entry) => [entry.pid, entry.cpuTicks]))
    await delay(options.cpuMs)
    const after = measuredProcesses(runId, child.pid, ready.pid, subject.relatedCommands)
    const cpuTicks = after.reduce(
      (total, entry) =>
        total + Math.max(0, entry.cpuTicks - (beforeTicks.get(entry.pid) ?? entry.cpuTicks)),
      0
    )
    const idleCpuPercent = (cpuTicks / clockTicks / (options.cpuMs / 1000)) * 100
    const memory = aggregateProcesses(after)

    const parserStartNs = process.hrtime.bigint()
    process.kill(ready.pid, 'SIGUSR1')
    const done = await waitForRecord(
      doneFile,
      errorFile,
      runId,
      options.timeoutMs,
      child,
      () => launchError
    )
    const parserRoundTripMs = Number(BigInt(done.hrtimeNs) - parserStartNs) / 1_000_000
    const parserMiBPerSecond = fixtureBytes / (1024 * 1024) / (parserRoundTripMs / 1000)

    return {
      subjectId: subject.id,
      round,
      warmup,
      startupMs,
      idleCpuPercent,
      processCount: after.length,
      processCommands: [...new Set(after.map((entry) => entry.command))].sort(),
      ...memory,
      parserRoundTripMs,
      parserMiBPerSecond
    }
  } finally {
    await cleanup()
    if (activeRunCleanup === cleanup) activeRunCleanup = undefined
  }
}

function metricSummary(
  samples: BenchmarkSample[],
  key: keyof BenchmarkSample
): ReturnType<typeof summarizeSamples> {
  return summarizeSamples(samples.map((sample) => sample[key] as number))
}

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
  for (const subject of subjects) {
    validateExecutable(subject.command, 'subject executable')
    validateExecutable(subject.versionCommand, 'subject version executable')
  }
  if (!existsSync(workerPath)) throw new Error('benchmark worker source is missing')

  const pressureBefore = memoryPressure()
  if (pressureBefore.reasons.length > 0 && !options.allowPressure) {
    throw new Error(
      `host pressure gate failed: ${pressureBefore.reasons.join('; ')}; use --allow-pressure only for a pilot`
    )
  }
  const pilot =
    options.allowPressure ||
    options.warmups < 5 ||
    options.samples < 20 ||
    pressureBefore.reasons.length > 0
  const fixture = createFixture(options.fixtureKind, options.fixtureBytes)
  const workRoot = mkdtempSync(join(tmpdir(), 'shepherd-terminal-bench-suite-'))
  const fixturePath = join(workRoot, `${options.fixtureKind}.fixture`)
  const compiledWorkerPath = join(workRoot, 'terminalBenchmarkWorker.mjs')
  const logRoot = join(workRoot, 'logs')
  mkdirSync(logRoot, { mode: 0o700 })
  writeFileSync(fixturePath, fixture, { mode: 0o600 })
  compileWorker(compiledWorkerPath)

  const samples: BenchmarkSample[] = []
  const failures: BenchmarkFailure[] = []
  const rounds = options.warmups + options.samples
  const clockTicks = ticksPerSecond()
  for (let round = 0; round < rounds; round++) {
    const warmup = round < options.warmups
    for (const subject of shuffledSubjects(subjects, round)) {
      console.log(`${warmup ? 'warmup' : 'sample'} ${round + 1}/${rounds}: ${subject.label}`)
      try {
        samples.push(
          await runSubject(
            config,
            subject,
            options,
            fixturePath,
            compiledWorkerPath,
            fixture.length,
            round,
            warmup,
            clockTicks,
            logRoot
          )
        )
      } catch (error) {
        const logPath = join(logRoot, `${subject.id}-round-${round}${warmup ? '-warmup' : ''}.log`)
        const message = error instanceof Error ? error.message : String(error)
        console.error(`  failed: ${message}`)
        failures.push({ subjectId: subject.id, round, warmup, message, logPath })
      }
    }
  }

  const measured = samples.filter((sample) => !sample.warmup)
  const summaries = Object.fromEntries(
    subjects.map((subject) => {
      const subjectSamples = measured.filter((sample) => sample.subjectId === subject.id)
      return [
        subject.id,
        subjectSamples.length === 0
          ? null
          : {
              startupMs: metricSummary(subjectSamples, 'startupMs'),
              idleCpuPercent: metricSummary(subjectSamples, 'idleCpuPercent'),
              pssKiB: metricSummary(subjectSamples, 'pssKiB'),
              rssKiB: metricSummary(subjectSamples, 'rssKiB'),
              parserRoundTripMs: metricSummary(subjectSamples, 'parserRoundTripMs'),
              parserMiBPerSecond: metricSummary(subjectSamples, 'parserMiBPerSecond')
            }
      ]
    })
  )
  const result = {
    schemaVersion: 1,
    classification: pilot ? 'pilot' : 'publishable',
    generatedAt: new Date().toISOString(),
    methodology:
      'process-to-worker-ready startup; marked-process PSS/RSS; sampled idle CPU; DSR-confirmed parser round trip',
    options: {
      warmups: options.warmups,
      samples: options.samples,
      settleMs: options.settleMs,
      cpuMs: options.cpuMs,
      timeoutMs: options.timeoutMs,
      fixtureKind: options.fixtureKind,
      requestedFixtureBytes: options.fixtureBytes,
      allowPressure: options.allowPressure,
      deterministicOrderSeed: '0x6d2b79f5'
    },
    fixture: { bytes: fixture.length, sha256: fixtureDigest(fixture) },
    environment: captureEnvironment({ ...config, subjects }),
    pressureBefore,
    pressureAfter: memoryPressure(),
    samples,
    failures,
    summaries
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
  if (failures.length > 0 || measured.length !== subjects.length * options.samples)
    process.exitCode = 1
}

main().catch((error: unknown) => {
  console.error(`benchmark: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
