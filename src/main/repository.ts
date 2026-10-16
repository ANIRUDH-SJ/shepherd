import { execFile } from 'node:child_process'
import { realpathSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { IPC } from '../shared/ipc'
import { validRepositoryRoot } from '../shared/repository'
import { ipcMain } from 'electron'

export interface RepositoryResolution {
  root: string
  name: string
}

export async function resolveGitRepository(path: unknown): Promise<RepositoryResolution> {
  if (!validRepositoryRoot(path) || !isAbsolute(path))
    throw new Error('Choose an absolute directory')
  const directory = realpathSync(path)
  if (!statSync(directory).isDirectory()) throw new Error('Choose a directory')
  const root = await new Promise<string>((resolve, reject) => {
    execFile(
      'git',
      ['-C', directory, 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', maxBuffer: 8192, timeout: 10_000 },
      (error, stdout) =>
        error ? reject(new Error('Not a Git repository')) : resolve(stdout.trim())
    )
  })
  if (!validRepositoryRoot(root)) throw new Error('Invalid Git repository root')
  const canonicalRoot = realpathSync(root)
  return {
    root: canonicalRoot,
    name: canonicalRoot.split('/').filter(Boolean).at(-1) ?? canonicalRoot
  }
}

export function registerRepositoryIpc(): void {
  ipcMain.handle(IPC.WORKSPACE_RESOLVE_REPOSITORY, (_event, path: unknown) =>
    resolveGitRepository(path)
  )
}
