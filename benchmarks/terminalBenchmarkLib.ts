import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'

export type FixtureKind = 'ascii' | 'unicode' | 'ansi'
export type SubjectMode = 'shepherd' | 'terminal'

export interface SubjectDefinition {
  id: string
  label: string
  mode: SubjectMode
  command: string
  args: string[]
  versionCommand: string
  versionArgs: string[]
  source: string
  env?: Record<string, string>
  relatedCommands?: string[]
}

export interface BenchmarkConfig {
  schemaVersion: 1
  display: string
  subjects: SubjectDefinition[]
}

export interface SampleSummary {
  count: number
  min: number
  max: number
  mean: number
  median: number
  p95: number
  mad: number
}

export interface MemoryUsage {
  rssKiB: number
  pssKiB: number
  privateKiB: number
  swapPssKiB: number
}

export interface ProcessUsage extends MemoryUsage {
  pid: number
  ppid: number
  command: string
  cpuTicks: number
}

const SUBJECT_ID = /^[a-z0-9][a-z0-9-]{0,47}$/
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/
const RUN_ID = /^[a-zA-Z0-9-]{1,96}$/
const ARG_PLACEHOLDERS = new Set(['{shell}'])
const PROCESS_COMMAND = /^[a-zA-Z0-9._+:-]{1,64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(record: Record<string, unknown>, key: string, max = 2048): string {
  const value = record[key]
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > max ||
    value.includes('\0')
  ) {
    throw new Error(`${key} must be a non-empty string of at most ${max} characters`)
  }
  return value
}

function stringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]
  if (!Array.isArray(value) || value.length > 64) {
    throw new Error(`${key} must be an array with at most 64 entries`)
  }
  return value.map((entry) => {
    if (typeof entry !== 'string' || entry.length > 2048 || entry.includes('\0')) {
      throw new Error(`${key} entries must be strings of at most 2048 characters`)
    }
    return entry
  })
}

function absoluteCommand(record: Record<string, unknown>, key: string): string {
  const command = requiredString(record, key)
  if (!isAbsolute(command)) throw new Error(`${key} must be an absolute path`)
  return command
}

function subjectEnvironment(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value) || Object.keys(value).length > 32) {
    throw new Error('subject env must be an object with at most 32 entries')
  }
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!ENV_NAME.test(key)) throw new Error(`invalid environment key: ${key}`)
    if (typeof entry !== 'string' || entry.length > 2048 || entry.includes('\0')) {
      throw new Error(`environment value for ${key} is invalid`)
    }
    result[key] = entry
  }
  return result
}

function relatedCommands(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 16) {
    throw new Error('relatedCommands must be an array with at most 16 entries')
  }
  return value.map((entry) => {
    if (typeof entry !== 'string' || !PROCESS_COMMAND.test(entry)) {
      throw new Error(`invalid related process command: ${String(entry)}`)
    }
    return entry
  })
}

export function validateBenchmarkConfig(value: unknown): BenchmarkConfig {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('benchmark config must use schemaVersion 1')
  }
  const display = requiredString(value, 'display', 128)
  if (/\r|\n/.test(display)) throw new Error('display must stay on one line')
  if (!Array.isArray(value.subjects) || value.subjects.length === 0 || value.subjects.length > 12) {
    throw new Error('subjects must contain between 1 and 12 entries')
  }

  const ids = new Set<string>()
  const subjects = value.subjects.map((entry, index): SubjectDefinition => {
    if (!isRecord(entry)) throw new Error(`subject ${index + 1} must be an object`)
    const id = requiredString(entry, 'id', 48)
    if (!SUBJECT_ID.test(id)) throw new Error(`invalid subject id: ${id}`)
    if (ids.has(id)) throw new Error(`duplicate subject id: ${id}`)
    ids.add(id)

    const rawMode = entry.mode
    if (rawMode !== 'shepherd' && rawMode !== 'cmux' && rawMode !== 'terminal') {
      throw new Error(`subject ${id} mode must be shepherd or terminal`)
    }
    const mode: SubjectMode = rawMode === 'cmux' ? 'shepherd' : rawMode
    const args = stringArray(entry, 'args')
    for (const arg of args) {
      if (arg.startsWith('{') && !ARG_PLACEHOLDERS.has(arg)) {
        throw new Error(`subject ${id} uses unsupported placeholder: ${arg}`)
      }
    }
    if (mode === 'terminal' && !args.includes('{shell}')) {
      throw new Error(`terminal subject ${id} must include the {shell} argument`)
    }
    if (mode === 'shepherd' && args.includes('{shell}')) {
      throw new Error(`Shepherd subject ${id} receives its worker through SHELL`)
    }

    return {
      id,
      label: requiredString(entry, 'label', 128),
      mode,
      command: absoluteCommand(entry, 'command'),
      args,
      versionCommand: absoluteCommand(entry, 'versionCommand'),
      versionArgs: stringArray(entry, 'versionArgs'),
      source: requiredString(entry, 'source', 512),
      env: subjectEnvironment(entry.env),
      relatedCommands: relatedCommands(entry.relatedCommands)
    }
  })

  return { schemaVersion: 1, display, subjects }
}

export function boundedInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number
): number {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return parsed
}

function medianOfSorted(sorted: number[]): number {
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

export function summarizeSamples(samples: number[]): SampleSummary {
  if (samples.length === 0 || samples.some((sample) => !Number.isFinite(sample))) {
    throw new Error('samples must contain only finite numbers')
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const median = medianOfSorted(sorted)
  const deviations = sorted.map((sample) => Math.abs(sample - median)).sort((a, b) => a - b)
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted.at(-1)!,
    mean: sorted.reduce((sum, sample) => sum + sample, 0) / sorted.length,
    median,
    p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)],
    mad: medianOfSorted(deviations)
  }
}

