export const MAX_TERMINAL_FIND_QUERY_LENGTH = 512
export const TERMINAL_FIND_HIGHLIGHT_LIMIT = 1_000

export function normalizeTerminalFindQuery(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code > 31 && code !== 127
    })
    .join('')
    .slice(0, MAX_TERMINAL_FIND_QUERY_LENGTH)
}

export function terminalFindStatus(
  query: string,
  resultIndex: number,
  resultCount: number
): string {
  if (!query) return 'Enter search text'
  if (resultIndex < 0 && resultCount > TERMINAL_FIND_HIGHLIGHT_LIMIT) {
    return `${TERMINAL_FIND_HIGHLIGHT_LIMIT}+ results`
  }
  if (resultCount < 1) return 'No results'
  return `${Math.max(0, resultIndex) + 1} of ${resultCount}`
}
