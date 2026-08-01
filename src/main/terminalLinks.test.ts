import assert from 'node:assert/strict'
import {
  normalizeTerminalExternalUrl,
  openTerminalLinkTarget,
  readTerminalShellCwd,
  resolveTerminalFileReference,
  terminalFileReferencesExist,
  type TerminalLinkDependencies
} from './terminalLinks'

const existing = new Set(['/project/src/main.ts', '/home/test/notes.md', '/project/docs'])
const openedExternal: string[] = []
const openedPaths: string[] = []
const dependencies: TerminalLinkDependencies = {
  homeDirectory: () => '/home/test',
  pathKind: (path) => {
    if (!existing.has(path)) return null
    return path === '/project/docs' ? 'directory' : 'file'
  },
  openExternal: async (url) => {
    openedExternal.push(url)
  },
  openPath: async (path) => {
    openedPaths.push(path)
    return ''
  }
}

async function main(): Promise<void> {
  assert.equal(
    normalizeTerminalExternalUrl('https://example.com/docs?q=1'),
    'https://example.com/docs?q=1'
  )
  assert.equal(normalizeTerminalExternalUrl('javascript:alert(1)'), null)
  assert.equal(normalizeTerminalExternalUrl('https://user:secret@example.com'), null)
  assert.equal(normalizeTerminalExternalUrl('https://example.com\nmalicious'), null)

  assert.equal(
    resolveTerminalFileReference({ path: 'src/main.ts', line: 42 }, '/project', dependencies),
    '/project/src/main.ts'
  )
  assert.equal(
    resolveTerminalFileReference({ path: '~/notes.md' }, '/project', dependencies),
    '/home/test/notes.md'
  )
  assert.equal(
    resolveTerminalFileReference({ path: 'file:///project/src/main.ts' }, '/project', dependencies),
    '/project/src/main.ts'
  )
  assert.equal(
    resolveTerminalFileReference(
      { path: 'file://remote/project/src/main.ts' },
      '/project',
      dependencies
    ),
    null
  )
  assert.equal(resolveTerminalFileReference({ path: 'missing.ts' }, '/project', dependencies), null)
  assert.equal(
    resolveTerminalFileReference({ path: 'docs' }, '/project', dependencies),
    '/project/docs'
  )

  assert.deepEqual(
    terminalFileReferencesExist(
      [{ path: 'src/main.ts' }, { path: 'missing.ts' }, { path: 'docs' }],
      '/project',
      dependencies
    ),
    [true, false, true]
  )

  assert.equal(
    readTerminalShellCwd(42, (path) => (path === '/proc/42/cwd' ? '/project' : '')),
    '/project'
  )
  assert.equal(
    readTerminalShellCwd(0, () => '/project'),
    null
  )
  assert.equal(
    readTerminalShellCwd(42, () => 'relative'),
    null
  )

  assert.deepEqual(
    await openTerminalLinkTarget(
      { kind: 'url', url: 'https://example.com/docs' },
      '/project',
      dependencies
    ),
    { ok: true }
  )
  assert.deepEqual(openedExternal, ['https://example.com/docs'])

  assert.deepEqual(
    await openTerminalLinkTarget(
      { kind: 'file', path: 'src/main.ts', line: 42 },
      '/project',
      dependencies
    ),
    { ok: true }
  )
  assert.deepEqual(openedPaths, ['/project/src/main.ts'])
  assert.deepEqual(
    await openTerminalLinkTarget({ kind: 'file', path: 'missing.ts' }, '/project', dependencies),
    { ok: false, error: 'target-not-found' }
  )

  console.log('✅ ALL TERMINAL LINK MAIN-PROCESS TESTS PASS')
}

void main()
