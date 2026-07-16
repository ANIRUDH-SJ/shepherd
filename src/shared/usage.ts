export type UsageAccuracy = 'exact' | 'estimated'

export interface UsageReport {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  costUsd?: number
  model?: string
  provider?: string
  accuracy: UsageAccuracy
  timestamp: number
}

export interface UsageTotals {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  costUsd: number
  reportCount: number
  hasEstimated: boolean
}

export interface WorkspaceUsage {
  totals: UsageTotals
  latest: UsageReport | null
}

export type UsageValidation =
  | { ok: true; report: UsageReport }
  | { ok: false; error: string }

export function emptyUsageTotals(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    costUsd: 0,
    reportCount: 0,
    hasEstimated: false
  }
}

export function emptyWorkspaceUsage(): WorkspaceUsage {
  return { totals: emptyUsageTotals(), latest: null }
}

export function addWorkspaceUsage(usage: WorkspaceUsage, report: UsageReport): WorkspaceUsage {
  return { totals: accumulateUsage(usage.totals, report), latest: report }
}

export function accumulateUsage(totals: UsageTotals, report: UsageReport): UsageTotals {
  return {
    inputTokens: totals.inputTokens + report.inputTokens,
    outputTokens: totals.outputTokens + report.outputTokens,
    cachedTokens: totals.cachedTokens + report.cachedTokens,
    costUsd: totals.costUsd + (report.costUsd ?? 0),
    reportCount: totals.reportCount + 1,
    hasEstimated: totals.hasEstimated || report.accuracy === 'estimated'
  }
}

function nonNegativeNumber(value: unknown, field: string, integer: boolean): number | string {
  if (value === '' || value === null || value === undefined) return `${field} is required`
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isInteger(parsed))) {
    return `${field} must be a non-negative ${integer ? 'integer' : 'number'}`
  }
  return parsed
}

function optionalLabel(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`)
  return value.trim()
}

/** Validate untrusted socket/CLI params and stamp the report at ingestion time. */
export function normalizeUsageReport(
  params: Record<string, unknown>,
  timestamp = Date.now()
): UsageValidation {
  const inputTokens = nonNegativeNumber(params.inputTokens, 'inputTokens', true)
  if (typeof inputTokens === 'string') return { ok: false, error: inputTokens }

  const outputTokens = nonNegativeNumber(params.outputTokens, 'outputTokens', true)
  if (typeof outputTokens === 'string') return { ok: false, error: outputTokens }

  const cachedRaw = params.cachedTokens ?? 0
  const cachedTokens = nonNegativeNumber(cachedRaw, 'cachedTokens', true)
  if (typeof cachedTokens === 'string') return { ok: false, error: cachedTokens }

  let costUsd: number | undefined
  if (params.costUsd !== undefined) {
    const parsed = nonNegativeNumber(params.costUsd, 'costUsd', false)
    if (typeof parsed === 'string') return { ok: false, error: parsed }
    costUsd = parsed
  }

  if (params.accuracy !== 'exact' && params.accuracy !== 'estimated') {
    return { ok: false, error: 'accuracy must be exact or estimated' }
  }

  try {
    const model = optionalLabel(params.model, 'model')
    const provider = optionalLabel(params.provider, 'provider')
    return {
      ok: true,
      report: {
        inputTokens,
        outputTokens,
        cachedTokens,
        ...(costUsd === undefined ? {} : { costUsd }),
        ...(model ? { model } : {}),
        ...(provider ? { provider } : {}),
        accuracy: params.accuracy,
        timestamp
      }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'invalid usage report' }
  }
}
