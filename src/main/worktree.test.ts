import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createGitWorktree, normalizeWorktreeRequest } from './worktree'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'shepherd-worktree-test-'))
  const repo = join(root, 'repo')
  const worktree = join(root, 'feature-worktree')
  const existingWorktree = join(root, 'existing-worktree')

  try {
    execFileSync('git', ['init', repo], { stdio: 'ignore' })
    execFileSync('git', ['-C', repo, 'config', 'user.name', 'shepherd test'])
    execFileSync('git', ['-C', repo, 'config', 'user.email', 'shepherd@example.invalid'])
    execFileSync('git', ['-C', repo, 'commit', '--allow-empty', '-m', 'initial'], {
      stdio: 'ignore'
    })
    execFileSync('git', ['-C', repo, 'branch', 'existing', 'HEAD'])

    const validation = normalizeWorktreeRequest({
      repo,
      path: worktree,
      newBranch: 'feature/agent-workflow',
      startPoint: 'HEAD'
    })
    assert(validation.ok, 'normalizes a new-branch worktree request')
    if (validation.ok) {
      assert(
        validation.request.name === 'feature/agent-workflow',
        'defaults workspace name to branch'
      )
      const created = await createGitWorktree(validation.request)
      assert(created.ok, 'creates the Git worktree')
      if (created.ok) {
        assert(created.worktree.path === worktree, 'returns the canonical worktree path')
        assert(created.worktree.createdBranch, 'reports new branch creation')
        assert(existsSync(join(worktree, '.git')), 'creates worktree Git metadata')
      }
    }

    const existingValidation = normalizeWorktreeRequest({
      repo,
      path: existingWorktree,
      branch: 'existing'
    })
    if (existingValidation.ok) {
      const existing = await createGitWorktree(existingValidation.request)
      assert(existing.ok && !existing.worktree.createdBranch, 'attaches an existing branch')
    } else {
      assert(false, 'attaches an existing branch')
    }

    assert(
      !normalizeWorktreeRequest({ repo: 'relative', path: worktree, branch: 'main' }).ok,
      'requires an absolute repository path'
    )
    assert(
      !normalizeWorktreeRequest({ repo, path: worktree, branch: 'main', newBranch: 'other' }).ok,
      'requires exactly one branch mode'
    )
    assert(
      !normalizeWorktreeRequest({ repo, path: worktree, branch: 'main', startPoint: 'HEAD' }).ok,
      'limits start point to new branches'
    )
  } finally {
    for (const path of [worktree, existingWorktree]) {
      try {
        execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', path], {
          stdio: 'ignore'
        })
      } catch {
        // The worktree may not have been created after an earlier failure.
      }
    }
    rmSync(root, { recursive: true, force: true })
  }

  if (failures > 0) throw new Error(`${failures} worktree test(s) failed`)
  console.log('\n✅ ALL WORKTREE TESTS PASS')
}

void main()