export function parseSmapsRollup(text: string): MemoryUsage {
  const values = new Map<string, number>()
  for (const line of text.split('\n')) {
    const match = /^(Rss|Pss|Private_Clean|Private_Dirty|SwapPss):\s+(\d+)\s+kB$/.exec(line)
    if (match) values.set(match[1], Number(match[2]))
  }
  const required = ['Rss', 'Pss', 'Private_Clean', 'Private_Dirty', 'SwapPss']
  const missing = required.filter((key) => !values.has(key))
  if (missing.length > 0) {
    throw new Error(`incomplete smaps_rollup record: missing ${missing.join(', ')}`)
  }
  return {
    rssKiB: values.get('Rss')!,
    pssKiB: values.get('Pss')!,
    privateKiB: values.get('Private_Clean')! + values.get('Private_Dirty')!,
    swapPssKiB: values.get('SwapPss')!
  }
}

export function parseProcStat(text: string): { ppid: number; cpuTicks: number; command: string } {
  const open = text.indexOf('(')
  const close = text.lastIndexOf(') ')
  if (open < 1 || close <= open) throw new Error('invalid /proc stat record')
  const command = text.slice(open + 1, close)
  const fields = text
    .slice(close + 2)
    .trim()
    .split(/\s+/)
  const ppid = Number(fields[1])
  const userTicks = Number(fields[11])
  const systemTicks = Number(fields[12])
  if (![ppid, userTicks, systemTicks].every(Number.isFinite)) {
    throw new Error('incomplete /proc stat record')
  }
  return { ppid, cpuTicks: userTicks + systemTicks, command }
}

export function aggregateProcesses(processes: ProcessUsage[]): MemoryUsage {
  return processes.reduce<MemoryUsage>(
    (total, process) => ({
      rssKiB: total.rssKiB + process.rssKiB,
      pssKiB: total.pssKiB + process.pssKiB,
      privateKiB: total.privateKiB + process.privateKiB,
      swapPssKiB: total.swapPssKiB + process.swapPssKiB
    }),
    { rssKiB: 0, pssKiB: 0, privateKiB: 0, swapPssKiB: 0 }
  )
}

export interface ProcessIdentity {
  pid: number
  ppid: number
  command: string
  marked: boolean
}

function processChildren(processes: ProcessIdentity[]): Map<number, number[]> {
  const children = new Map<number, number[]>()
  for (const process of processes) {
    const siblings = children.get(process.ppid) ?? []
    siblings.push(process.pid)
    children.set(process.ppid, siblings)
  }
  return children
}

export function selectCleanupProcessIds(
  processes: ProcessIdentity[],
  rootPid: number,
  protectedCommands: string[] = []
): Set<number> {
  const byPid = new Map(processes.map((process) => [process.pid, process]))
  const children = processChildren(processes)
  const protectedSet = new Set(protectedCommands)
  const owned = new Set<number>()
  const queue = byPid.get(rootPid)?.marked ? [rootPid] : []
  while (queue.length > 0) {
    const pid = queue.shift()!
    if (owned.has(pid) || !byPid.has(pid)) continue
    const process = byPid.get(pid)!
    if (pid !== rootPid && protectedSet.has(process.command)) continue
    owned.add(pid)
    queue.push(...(children.get(pid) ?? []))
  }

  for (const process of processes) {
    if (process.marked && !protectedSet.has(process.command)) owned.add(process.pid)
  }
  return owned
}

export function selectMeasuredProcessIds(
  processes: ProcessIdentity[],
  rootPid: number,
  relatedCommands: string[] = []
): Set<number> {
  const byPid = new Map(processes.map((process) => [process.pid, process]))
  const children = processChildren(processes)
  const owned = new Set<number>()
  const queue = [rootPid]
  while (queue.length > 0) {
    const pid = queue.shift()!
    if (owned.has(pid) || !byPid.has(pid)) continue
    owned.add(pid)
    queue.push(...(children.get(pid) ?? []))
  }

  const related = new Set(relatedCommands)
  for (const process of processes) {
    if (!process.marked) continue
    owned.add(process.pid)
    let parent = byPid.get(process.ppid)
    while (parent && related.has(parent.command)) {
      owned.add(parent.pid)
      parent = byPid.get(parent.ppid)
    }
  }
  return owned
}

export function assertRunId(runId: string): void {
  if (!RUN_ID.test(runId)) throw new Error('invalid benchmark run id')
}

export function createFixture(kind: FixtureKind, minimumBytes: number): Buffer {
  if (
    !Number.isSafeInteger(minimumBytes) ||
    minimumBytes < 1024 ||
    minimumBytes > 256 * 1024 * 1024
  ) {
    throw new Error('fixture size must be between 1 KiB and 256 MiB')
  }
  const line =
    kind === 'ascii'
      ? '0123456789 abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ terminal benchmark\r\n'
      : kind === 'unicode'
        ? 'Unicode: café naïve Ελληνικά Кириллица 日本語 한글 🙂👩🏽‍💻 e\u0301 terminal\r\n'
        : '\u001b[31mred\u001b[0m \u001b[1;34mbold-blue\u001b[0m \u001b[38;2;80;200;120mtruecolor\u001b[0m terminal\r\n'
  const encoded = Buffer.from(line)
  const count = Math.ceil(minimumBytes / encoded.length)
  return Buffer.concat(Array.from({ length: count }, () => encoded))
}

export function fixtureDigest(fixture: Buffer): string {
  return createHash('sha256').update(fixture).digest('hex')
}
