import assert from 'node:assert/strict'
import {
  MAX_TERMINAL_LINK_CANDIDATES,
  findTerminalFileLinks,
  terminalLinkModifierPressed
} from './terminalLinks'

assert.deepEqual(findTerminalFileLinks('edited src/main/index.ts:42:7'), [
  {
    text: 'src/main/index.ts:42:7',
    path: 'src/main/index.ts',
    startIndex: 7,
    endIndex: 29,
    line: 42,
    column: 7
  }
])

assert.deepEqual(
  findTerminalFileLinks('See `/tmp/project/readme.md:9`, ~/notes/todo.md and ../shared/types.ts.'),
  [
    {
      text: '/tmp/project/readme.md:9',
      path: '/tmp/project/readme.md',
      startIndex: 5,
      endIndex: 29,
      line: 9
    },
    {
      text: '~/notes/todo.md',
      path: '~/notes/todo.md',
      startIndex: 32,
      endIndex: 47
    },
    {
      text: '../shared/types.ts',
      path: '../shared/types.ts',
      startIndex: 52,
      endIndex: 70
    }
  ]
)

assert.deepEqual(findTerminalFileLinks('Open README.md or .env'), [
  { text: 'README.md', path: 'README.md', startIndex: 5, endIndex: 14 },
  { text: '.env', path: '.env', startIndex: 18, endIndex: 22 }
])

assert.deepEqual(
  findTerminalFileLinks('https://example.com/src/main.ts and not-a-path and v1'),
  [],
  'does not reinterpret URLs or ordinary words as file paths'
)

assert.deepEqual(
  findTerminalFileLinks('bad.ts:0 bad.ts:1000001 good.ts:1'),
  [{ text: 'good.ts:1', path: 'good.ts', startIndex: 24, endIndex: 33, line: 1 }],
  'rejects invalid line metadata'
)

const many = Array.from({ length: 32 }, (_, index) => `src/file-${index}.ts`).join(' ')
assert.equal(
  findTerminalFileLinks(many).length,
  MAX_TERMINAL_LINK_CANDIDATES,
  'bounds candidates per rendered line'
)

assert.equal(terminalLinkModifierPressed({ ctrlKey: true, metaKey: false }), true)
assert.equal(terminalLinkModifierPressed({ ctrlKey: false, metaKey: true }), true)
assert.equal(terminalLinkModifierPressed({ ctrlKey: false, metaKey: false }), false)

console.log('✅ ALL TERMINAL LINK PARSER TESTS PASS')
