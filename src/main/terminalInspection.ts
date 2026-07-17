import { readFileSync, readlinkSync } from 'fs'
import { basename, dirname } from 'path'
import {
  DEFAULT_AGENT_INSPECT_BYTES,
  DEFAULT_AGENT_INSPECT_LINES,
  MAX_AGENT_INSPECT_BYTES,
  MAX_AGENT_INSPECT_LINES,
  MAX_TERMINAL_CAPTURE_BYTES
} from '../shared/agentLimits'

interface TerminalCapture {
  surfaceId: string
  workspaceId?: string
  pid: number
  cols: number
  rows: number
  initialCwd: string
  createdAt: number
  output: Buffer
  droppedBytes: number
  lastInputAt: number
  lastOutputAt: number
}

export interface TerminalRegistration {
  surfaceId: string
  workspaceId?: string
  pid: number
  cols: number
  rows: number
  cwd: string
  createdAt?: number
}

export interface TerminalInspectionOptions {
  lines: number
  maxBytes: number
}

export type TerminalInspectionValidation =
  { ok: true; options: TerminalInspectionOptions } | { ok: false; error: string }

export interface ForegroundProcess {
  pid: number
  name: string
  command?: string
}

export interface TerminalProcessContext {
  surfaceId: string
  workspaceId?: string
  shellPid: number
  processes: ForegroundProcess[]
  lastActivityAt: number
}

export interface TerminalInspection {
  surfaceId: string
  workspaceId?: string
  pid: number
  foreground: ForegroundProcess | null
  cwd: string
  cols: number
  rows: number
  createdAt: number
  output: {
    text: string
    lines: number
    bytes: number
    truncated: boolean
  }
}

interface ProcessContext {
  foreground: ForegroundProcess | null
  processes?: ForegroundProcess[]
  cwd?: string
}

const captures = new Map<string, TerminalCapture>()

function boundedInteger(
  value: unknown,
  fallback: number,
  field: string,
  maximum: number
): number | string {
  if (value === undefined) return fallback
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    return `${field} must be an integer from 1 to ${maximum}`
  }
  return parsed
}

export function normalizeTerminalInspection(
  params: Record<string, unknown>
): TerminalInspectionValidation {
  const lines = boundedInteger(
    params.lines,
    DEFAULT_AGENT_INSPECT_LINES,
    'lines',
    MAX_AGENT_INSPECT_LINES
  )
  if (typeof lines === 'string') return { ok: false, error: lines }
  const maxBytes = boundedInteger(
    params.maxBytes,
    DEFAULT_AGENT_INSPECT_BYTES,
    'maxBytes',
    MAX_AGENT_INSPECT_BYTES
  )
  if (typeof maxBytes === 'string') return { ok: false, error: maxBytes }
  return { ok: true, options: { lines, maxBytes } }
}

export function registerTerminalInspection(registration: TerminalRegistration): void {
  const createdAt = registration.createdAt ?? Date.now()
  captures.set(registration.surfaceId, {
    ...registration,
    createdAt,
    initialCwd: registration.cwd,
    output: Buffer.alloc(0),
    droppedBytes: 0,
    lastInputAt: createdAt,
    lastOutputAt: createdAt
  })
}

export function appendTerminalInspectionOutput(
  surfaceId: string,
  data: string,
  timestamp = Date.now()
): void {
  const capture = captures.get(surfaceId)
  if (!capture) return
  capture.lastOutputAt = timestamp
  const appended = Buffer.concat([capture.output, Buffer.from(data)])
  if (appended.length <= MAX_TERMINAL_CAPTURE_BYTES) {
    capture.output = appended
    return
  }
  const dropped = appended.length - MAX_TERMINAL_CAPTURE_BYTES
  capture.output = appended.subarray(dropped)
  capture.droppedBytes += dropped
}

export function recordTerminalInspectionInput(surfaceId: string, timestamp = Date.now()): void {
  const capture = captures.get(surfaceId)
  if (capture) capture.lastInputAt = timestamp
}

export function resizeTerminalInspection(surfaceId: string, cols: number, rows: number): void {
  const capture = captures.get(surfaceId)
  if (!capture) return
  capture.cols = cols
  capture.rows = rows
}

export function removeTerminalInspection(surfaceId: string): void {
  captures.delete(surfaceId)
}

export function clearTerminalInspections(): void {
  captures.clear()
}

function parseStat(
  stat: string
): { parentPid: number; processGroup: number; foregroundGroup: number } | null {
  const close = stat.lastIndexOf(')')
  if (close < 0) return null
  const fields = stat.slice(close + 2).split(' ')
  const parentPid = Number(fields[1])
  const processGroup = Number(fields[2])
  const foregroundGroup = Number(fields[5])
  if (
    !Number.isInteger(parentPid) ||
    !Number.isInteger(processGroup) ||
    !Number.isInteger(foregroundGroup)
  ) {
    return null
  }
  return { parentPid, processGroup, foregroundGroup }
}

const COMMAND_RUNNERS = new Set([
  'node',
  'nodejs',
  'python',
  'python3',
  'bun',
  'bunx',
  'deno',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'uv'
])
const RUNNER_WORDS = new Set(['run', 'exec', 'x', '-m'])

