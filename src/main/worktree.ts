import { execFile } from 'child_process'
import { existsSync, realpathSync, statSync } from 'fs'
import { isAbsolute, resolve } from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const MAX_PATH_LENGTH = 4096
const MAX_REF_LENGTH = 255

export interface WorktreeRequest {
  repo: string
  path: string
  branch: string
  createBranch: boolean
  startPoint?: string
  name: string
}

export type WorktreeValidation =
  { ok: true; request: WorktreeRequest } | { ok: false; error: string }

export type WorktreeResult =
  | {
      ok: true
      worktree: {
        repo: string
        path: string
        branch: string
        createdBranch: boolean
      }
    }
  | { ok: false; error: string }

function requiredText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  const hasControlCharacter = Array.from(normalized).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
  if (!normalized || normalized.length > maxLength || hasControlCharacter) {
    return null
  }
  return normalized
}

export function normalizeWorktreeRequest(params: Record<string, unknown>): WorktreeValidation {
  const repo = requiredText(params.repo, MAX_PATH_LENGTH)
  if (!repo || !isAbsolute(repo)) return { ok: false, error: 'repo must be an absolute path' }
  const path = requiredText(params.path, MAX_PATH_LENGTH)
  if (!path || !isAbsolute(path)) return { ok: false, error: 'path must be an absolute path' }

  const existingBranch = requiredText(params.branch, MAX_REF_LENGTH)
  const newBranch = requiredText(params.newBranch, MAX_REF_LENGTH)
  if (Boolean(existingBranch) === Boolean(newBranch)) {
    return { ok: false, error: 'provide exactly one of branch or newBranch' }
  }

  let startPoint: string | undefined
  if (params.startPoint !== undefined) {
    startPoint = requiredText(params.startPoint, MAX_REF_LENGTH) ?? undefined
    if (!startPoint) return { ok: false, error: 'startPoint must be a safe non-empty ref' }
    if (!newBranch) return { ok: false, error: 'startPoint is only valid with newBranch' }
  }

  const branch = newBranch ?? existingBranch!
  const name = params.name === undefined ? branch : requiredText(params.name, 64)
  if (!name) return { ok: false, error: 'name must be a non-empty string up to 64 characters' }

  return {
    ok: true,
    request: {
      repo: resolve(repo),
      path: resolve(path),
      branch,
      createBranch: Boolean(newBranch),
      ...(startPoint ? { startPoint } : {}),
      name
    }
  }
}

async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    ...(cwd ? { cwd } : {}),
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 1_048_576
  })
  return stdout.trim()
}

function commandError(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error)
  const candidate = error as { stderr?: unknown; message?: unknown }
  const stderr = typeof candidate.stderr === 'string' ? candidate.stderr.trim() : ''
  const message = typeof candidate.message === 'string' ? candidate.message : String(error)
  return (stderr || message).slice(0, 500)
}

export async function createGitWorktree(request: WorktreeRequest): Promise<WorktreeResult> {
  try {
    if (!existsSync(request.repo) || !statSync(request.repo).isDirectory()) {
      return { ok: false, error: `repository directory does not exist: ${request.repo}` }
    }
    if (existsSync(request.path)) {
      return { ok: false, error: `worktree path already exists: ${request.path}` }
    }

    const repo = realpathSync(await git(['-C', request.repo, 'rev-parse', '--show-toplevel']))
    await git(['check-ref-format', '--branch', request.branch], repo)

    const args = ['worktree', 'add']
    if (request.createBranch) args.push('-b', request.branch)
    args.push(
      '--',
      request.path,
      request.createBranch ? (request.startPoint ?? 'HEAD') : request.branch
    )
    await git(args, repo)

    return {
      ok: true,
      worktree: {
        repo,
        path: realpathSync(request.path),
        branch: request.branch,
        createdBranch: request.createBranch
      }
    }
  } catch (error) {
    return { ok: false, error: `cannot create worktree: ${commandError(error)}` }
  }
}
