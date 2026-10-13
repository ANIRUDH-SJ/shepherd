import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

/** Replace a session only after the complete next snapshot has been written. */
export function writeSessionSnapshot(path: string, state: unknown): void {
  const contents = JSON.stringify(state, null, 2)
  if (typeof contents !== 'string') throw new Error('Invalid session snapshot')
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    renameSync(temporaryPath, path)
  } catch (error) {
    try {
      unlinkSync(temporaryPath)
    } catch {
      // It may never have been created, or may have already been renamed.
    }
    throw error
  }
}
