export const MAX_WORKSPACE_NAME_LENGTH = 64

export function normalizeWorkspaceName(name: string): string {
  return name.trim().slice(0, MAX_WORKSPACE_NAME_LENGTH)
}
