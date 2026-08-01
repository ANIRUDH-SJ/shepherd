import assert from 'node:assert/strict'
import {
  MAX_TERMINAL_LINK_CANDIDATES,
  isOpenTerminalLinkRequest,
  isResolveTerminalFileLinksRequest,
  isTerminalFileReference
} from './terminalLinks'

assert.equal(isTerminalFileReference({ path: 'src/main/index.ts', line: 42, column: 7 }), true)
assert.equal(isTerminalFileReference({ path: 'README.md' }), true)
assert.equal(isTerminalFileReference({ path: 'README.md', column: 4 }), false)
assert.equal(isTerminalFileReference({ path: 'README.md', line: 0 }), false)
assert.equal(isTerminalFileReference({ path: 'bad\npath' }), false)

assert.equal(
  isResolveTerminalFileLinksRequest({
    id: 'term-1',
    candidates: [{ path: 'src/main/index.ts', line: 42 }]
  }),
  true
)
assert.equal(
  isResolveTerminalFileLinksRequest({
    id: 'term-1',
    candidates: Array.from({ length: MAX_TERMINAL_LINK_CANDIDATES + 1 }, () => ({
      path: 'README.md'
    }))
  }),
  false
)

assert.equal(
  isOpenTerminalLinkRequest({ id: 'term-1', target: { kind: 'url', url: 'https://example.com' } }),
  true
)
assert.equal(
  isOpenTerminalLinkRequest({
    id: 'term-1',
    target: { kind: 'file', path: 'src/main/index.ts', line: 42 }
  }),
  true
)
assert.equal(
  isOpenTerminalLinkRequest({ id: 'term-1', target: { kind: 'url', url: 'bad\u0000url' } }),
  false
)
assert.equal(
  isOpenTerminalLinkRequest({ id: 'term-1', target: { kind: 'command', value: 'rm -rf /' } }),
  false
)

console.log('✅ ALL TERMINAL LINK IPC CONTRACT TESTS PASS')
