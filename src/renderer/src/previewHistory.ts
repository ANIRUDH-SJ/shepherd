export interface PreviewHistory {
  entries: string[]
  index: number
  pendingIndex: number | null
}

export function createPreviewHistory(url: string): PreviewHistory {
  return { entries: [url], index: 0, pendingIndex: null }
}

export function recordPreviewNavigation(history: PreviewHistory, url: string): void {
  if (history.pendingIndex !== null && history.entries[history.pendingIndex] === url) {
    history.index = history.pendingIndex
    history.pendingIndex = null
    return
  }
  if (history.entries[history.index] === url) return
  history.entries = [...history.entries.slice(0, history.index + 1), url]
  history.index = history.entries.length - 1
  history.pendingIndex = null
}

export function previewHistoryTarget(history: PreviewHistory, offset: -1 | 1): number | null {
  const target = history.index + offset
  return target >= 0 && target < history.entries.length ? target : null
}
