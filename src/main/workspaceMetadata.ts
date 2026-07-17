import { execFile } from 'child_process'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, join, relative } from 'path'
import type { SocketApply, WorkspacesSync } from '../shared/ipc'
import {
  sameWorkspaceMetadata,
  workspaceProjectName,
  type WorkspaceMetadata
} from '../shared/workspaceMetadata'
import { listTerminalProcessContexts, type TerminalProcessContext } from './terminalInspection'

export const WORKSPACE_METADATA_SCAN_MS = 750
export const NO_GIT_RETRY_MS = 5_000

interface GitLocation {
  root: string
  gitDir: string
}

interface CachedWorkspaceMetadata {
  surfaceId: string
  cwd: string
  git: GitLocation | null
  probedAt: number
  metadata: WorkspaceMetadata
}

type WorkspaceTarget = WorkspacesSync['workspaces'][number]

interface WorkspaceMetadataDependencies {
  probeGit(cwd: string): Promise<GitLocation | null>
  readGitHead(gitDir: string): string | null
  home: string
}

function boundedPath(value: string): string | null {
  const trimmed = value.trim()
  return trimmed && trimmed.length <= 4096 && isAbsolute(trimmed) ? trimmed : null
}

export function parseGitLocation(output: string): GitLocation | null {
  const lines = output.trim().split('\n')
  if (lines.length !== 2) return null
  const root = boundedPath(lines[0])
  const gitDir = boundedPath(lines[1])
  return root && gitDir ? { root, gitDir } : null
}

export function branchFromGitHead(head: string, fallback: string | null = null): string | null {
  const value = head.trim()
  if (value.startsWith('ref: ')) {
    return (
      value
        .slice(5)
        .replace(/^refs\/heads\//, '')
        .replace(/^refs\//, '') || fallback
    )
  }
  return /^[0-9a-f]{7,64}$/i.test(value) ? `detached@${value.slice(0, 7)}` : fallback
}

function probeGit(cwd: string): Promise<GitLocation | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', cwd, 'rev-parse', '--show-toplevel', '--absolute-git-dir'],
      { encoding: 'utf8', maxBuffer: 8 * 1024, timeout: 1_500, windowsHide: true },
      (error, stdout) => resolve(error ? null : parseGitLocation(stdout))
    )
  })
}

function readGitHead(gitDir: string): string | null {
  try {
    return readFileSync(join(gitDir, 'HEAD'), 'utf8').trim()
  } catch {
    return null
  }
}

function inside(root: string, cwd: string): boolean {
  const child = relative(root, cwd)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

function makeMetadata(
  surfaceId: string,
  cwd: string,
  git: GitLocation | null,
  branch: string | null,
  home: string
): WorkspaceMetadata {
  return {
    surfaceId,
    cwd,
    projectName: workspaceProjectName(cwd, git?.root, home),
    gitRoot: git?.root ?? null,
    gitBranch: branch
  }
}

export class WorkspaceMetadataDiscovery {
  private readonly targets = new Map<string, string>()
  private readonly cache = new Map<string, CachedWorkspaceMetadata>()
  private scanning = false

  constructor(
    private readonly emit: (command: SocketApply) => void,
    private readonly dependencies: WorkspaceMetadataDependencies = {
      probeGit,
      readGitHead,
      home: homedir()
    }
  ) {}

  updateWorkspaces(workspaces: WorkspaceTarget[]): void {
    const live = new Set<string>()
    for (const workspace of workspaces) {
      live.add(workspace.id)
      if (workspace.activeSurfaceId) this.targets.set(workspace.id, workspace.activeSurfaceId)
      else this.targets.delete(workspace.id)
    }
    for (const workspaceId of this.targets.keys()) {
      if (!live.has(workspaceId)) this.targets.delete(workspaceId)
    }
    for (const workspaceId of this.cache.keys()) {
      if (!live.has(workspaceId)) this.cache.delete(workspaceId)
    }
  }

  async scan(contexts = listTerminalProcessContexts(), now = Date.now()): Promise<void> {
    if (this.scanning) return
    this.scanning = true
    try {
      const bySurface = new Map(contexts.map((context) => [context.surfaceId, context]))
      await Promise.all(
        [...this.targets].map(async ([workspaceId, surfaceId]) => {
          const context = bySurface.get(surfaceId)
          if (!context || context.workspaceId !== workspaceId) return
          await this.reconcile(workspaceId, surfaceId, context, now)
        })
      )
    } finally {
      this.scanning = false
    }
  }

  private async reconcile(
    workspaceId: string,
    surfaceId: string,
    context: TerminalProcessContext,
    now: number
  ): Promise<void> {
    const previous = this.cache.get(workspaceId)
    let git = previous?.git ?? null
    let probedAt = previous?.probedAt ?? 0
    const movedOutsideGit = git !== null && !inside(git.root, context.cwd)
    const shouldRetryNoGit = git === null && now - probedAt >= NO_GIT_RETRY_MS
    const shouldProbe =
      previous === undefined ||
      movedOutsideGit ||
      (previous.cwd !== context.cwd && git === null) ||
      shouldRetryNoGit

    if (shouldProbe) {
      git = await this.dependencies.probeGit(context.cwd)
      probedAt = now
    }

    let head = git ? this.dependencies.readGitHead(git.gitDir) : null
    if (git && head === null && now - probedAt >= NO_GIT_RETRY_MS) {
      git = await this.dependencies.probeGit(context.cwd)
      probedAt = now
      head = git ? this.dependencies.readGitHead(git.gitDir) : null
    }

    if (this.targets.get(workspaceId) !== surfaceId) return
    const branch = head === null ? null : branchFromGitHead(head, previous?.metadata.gitBranch)
    const metadata = makeMetadata(surfaceId, context.cwd, git, branch, this.dependencies.home)
    this.cache.set(workspaceId, { surfaceId, cwd: context.cwd, git, probedAt, metadata })
    if (sameWorkspaceMetadata(previous?.metadata, metadata)) return
    this.emit({ method: 'workspace-metadata', workspaceId, params: { metadata } })
  }
}

export interface WorkspaceMetadataRuntime {
  updateWorkspaces(workspaces: WorkspaceTarget[]): void
  stop(): void
}

export function startWorkspaceMetadataDiscovery(
  emit: (command: SocketApply) => void,
  intervalMs = WORKSPACE_METADATA_SCAN_MS
): WorkspaceMetadataRuntime {
  const discovery = new WorkspaceMetadataDiscovery(emit)
  const timer = setInterval(() => void discovery.scan(), intervalMs)
  return {
    updateWorkspaces: (workspaces) => discovery.updateWorkspaces(workspaces),
    stop: () => clearInterval(timer)
  }
}
