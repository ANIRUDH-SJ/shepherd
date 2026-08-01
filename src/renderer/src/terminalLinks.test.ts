import assert from 'node:assert/strict'
import type { IBufferCell, IBufferLine, ILink, Terminal } from '@xterm/xterm'
import {
  MAX_TERMINAL_LINK_CANDIDATES,
  TerminalFileLinkProvider,
  findTerminalFileLinks,
  snapshotTerminalLine,
  terminalFileLinkRange,
  terminalOscLinkTarget,
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

assert.deepEqual(terminalOscLinkTarget('https://example.com/docs'), {
  kind: 'url',
  url: 'https://example.com/docs'
})
assert.deepEqual(terminalOscLinkTarget('file:///project/src/main.ts'), {
  kind: 'file',
  path: 'file:///project/src/main.ts'
})
assert.equal(terminalOscLinkTarget('javascript:alert(1)'), null)
assert.equal(terminalOscLinkTarget('relative/file.ts'), null)

function fakeLine(cells: { chars: string; width: number }[]): IBufferLine {
  return {
    isWrapped: false,
    length: cells.length,
    getCell: (column) => {
      const cell = cells[column]
      if (!cell) return undefined
      return {
        getChars: () => cell.chars,
        getWidth: () => cell.width
      } as IBufferCell
    },
    translateToString: () => cells.map((cell) => cell.chars).join('')
  }
}

function textLine(text: string): IBufferLine {
  return fakeLine([...text].map((chars) => ({ chars, width: 1 })))
}

function fakeTerminal(line: IBufferLine): Pick<Terminal, 'buffer' | 'cols'> {
  return {
    cols: line.length,
    buffer: {
      active: {
        getLine: (index: number) => (index === 0 ? line : undefined)
      }
    }
  } as Pick<Terminal, 'buffer' | 'cols'>
}

function provideLinks(
  provider: TerminalFileLinkProvider,
  bufferLineNumber = 1
): Promise<ILink[] | undefined> {
  return new Promise((resolve) => provider.provideLinks(bufferLineNumber, resolve))
}

async function main(): Promise<void> {
  const wideLine = fakeLine([
    { chars: '界', width: 2 },
    { chars: '', width: 0 },
    { chars: ' ', width: 1 },
    ...[...'src/main.ts'].map((chars) => ({ chars, width: 1 }))
  ])
  const wideSnapshot = snapshotTerminalLine(wideLine, wideLine.length)
  assert.equal(wideSnapshot.text, '界 src/main.ts')
  assert.deepEqual(
    terminalFileLinkRange(findTerminalFileLinks(wideSnapshot.text)[0], wideSnapshot, 4),
    { start: { x: 4, y: 4 }, end: { x: 14, y: 4 } },
    'maps UTF-16 parser offsets back to xterm cells after a wide glyph'
  )

  const activated: string[] = []
  const provider = new TerminalFileLinkProvider(
    fakeTerminal(textLine('src/main.ts missing.ts')),
    async () => [true, false],
    (event, candidate) => {
      if (terminalLinkModifierPressed(event)) activated.push(candidate.path)
    }
  )
  const links = await provideLinks(provider)
  assert.equal(links?.length, 1, 'only exposes existing paths as links')
  links?.[0].activate({ ctrlKey: false, metaKey: false } as MouseEvent, links[0].text)
  assert.deepEqual(activated, [], 'ordinary click remains available for focus and selection')
  links?.[0].activate({ ctrlKey: true, metaKey: false } as MouseEvent, links[0].text)
  assert.deepEqual(activated, ['src/main.ts'])

  let resolvePending!: (exists: boolean[]) => void
  const staleProvider = new TerminalFileLinkProvider(
    fakeTerminal(textLine('src/main.ts')),
    () => new Promise((resolve) => (resolvePending = resolve)),
    () => undefined
  )
  const staleResult = provideLinks(staleProvider)
  staleProvider.dispose()
  resolvePending([true])
  assert.equal(await staleResult, undefined, 'drops asynchronous results after disposal')

  console.log('✅ ALL TERMINAL LINK RENDERER TESTS PASS')
}

void main()
