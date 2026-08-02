import { execFile } from 'child_process'
import { readdirSync, readFileSync, readlinkSync } from 'fs'
import type { WorkspacePullRequest } from '../shared/workspaceMetadata'

export const PULL_REQUEST_OUTPUT_LIMIT = 16 * 1024
export const MAX_LISTENING_PORTS = 16
export const MAX_PROC_ENTRIES = 4_096
export const MAX_OWNED_PROCESSES = 512
export const MAX_PROCESS_FDS = 1_024

export interface ListeningSocket {
  inode: string
  port: number
}

interface PullRequestJson {
  number?: unknown
  state?: unknown
  isDraft?: unknown
  url?: unknown
}

export function parsePullRequestJson(output: string): WorkspacePullRequest | null {
  if (!output || Buffer.byteLength(output) > PULL_REQUEST_OUTPUT_LIMIT) return null
  let parsed: PullRequestJson
  try {
    parsed = JSON.parse(output) as PullRequestJson
  } catch {
    return null
  }
  if (
    typeof parsed.number !== 'number' ||
    !Number.isSafeInteger(parsed.number) ||
    parsed.number < 1 ||
    typeof parsed.state !== 'string' ||
    typeof parsed.isDraft !== 'boolean' ||
    typeof parsed.url !== 'string' ||
    parsed.url.length === 0 ||
    parsed.url.length > 2_048 ||
    !/^https:\/\/github\.com\//i.test(parsed.url)
  ) {
    return null
  }
  const state = parsed.state.toUpperCase()
  if (!['OPEN', 'CLOSED', 'MERGED'].includes(state)) return null
  return {
    number: parsed.number,
    state:
      parsed.isDraft && state === 'OPEN'
        ? 'draft'
        : (state.toLowerCase() as 'open' | 'closed' | 'merged'),
    url: parsed.url
  }
}

export function pullRequestFromCommandResult(
  error: Error | null,
  output: string
): WorkspacePullRequest | null {
  return error ? null : parsePullRequestJson(output)
}

export function probePullRequest(cwd: string): Promise<WorkspacePullRequest | null> {
  return new Promise((resolve) => {
    execFile(
      'gh',
      ['pr', 'view', '--json', 'number,state,isDraft,url'],
      {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, GH_PROMPT_DISABLED: '1' },
        maxBuffer: PULL_REQUEST_OUTPUT_LIMIT,
        timeout: 2_000,
        windowsHide: true
      },
      (error, stdout) => resolve(pullRequestFromCommandResult(error, stdout))
    )
  })
}

export function parseListeningSocketTable(output: string): ListeningSocket[] {
  const sockets: ListeningSocket[] = []
  for (const line of output.split('\n').slice(1, MAX_PROC_ENTRIES + 1)) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 10 || fields[3] !== '0A') continue
    const local = fields[1]
    const separator = local.lastIndexOf(':')
    if (separator < 0) continue
    const port = Number.parseInt(local.slice(separator + 1), 16)
    const inode = fields[9]
    if (!Number.isInteger(port) || port < 1 || port > 65_535 || !/^\d+$/.test(inode)) continue
    sockets.push({ inode, port })
  }
  return sockets
}

export function collectOwnedProcessIds(
  shellPid: number,
  parentByPid: ReadonlyMap<number, number>,
  limit = MAX_OWNED_PROCESSES
): Set<number> {
  const boundedLimit = Math.max(1, Math.min(MAX_OWNED_PROCESSES, limit))
  const owned = new Set<number>([shellPid])
  let changed = true
  while (changed && owned.size < boundedLimit) {
    changed = false
    for (const [pid, parentPid] of parentByPid) {
      if (owned.size >= boundedLimit) break
      if (pid > 1 && !owned.has(pid) && owned.has(parentPid)) {
        owned.add(pid)
        changed = true
      }
    }
  }
  return owned
}

export function normalizeListeningPorts(ports: readonly number[]): number[] {
  return [...new Set(ports.filter((port) => Number.isInteger(port) && port > 0 && port <= 65_535))]
    .sort((left, right) => left - right)
    .slice(0, MAX_LISTENING_PORTS)
}

export function portsOwnedByProcesses(
  sockets: readonly ListeningSocket[],
  ownedPids: ReadonlySet<number>,
  socketInodesByPid: ReadonlyMap<number, ReadonlySet<string>>
): number[] {
  const ownedInodes = new Set<string>()
  for (const pid of ownedPids) {
    for (const inode of socketInodesByPid.get(pid) ?? []) ownedInodes.add(inode)
  }
  return normalizeListeningPorts(
    sockets.filter((socket) => ownedInodes.has(socket.inode)).map((socket) => socket.port)
  )
}

export function serverProcessIds(shellPid: number, ownedPids: ReadonlySet<number>): Set<number> {
  return new Set([...ownedPids].filter((pid) => pid !== shellPid))
}

function processParent(stat: string): number | null {
  const close = stat.lastIndexOf(')')
  if (close < 0) return null
  const parentPid = Number(stat.slice(close + 2).split(' ')[1])
  return Number.isInteger(parentPid) && parentPid >= 0 ? parentPid : null
}

function readParentMap(): Map<number, number> {
  const parents = new Map<number, number>()
  let entries: string[]
  try {
    entries = readdirSync('/proc')
      .filter((entry) => /^\d+$/.test(entry))
      .slice(0, MAX_PROC_ENTRIES)
  } catch {
    return parents
  }
  for (const entry of entries) {
    const pid = Number(entry)
    try {
      const parentPid = processParent(readFileSync(`/proc/${pid}/stat`, 'utf8'))
      if (parentPid !== null) parents.set(pid, parentPid)
    } catch {
      // Processes can exit between listing /proc and reading stat.
    }
  }
  return parents
}

function readSocketInodes(pid: number): Set<string> {
  const inodes = new Set<string>()
  let descriptors: string[]
  try {
    descriptors = readdirSync(`/proc/${pid}/fd`).slice(0, MAX_PROCESS_FDS)
  } catch {
    return inodes
  }
  for (const descriptor of descriptors) {
    try {
      const target = readlinkSync(`/proc/${pid}/fd/${descriptor}`)
      const match = target.match(/^socket:\[(\d+)\]$/)
      if (match) inodes.add(match[1])
    } catch {
      // Descriptors and processes are expected to disappear during a scan.
    }
  }
  return inodes
}

function readListeningSockets(): ListeningSocket[] {
  const sockets: ListeningSocket[] = []
  for (const path of ['/proc/net/tcp', '/proc/net/tcp6']) {
    try {
      sockets.push(...parseListeningSocketTable(readFileSync(path, 'utf8')))
    } catch {
      // A missing table or unsupported platform yields no context.
    }
  }
  return sockets
}

export function discoverListeningPorts(shellPid: number): number[] {
  if (process.platform !== 'linux' || !Number.isInteger(shellPid) || shellPid < 1) return []
  const sockets = readListeningSockets()
  if (sockets.length === 0) return []
  const ownedPids = collectOwnedProcessIds(shellPid, readParentMap())
  // The PTY shell can inherit Electron's own listening descriptors (for example,
  // a development debugging port). User-started servers run as shell descendants,
  // so exclude descriptors held only by the shell itself.
  const reportingPids = serverProcessIds(shellPid, ownedPids)
  const inodesByPid = new Map<number, Set<string>>()
  for (const pid of reportingPids) inodesByPid.set(pid, readSocketInodes(pid))
  return portsOwnedByProcesses(sockets, reportingPids, inodesByPid)
}
