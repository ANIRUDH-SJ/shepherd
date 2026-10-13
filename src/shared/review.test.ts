import assert from 'node:assert/strict'
import {
  isReviewCommitRequest,
  isReviewDiffRequest,
  isReviewFileRequest,
  isReviewRequest,
  isReviewRootRequest
} from './review'

assert.equal(isReviewRequest({ surfaceId: 'term-1' }), true)
assert.equal(isReviewRequest({ surfaceId: '' }), false)
assert.equal(isReviewFileRequest({ surfaceId: 'term-1', root: '/repo', path: 'src/a.ts' }), true)
assert.equal(isReviewFileRequest({ surfaceId: 'term-1', root: 'relative', path: 'a' }), false)
assert.equal(isReviewFileRequest({ surfaceId: 'term-1', root: '/repo', path: 'a\0b' }), false)
assert.equal(
  isReviewDiffRequest({ surfaceId: 'term-1', root: '/repo', path: 'a', section: 'staged' }),
  true
)
assert.equal(
  isReviewDiffRequest({ surfaceId: 'term-1', root: '/repo', path: 'a', section: 'both' }),
  false
)
assert.equal(isReviewRootRequest({ surfaceId: 'term-1', root: '/repo' }), true)
assert.equal(
  isReviewCommitRequest({ surfaceId: 'term-1', root: '/repo', message: 'Fix bug' }),
  true
)
assert.equal(isReviewCommitRequest({ surfaceId: 'term-1', root: '/repo', message: ' ' }), false)
assert.equal(isReviewCommitRequest({ surfaceId: 'term-1', root: '/repo', message: 'a\nb' }), false)

console.log('✅ ALL REVIEW CONTRACT TESTS PASS')
