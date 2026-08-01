import { statSync, readlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MAX_TERMINAL_URL_LENGTH,
  hasTerminalLinkControlCharacters,
  isTerminalFileReference,
  type OpenTerminalLinkResult,
  type TerminalFileReference,
  type TerminalLinkTarget
} from '../shared/terminalLinks'

const MAX_RESOLVED_PATH_LENGTH = 4096

export interface TerminalLinkDependencies {
  homeDirectory(): string
  pathKind(path: string): 'file' | 'directory' | null
  openExternal(url: string): Promise<void>
  openPath(path: string): Promise<string>
}

const defaultDependencies: TerminalLinkDependencies = {
  homeDirectory: homedir,
  pathKind: (path) => {
    try {
      const stats = statSync(path)
      if (stats.isFile()) return 'file'
      if (stats.isDirectory()) return 'directory'
    } catch {
      // The candidate disappeared, is inaccessible, or was never a path.
    }
    return null
  },
  openExternal: async () => {
    throw new Error('openExternal dependency is required')
  },
  openPath: async () => 'openPath dependency is required'
}

export function normalizeTerminalExternalUrl(value: string): string | null {
  if (
    !value ||
    value.length > MAX_TERMINAL_URL_LENGTH ||
    hasTerminalLinkControlCharacters(value)
  ) {
    return null
  }
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (!url.hostname || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

function fileUrlPath(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'file:' || url.search || url.hash) return null
    if (url.hostname && url.hostname !== 'localhost') return null
    return fileURLToPath(url)
  } catch {
    return null
  }
}

export function resolveTerminalFileReference(
  reference: TerminalFileReference,
  cwd: string,
  dependencies: Pick<TerminalLinkDependencies, 'homeDirectory' | 'pathKind'> = defaultDependencies
): string | null {
  if (
    !isTerminalFileReference(reference) ||
    !isAbsolute(cwd) ||
    hasTerminalLinkControlCharacters(cwd)
  ) {
    return null
  }

  let candidate: string
  if (/^file:/iu.test(reference.path)) {
    const filePath = fileUrlPath(reference.path)
    if (!filePath) return null
    candidate = filePath
  } else if (reference.path.startsWith('~/')) {
    candidate = join(dependencies.homeDirectory(), reference.path.slice(2))
  } else {
    candidate = isAbsolute(reference.path) ? reference.path : resolve(cwd, reference.path)
  }

  if (
    !isAbsolute(candidate) ||
    candidate.length > MAX_RESOLVED_PATH_LENGTH ||
    candidate.length < 1 ||
    hasTerminalLinkControlCharacters(candidate)
  ) {
    return null
  }
  return dependencies.pathKind(candidate) ? candidate : null
}

export function readTerminalShellCwd(
  pid: number,
  readlink: (path: string) => string = readlinkSync
): string | null {
  if (!Number.isSafeInteger(pid) || pid < 1) return null
  try {
    const cwd = readlink(`/proc/${pid}/cwd`)
    return isAbsolute(cwd) && !hasTerminalLinkControlCharacters(cwd) ? cwd : null
  } catch {
    return null
  }
}

export async function openTerminalLinkTarget(
  target: TerminalLinkTarget,
  cwd: string,
  dependencies: TerminalLinkDependencies
): Promise<OpenTerminalLinkResult> {
  if (target.kind === 'url') {
    const url = normalizeTerminalExternalUrl(target.url)
    if (!url) return { ok: false, error: 'invalid-request' }
    try {
      await dependencies.openExternal(url)
      return { ok: true }
    } catch {
      return { ok: false, error: 'open-failed' }
    }
  }

  const path = resolveTerminalFileReference(target, cwd, dependencies)
  if (!path) return { ok: false, error: 'target-not-found' }
  try {
    const error = await dependencies.openPath(path)
    return error ? { ok: false, error: 'open-failed' } : { ok: true }
  } catch {
    return { ok: false, error: 'open-failed' }
  }
}

export function terminalFileReferencesExist(
  candidates: TerminalFileReference[],
  cwd: string,
  dependencies: Pick<TerminalLinkDependencies, 'homeDirectory' | 'pathKind'> = defaultDependencies
): boolean[] {
  return candidates.map(
    (candidate) => resolveTerminalFileReference(candidate, cwd, dependencies) !== null
  )
}
