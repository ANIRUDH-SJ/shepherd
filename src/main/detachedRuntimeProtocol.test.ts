import assert from 'node:assert/strict'
import {
  MAX_RUNTIME_FRAME_BYTES,
  parseRuntimeRequest,
  RuntimeFrameDecoder
} from './detachedRuntimeProtocol'

const token = 'a'.repeat(64)
const create = {
  version: 1,
  requestId: 'request-1',
  token,
  operation: 'create',
  terminalId: 'pane-1',
  workspaceId: 'workspace-1',
  cwd: '/tmp',
  cols: 80,
  rows: 24
}

assert.deepEqual(parseRuntimeRequest(create), create)
assert.equal(parseRuntimeRequest({ ...create, token: 'bad' }), null)
assert.equal(parseRuntimeRequest({ ...create, rows: 0 }), null)
assert.equal(parseRuntimeRequest({ ...create, cols: 501 }), null)
assert.equal(parseRuntimeRequest({ ...create, cwd: '/tmp\u0000evil' }), null)
assert.equal(parseRuntimeRequest({ ...create, executable: '/bin/sh' }), null)
assert.equal(parseRuntimeRequest({ ...create, operation: 'attach', cols: undefined }), null)
assert.equal(
  parseRuntimeRequest({
    version: 1,
    requestId: 'input',
    token,
    operation: 'input',
    terminalId: 'pane-1',
    data: '𝄞'.repeat(8193)
  }),
  null,
  'input is limited by UTF-8 byte length, not JS string length'
)

const decoder = new RuntimeFrameDecoder()
assert.deepEqual(decoder.push(Buffer.from('{"version":1,"requestId":"a"')), [])
assert.deepEqual(decoder.push(Buffer.from('}\n{"version":1}\n')), [
  { version: 1, requestId: 'a' },
  { version: 1 }
])
assert.throws(() => new RuntimeFrameDecoder().push(Buffer.alloc(MAX_RUNTIME_FRAME_BYTES + 1, 65)))
assert.throws(() => new RuntimeFrameDecoder().push(Buffer.from('not json\n')))

console.log('detached runtime protocol tests passed')
