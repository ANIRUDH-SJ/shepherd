export interface WorkspaceIdentitySource {
  name: string
  projectName: string
}

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
