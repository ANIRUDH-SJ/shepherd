import type { WorkspaceUsage } from '../../shared/usage'

export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0)}k`
  return `${(tokens / 1_000_000).toFixed(tokens < 10_000_000 ? 1 : 0)}m`
}

export function usageSummary(usage: WorkspaceUsage): string | null {
  if (usage.totals.reportCount === 0) return null
  const total = usage.totals.inputTokens + usage.totals.outputTokens
  const estimate = usage.totals.hasEstimated ? '~' : ''
  const cost = usage.totals.costUsd > 0 ? ` · $${usage.totals.costUsd.toFixed(2)}` : ''
  return `${estimate}${formatTokenCount(total)} tok${cost}`
}

export function usageDetails(usage: WorkspaceUsage): string {
  const { totals, latest } = usage
  const lines = [
    `${totals.inputTokens.toLocaleString()} input tokens`,
    `${totals.outputTokens.toLocaleString()} output tokens`,
    `${totals.cachedTokens.toLocaleString()} cached tokens`,
    `${totals.reportCount} report${totals.reportCount === 1 ? '' : 's'}`,
    totals.hasEstimated ? 'Contains estimated usage' : 'All reported usage is exact'
  ]
  if (totals.costUsd > 0) lines.push(`Reported cost: $${totals.costUsd.toFixed(4)}`)
  if (latest?.provider || latest?.model) {
    lines.push(`Latest: ${[latest.provider, latest.model].filter(Boolean).join(' · ')}`)
  }
  return lines.join('\n')
}
