import assert from 'node:assert/strict'
import {
  createPreviewHistory,
  previewHistoryTarget,
  recordPreviewNavigation
} from './previewHistory'

const history = createPreviewHistory('http://localhost:3000/')
assert.equal(previewHistoryTarget(history, -1), null)
assert.equal(previewHistoryTarget(history, 1), null)

recordPreviewNavigation(history, 'http://localhost:3000/next')
assert.deepEqual(history, {
  entries: ['http://localhost:3000/', 'http://localhost:3000/next'],
  index: 1,
  pendingIndex: null
})
assert.equal(previewHistoryTarget(history, -1), 0)

Object.assign(history, { pendingIndex: 0 })
recordPreviewNavigation(history, 'http://localhost:3000/')
assert.equal(history.index, 0)
assert.equal(previewHistoryTarget(history, 1), 1)

recordPreviewNavigation(history, 'http://localhost:3000/replacement')
assert.deepEqual(history, {
  entries: ['http://localhost:3000/', 'http://localhost:3000/replacement'],
  index: 1,
  pendingIndex: null
})

console.log('previewHistory tests passed')
