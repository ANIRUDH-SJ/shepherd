import assert from 'node:assert/strict'
import { parseReviewStatus, MAX_REVIEW_FILES } from './reviewStatus'

assert.deepEqual(parseReviewStatus(''), { files: [], truncated: false })
assert.deepEqual(parseReviewStatus(' M src/a.ts\0A  src/b.ts\0?? new file.txt\0').files, [
  { path: 'src/a.ts', staged: false, unstaged: true, untracked: false, conflicted: false },
  { path: 'src/b.ts', staged: true, unstaged: false, untracked: false, conflicted: false },
  { path: 'new file.txt', staged: false, unstaged: false, untracked: true, conflicted: false }
])
assert.deepEqual(
  parseReviewStatus('R  new.ts\0old.ts\0').files.map((file) => file.path),
  ['new.ts']
)
assert.equal(parseReviewStatus('UU conflict.ts\0').files[0].conflicted, true)
assert.equal(
  parseReviewStatus(Array.from({ length: MAX_REVIEW_FILES + 1 }, (_, i) => `?? ${i}\0`).join(''))
    .truncated,
  true
)
assert.throws(() => parseReviewStatus('bad\0'))

console.log('✅ ALL REVIEW STATUS TESTS PASS')
