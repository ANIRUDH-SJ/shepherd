import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  reviewCommit,
  reviewDiff,
  reviewStage,
  reviewStatus,
  reviewTest,
  reviewUnstage
} from './reviewGit'

const root = mkdtempSync(join(tmpdir(), 'shepherd-review-test-'))
const git = (...args: string[]): string =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })

async function run(): Promise<void> {
  try {
    git('init', '-q')
    git('config', 'user.name', 'Shepherd Test')
    git('config', 'user.email', 'shepherd-test@example.invalid')
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ scripts: { test: 'node -e "console.log(\'ok\')"' } })
    )
    writeFileSync(join(root, 'tracked.txt'), 'before\n')
    git('add', '--', 'package.json', 'tracked.txt')
    git('commit', '-qm', 'initial')

    writeFileSync(join(root, 'tracked.txt'), 'after\n')
    writeFileSync(join(root, '-untracked.txt'), 'new\n')
    const status = await reviewStatus(root)
    assert.equal(status.root, root)
    assert.equal(status.canRunNpmTest, true)
    assert.equal(status.files.find((file) => file.path === 'tracked.txt')?.unstaged, true)
    assert.equal(status.files.find((file) => file.path === '-untracked.txt')?.untracked, true)

    const changed = await reviewDiff(root, {
      surfaceId: 'term',
      root,
      path: 'tracked.txt',
      section: 'unstaged'
    })
    assert.match(changed.text, /-before/)
    assert.match(changed.text, /\+after/)

    const staged = await reviewStage(root, { surfaceId: 'term', root, path: '-untracked.txt' })
    assert.equal(staged.files.find((file) => file.path === '-untracked.txt')?.staged, true)
    const stagedDiff = await reviewDiff(root, {
      surfaceId: 'term',
      root,
      path: '-untracked.txt',
      section: 'staged'
    })
    assert.match(stagedDiff.text, /\+new/)

    const unstaged = await reviewUnstage(root, { surfaceId: 'term', root, path: '-untracked.txt' })
    assert.equal(unstaged.files.find((file) => file.path === '-untracked.txt')?.untracked, true)
    await assert.rejects(reviewCommit(root, { surfaceId: 'term', root, message: 'nothing staged' }))
    await assert.rejects(
      reviewStage(root, { surfaceId: 'term', root: '/different', path: 'tracked.txt' })
    )

    await reviewStage(root, { surfaceId: 'term', root, path: 'tracked.txt' })
    const committed = await reviewCommit(root, {
      surfaceId: 'term',
      root,
      message: 'update tracked'
    })
    assert.equal(git('log', '-1', '--format=%s').trim(), 'update tracked')
    assert.equal(
      committed.files.find((file) => file.path === 'tracked.txt'),
      undefined
    )
    assert.equal(committed.files.find((file) => file.path === '-untracked.txt')?.untracked, true)

    const testResult = await reviewTest(root, { surfaceId: 'term', root })
    assert.equal(testResult.ok, true)
    assert.match(testResult.output, /ok/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  console.log('✅ ALL REVIEW GIT TESTS PASS')
}

void run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
