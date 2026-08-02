import type { WorkspacePullRequest } from '../../shared/workspaceMetadata'

export interface WorkspaceIdentitySource {
  name: string
  projectName: string
}

export interface WorkspaceRuntimeContextSource {
  pullRequest: WorkspacePullRequest | null
  ports: readonly number[]
}

export interface WorkspaceRuntimeContext {
  label: string
  description: string
}

const VISIBLE_PORTS = 2

export interface WorkspaceIdentity {
  primary: string
  context: string
  positional: string
}

/** Keep the user's name primary. Otherwise promote the live project over a generic position. */
export function workspaceIdentity(
  workspace: WorkspaceIdentitySource,
  index: number
): WorkspaceIdentity {
  const positional = `Workspace ${index + 1}`
  if (workspace.name) {
    return { primary: workspace.name, context: workspace.projectName, positional }
  }
  return { primary: workspace.projectName, context: positional, positional }
}

/** Only keep secondary project text when it adds information below a custom name. */
export function workspaceProjectContext(
  workspace: WorkspaceIdentitySource,
  identity: WorkspaceIdentity
): string | null {
  if (!workspace.name || identity.context === 'Home') return null
  return identity.context
}

/** Keep optional runtime context on one bounded line while retaining full hover/AT detail. */
export function workspaceRuntimeContext(
  workspace: WorkspaceRuntimeContextSource
): WorkspaceRuntimeContext | null {
  const labelParts: string[] = []
  const descriptionParts: string[] = []
  if (workspace.pullRequest) {
    labelParts.push(`PR #${workspace.pullRequest.number} ${workspace.pullRequest.state}`)
    descriptionParts.push(
      `Pull request #${workspace.pullRequest.number}: ${workspace.pullRequest.state}`
    )
  }
  if (workspace.ports.length > 0) {
    const visible = workspace.ports.slice(0, VISIBLE_PORTS).map((port) => `:${port}`)
    const remainder = workspace.ports.length - visible.length
    labelParts.push(`${visible.join(' ')}${remainder > 0 ? ` +${remainder}` : ''}`)
    descriptionParts.push(`Listening ports: ${workspace.ports.join(', ')}`)
  }
  if (labelParts.length === 0) return null
  return {
    label: labelParts.join(' · '),
    description: descriptionParts.join('. ')
  }
}
