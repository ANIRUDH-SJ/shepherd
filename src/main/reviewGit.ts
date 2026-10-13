import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ReviewCommitRequest,
  ReviewDiff,
  ReviewDiffRequest,
  ReviewFileRequest,
  ReviewPullRequestDiff,
  ReviewRootRequest,
  ReviewStatus,
  ReviewTestResult
} from '../shared/review'
import { parseReviewStatus } from './reviewStatus'

function git(cwd: string, args: string[], limit = 1024 * 1024, timeout = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      { encoding: 'utf8', maxBuffer: limit, timeout },
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    )
  })
}

async function rootFor(cwd: string, expected?: string): Promise<string> {
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'], 4096)).trimEnd()
  if (!root.startsWith('/')) throw new Error('No Git repository found for this terminal')
  if (expected !== undefined && root !== expected)
    throw new Error('Terminal repository changed; refresh review')
  return root
}

function hasNpmTest(root: string): boolean {
  try {
    const content = readFileSync(join(root, 'package.json'), 'utf8')
    if (content.length > 256 * 1024) return false
    const manifest = JSON.parse(content) as { scripts?: { test?: unknown } }
    return typeof manifest.scripts?.test === 'string'
  } catch {
    return false
  }
}

async function statusAt(root: string): Promise<ReviewStatus> {
  const [porcelain, branch] = await Promise.all([
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], 4096).catch(() => '')
  ])
  const { files, truncated } = parseReviewStatus(porcelain)
  return { root, branch: branch.trim() || null, files, truncated, canRunNpmTest: hasNpmTest(root) }
}

async function currentFile(root: string, path: string): Promise<ReviewStatus['files'][number]> {
  const status = await statusAt(root)
  const file = status.files.find((candidate) => candidate.path === path)
  if (!file) throw new Error('File is no longer in the changed-files list; refresh review')
  return file
}

export async function reviewStatus(cwd: string): Promise<ReviewStatus> {
  return statusAt(await rootFor(cwd))
}

export async function reviewDiff(cwd: string, request: ReviewDiffRequest): Promise<ReviewDiff> {
  const root = await rootFor(cwd, request.root)
  const file = await currentFile(root, request.path)
  if (request.section === 'staged' && !file.staged) throw new Error('No staged diff for this file')
  if (request.section === 'unstaged' && !file.unstaged)
    throw new Error('No unstaged diff for this file')
  try {
    const text = await git(
      root,
      [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-color',
        ...(request.section === 'staged' ? ['--cached'] : []),
        '--',
        file.path
      ],
      256 * 1024
    )
    return { path: file.path, section: request.section, text, truncated: false }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw error
    return {
      path: file.path,
      section: request.section,
      text: 'Diff exceeds 256 KiB. Review this file in the terminal.',
      truncated: true
    }
  }
}

export async function reviewStage(cwd: string, request: ReviewFileRequest): Promise<ReviewStatus> {
  const root = await rootFor(cwd, request.root)
  const file = await currentFile(root, request.path)
  if (file.conflicted) throw new Error('Resolve conflicts in the terminal first')
  await git(root, ['add', '--', file.path])
  return statusAt(root)
}

export async function reviewUnstage(
  cwd: string,
  request: ReviewFileRequest
): Promise<ReviewStatus> {
  const root = await rootFor(cwd, request.root)
  const file = await currentFile(root, request.path)
  if (!file.staged || file.conflicted) throw new Error('File cannot be unstaged here')
  await git(root, ['restore', '--staged', '--', file.path])
  return statusAt(root)
}

export async function reviewCommit(
  cwd: string,
  request: ReviewCommitRequest
): Promise<ReviewStatus> {
  const root = await rootFor(cwd, request.root)
  const status = await statusAt(root)
  if (status.truncated) throw new Error('Too many changed files; commit from the terminal')
  if (!status.files.some((file) => file.staged && !file.conflicted))
    throw new Error('Stage at least one file before committing')
  if (status.files.some((file) => file.conflicted))
    throw new Error('Resolve conflicts before committing')
  await git(root, ['commit', '-m', request.message.trim()], 64 * 1024, 120_000)
  return statusAt(root)
}

export async function reviewTest(
  cwd: string,
  request: ReviewRootRequest
): Promise<ReviewTestResult> {
  const root = await rootFor(cwd, request.root)
  if (!hasNpmTest(root)) throw new Error('This repository has no npm test script')
  return new Promise((resolve) => {
    execFile(
      'npm',
      ['test'],
      { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024, timeout: 300_000 },
      (error, stdout, stderr) => {
        const output = `${stdout}${stderr}`.slice(-64 * 1024)
        resolve({
          ok: !error,
          output: output || (error ? error.message : 'Tests passed without output.'),
          truncated:
            (error as NodeJS.ErrnoException | null)?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ||
            stdout.length + stderr.length > 64 * 1024
        })
      }
    )
  })
}

export async function reviewPullRequestDiff(
  cwd: string,
  request: ReviewRootRequest
): Promise<ReviewPullRequestDiff> {
  const root = await rootFor(cwd, request.root)
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      ['pr', 'diff', '--patch', '--color=never'],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, GH_PROMPT_DISABLED: '1' },
        maxBuffer: 256 * 1024,
        timeout: 15_000
      },
      (error, stdout) => {
        if (
          error &&
          (error as NodeJS.ErrnoException).code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
        ) {
          reject(error)
          return
        }
        const text = stdout.slice(0, 128 * 1024)
        resolve({
          text,
          truncated: Boolean(error) || stdout.length > 128 * 1024
        })
      }
    )
  })
}
