import type { ReviewFile } from '../shared/review'

export const MAX_REVIEW_FILES = 200

/** Parse Git porcelain v1's NUL-delimited format, including rename sources. */
export function parseReviewStatus(output: string): { files: ReviewFile[]; truncated: boolean } {
  const entries = output.split('\0')
  const files: ReviewFile[] = []
  let truncated = false
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    if (!entry) continue
    if (entry.length < 4 || entry[2] !== ' ') throw new Error('Invalid Git status response')
    const x = entry[0]
    const y = entry[1]
    const path = entry.slice(3)
    if (!path || path.length > 4096) throw new Error('Invalid Git path')
    // In -z mode the destination is first and the original rename path is a
    // second NUL-delimited field, not another status record.
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') index++
    if (files.length >= MAX_REVIEW_FILES) {
      truncated = true
      continue
    }
    const untracked = x === '?' && y === '?'
    files.push({
      path,
      staged: !untracked && x !== ' ' && x !== '?',
      unstaged: !untracked && y !== ' ' && y !== '?',
      untracked,
      conflicted: x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')
    })
  }
  return { files, truncated }
}