function safeCommandToken(value: string): string | undefined {
  const token = basename(value).replace(/\.(?:c?js|mjs|py)$/i, '')
  return token && token.length <= 80 && /^[A-Za-z0-9@+_.-]+$/.test(token) ? token : undefined
}

function meaningfulCommandToken(value: string): string | undefined {
  const token = safeCommandToken(value)
  if (!token || !['cli', 'index', 'main', '__main__'].includes(token.toLowerCase())) return token
  return safeCommandToken(dirname(value)) ?? token
}

function processCommand(pid: number, name: string): string | undefined {
  let executable: string | undefined
  try {
    executable = safeCommandToken(readlinkSync(`/proc/${pid}/exe`))
  } catch {
    // The process may have exited between /proc reads.
  }

  let argv: string[] = []
  try {
    argv = readFileSync(`/proc/${pid}/cmdline`).toString('utf8').split('\0').filter(Boolean)
  } catch {
    // Fall back to comm/exe below.
  }

  const first = meaningfulCommandToken(argv[0] ?? '') ?? executable ?? safeCommandToken(name)
  if (!first || !COMMAND_RUNNERS.has(first.toLowerCase())) return first
  for (const value of argv.slice(1, 6)) {
    const raw = value.trim()
    if (!raw || (raw.startsWith('-') && raw !== '-m')) continue
    const token = meaningfulCommandToken(raw)
    if (token && !RUNNER_WORDS.has(token.toLowerCase())) return token
  }
  return first
}

function readProcessIdentity(pid: number): ForegroundProcess | null {
  try {
    const name = readFileSync(`/proc/${pid}/comm`, 'utf8').trim()
    const command = processCommand(pid, name)
    return { pid, name, ...(command ? { command } : {}) }
  } catch {
    return null
  }
}

function linuxProcessContext(shellPid: number): ProcessContext {
  if (process.platform !== 'linux') return { foreground: null }
  try {
    const shellStat = parseStat(readFileSync(`/proc/${shellPid}/stat`, 'utf8'))
    const foregroundPid = shellStat?.foregroundGroup ?? shellPid
    const usablePid = foregroundPid > 0 ? foregroundPid : shellPid
    const processes: ForegroundProcess[] = []
    const visited = new Set<number>()
    let currentPid = usablePid
    for (let depth = 0; depth < 16 && currentPid > 1 && !visited.has(currentPid); depth++) {
      visited.add(currentPid)
      const identity = readProcessIdentity(currentPid)
      if (identity) processes.push(identity)
      if (currentPid === shellPid) break
      const stat = parseStat(readFileSync(`/proc/${currentPid}/stat`, 'utf8'))
      if (!stat || stat.parentPid <= 1) break
      currentPid = stat.parentPid
    }
    let cwd: string | undefined
    try {
      cwd = readlinkSync(`/proc/${usablePid}/cwd`)
    } catch {
      cwd = readlinkSync(`/proc/${shellPid}/cwd`)
    }
    return { foreground: processes[0] ?? null, processes, cwd }
  } catch {
    return { foreground: null }
  }
}

export function listTerminalProcessContexts(
  processContext: (pid: number) => ProcessContext = linuxProcessContext
): TerminalProcessContext[] {
  return [...captures.values()].map((capture) => {
    const context = processContext(capture.pid)
    const processes = context.processes ?? (context.foreground ? [context.foreground] : [])
    return {
      surfaceId: capture.surfaceId,
      ...(capture.workspaceId ? { workspaceId: capture.workspaceId } : {}),
      shellPid: capture.pid,
      processes,
      lastActivityAt: Math.max(capture.lastInputAt, capture.lastOutputAt)
    }
  })
}

function plainTerminalText(raw: string): string {
  return raw
    // Terminal protocols are defined by these control-byte sequences.
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\](?:(?!\x07|\x1b\\)[\s\S])*(?:\x07|\x1b\\|$)/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x09\x0a\x20-\x7e\u00a0-\uffff]/g, '')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
}

function tailBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buffer = Buffer.from(text)
  if (buffer.length <= maxBytes) return { text, truncated: false }
  const tailed = buffer
    .subarray(buffer.length - maxBytes)
    .toString('utf8')
    .replace(/^\ufffd/, '')
  return { text: tailed, truncated: true }
}

export function inspectTerminal(
  surfaceId: string,
  options: TerminalInspectionOptions,
  processContext: (pid: number) => ProcessContext = linuxProcessContext
): TerminalInspection | null {
  const capture = captures.get(surfaceId)
  if (!capture) return null
  const plain = plainTerminalText(capture.output.toString('utf8'))
  const allLines = plain.split('\n')
  const lineTruncated = allLines.length > options.lines
  const lineTail = allLines.slice(-options.lines).join('\n')
  const byteTail = tailBytes(lineTail, options.maxBytes)
  const text = byteTail.text
  const context = processContext(capture.pid)
  return {
    surfaceId: capture.surfaceId,
    ...(capture.workspaceId ? { workspaceId: capture.workspaceId } : {}),
    pid: capture.pid,
    foreground: context.foreground,
    cwd: context.cwd ?? capture.initialCwd,
    cols: capture.cols,
    rows: capture.rows,
    createdAt: capture.createdAt,
    output: {
      text,
      lines: text ? text.split('\n').length : 0,
      bytes: Buffer.byteLength(text),
      truncated: capture.droppedBytes > 0 || lineTruncated || byteTail.truncated
    }
  }
}
