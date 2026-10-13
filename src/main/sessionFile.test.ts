import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeSessionSnapshot } from './sessionFile'

const directory = mkdtempSync(join(tmpdir(), 'shepherd-session-test-'))
try {
  const path = join(directory, 'nested', 'session.json')
  writeSessionSnapshot(path, { workspaces: [{ id: 'first' }] })
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), {
    workspaces: [{ id: 'first' }]
  })
  assert.equal(statSync(path).mode & 0o777, 0o600)

  writeSessionSnapshot(path, { workspaces: [{ id: 'first' }, { id: 'second' }] })
  const completeSnapshot = readFileSync(path, 'utf8')
  assert.equal(JSON.parse(completeSnapshot).workspaces.length, 2)

  const circular: { self?: unknown } = {}
  circular.self = circular
  assert.throws(() => writeSessionSnapshot(path, circular))
  assert.equal(readFileSync(path, 'utf8'), completeSnapshot)
  assert.deepEqual(readdirSync(join(directory, 'nested')), ['session.json'])
} finally {
  rmSync(directory, { recursive: true, force: true })
}

console.log('✅ ALL SESSION-FILE TESTS PASS')
