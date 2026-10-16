export const MAX_LINKED_REPOSITORIES = 8

export function validRepositoryRoot(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 1 &&
    value.length <= 4096 &&
    value.startsWith('/') &&
    !Array.from(value).some((character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127
    })
  )
}

/** Tolerant only for restoring older snapshots; newly resolved roots come from main. */
export function sanitizeLinkedRepositories(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const roots: string[] = []
  for (const root of value) {
    if (!validRepositoryRoot(root) || roots.includes(root)) continue
    roots.push(root)
    if (roots.length === MAX_LINKED_REPOSITORIES) break
  }
  return roots
}
