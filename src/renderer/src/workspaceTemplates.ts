export const WORKSPACE_TEMPLATES_KEY = 'shepherd.workspaceTemplates.v1'
export const MAX_WORKSPACE_TEMPLATES = 24

export interface WorkspaceTemplate {
  id: string
  name: string
  cwd: string
  setupCommand: string
  runCommand: string
}

export type WorkspaceTemplateDraft = Omit<WorkspaceTemplate, 'id'>

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code <= 31 || code === 127
  })
}

export function normalizeWorkspaceCommand(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null
  if (hasControlCharacters(value)) return null
  return value.trim()
}

export function normalizeWorkspaceTemplate(value: unknown): WorkspaceTemplate | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<WorkspaceTemplate>
  if (typeof candidate.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(candidate.id)) return null
  if (typeof candidate.name !== 'string' || !candidate.name.trim() || candidate.name.length > 80)
    return null
  if (
    typeof candidate.cwd !== 'string' ||
    !candidate.cwd.startsWith('/') ||
    candidate.cwd.length > 1024 ||
    hasControlCharacters(candidate.cwd)
  )
    return null
  const setupCommand = normalizeWorkspaceCommand(candidate.setupCommand)
  const runCommand = normalizeWorkspaceCommand(candidate.runCommand)
  if (setupCommand === null || runCommand === null || (!setupCommand && !runCommand)) return null
  return {
    id: candidate.id,
    name: candidate.name.trim(),
    cwd: candidate.cwd,
    setupCommand,
    runCommand
  }
}

export function normalizeWorkspaceTemplates(value: unknown): WorkspaceTemplate[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: WorkspaceTemplate[] = []
  for (const item of value) {
    const template = normalizeWorkspaceTemplate(item)
    if (!template || seen.has(template.id)) continue
    seen.add(template.id)
    result.push(template)
    if (result.length === MAX_WORKSPACE_TEMPLATES) break
  }
  return result
}

export function loadWorkspaceTemplates(): WorkspaceTemplate[] {
  try {
    return normalizeWorkspaceTemplates(
      JSON.parse(localStorage.getItem(WORKSPACE_TEMPLATES_KEY) ?? '[]')
    )
  } catch {
    return []
  }
}

export function saveWorkspaceTemplates(templates: WorkspaceTemplate[]): void {
  localStorage.setItem(
    WORKSPACE_TEMPLATES_KEY,
    JSON.stringify(normalizeWorkspaceTemplates(templates))
  )
}
