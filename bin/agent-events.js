'use strict'

const PROVIDERS = new Set(['codex', 'claude', 'custom'])
const CODEX_TTL_MS = {
  working: 7_200_000,
  blocked: 86_400_000,
  done: 1_800_000,
  idle: 7_200_000,
  unknown: 1_800_000
}
const CODEX_STALE_MS = {
  working: 1_800_000,
  blocked: 43_200_000,
  idle: 1_800_000
}

function activityForTool(toolName, toolInput) {
  const tool = String(toolName || '').toLowerCase()
  const command = String(toolInput?.command || '').toLowerCase()
  if (/web|search|fetch|browser/.test(tool)) return 'web-search'
  if (
    /test|spec|pytest|vitest|jest/.test(tool) ||
    /(^|\s)(test|pytest|vitest|jest)(\s|$)/.test(command)
  ) {
    return 'testing'
  }
  if (/read|grep|glob|list|find/.test(tool)) return 'reading'
  if (/edit|write|patch/.test(tool)) return 'editing'
  if (/bash|shell|exec|command/.test(tool)) return 'running-command'
  return 'thinking'
}

function eventRevision(event) {
  const raw = event.revision ?? event.sequence
  const parsed = typeof raw === 'string' ? Number(raw) : raw
  return typeof parsed === 'number' && Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function report(provider, event, state, detail = {}) {
  const revision = eventRevision(event)
  const ttlMs = provider === 'codex' ? CODEX_TTL_MS[state] : undefined
  const staleAfterMs = provider === 'codex' ? CODEX_STALE_MS[state] : undefined
  return {
    method: 'agent-report',
    params: {
      provider,
      state,
      source: `${provider}:hooks`,
      ...(typeof event.session_id === 'string' ? { sessionId: event.session_id } : {}),
      ...(revision === undefined ? {} : { revision }),
      ...(staleAfterMs === undefined ? {} : { staleAfterMs }),
      ...(ttlMs === undefined ? {} : { ttlMs }),
      ...detail
    }
  }
}

function mapAgentEvent(provider, event, env = process.env) {
  if (!PROVIDERS.has(provider) || !event || typeof event !== 'object') return null
  const name = String(event.hook_event_name || event.event || '')
  const toolName = typeof event.tool_name === 'string' ? event.tool_name : ''
  const toolMessage = toolName ? `${toolName} tool` : undefined

  switch (name) {
    case 'SessionStart':
      return report(provider, event, 'idle')
    case 'UserPromptSubmit':
      return report(provider, event, 'working', { activity: 'thinking' })
    case 'PreToolUse':
      return report(provider, event, 'working', {
        activity: activityForTool(toolName, event.tool_input),
        ...(toolMessage ? { message: toolMessage } : {})
      })
    case 'PermissionRequest':
      return report(provider, event, 'blocked', {
        blockReason: 'approval',
        message: toolName ? `Approve ${toolName}` : 'Approval required'
      })
    case 'Notification': {
      const notificationType = String(event.notification_type || '')
      const approval = /permission|approval/.test(notificationType)
      return report(provider, event, 'blocked', {
        blockReason: approval ? 'approval' : 'user-input',
        message: approval ? 'Approval required' : 'Input required'
      })
    }
    case 'PostToolUse':
    case 'PermissionDenied':
      return report(provider, event, 'working', { activity: 'thinking' })
    case 'PreCompact':
      return report(provider, event, 'working', {
        activity: 'thinking',
        message: 'Compacting context'
      })
    case 'PostCompact':
      return report(provider, event, 'working', {
        activity: 'thinking',
        message: 'Context compacted'
      })
    case 'SubagentStart':
      return report(provider, event, 'working', {
        activity: 'thinking',
        message: 'Subagent started'
      })
    case 'SubagentStop':
      return report(provider, event, 'working', {
        activity: 'thinking',
        message: 'Subagent finished'
      })
    case 'PostToolUseFailure':
    case 'StopFailure':
      return report(provider, event, 'blocked', {
        blockReason: 'tool-error',
        message: toolName ? `${toolName} failed` : 'Agent error'
      })
    case 'Stop':
      return report(provider, event, 'done')
    case 'SessionEnd': {
      const surfaceId = env.CMUX_SURFACE_ID
      if (!surfaceId) return null
      return {
        method: 'agent-clear',
        params: {
          agentId: `${provider}:hooks:${surfaceId}`,
          source: `${provider}:hooks`
        }
      }
    }
    default:
      return report(provider, event, 'unknown', {
        message: name ? `${name} event` : 'Unrecognized lifecycle event'
      })
  }
}

module.exports = { CODEX_STALE_MS, CODEX_TTL_MS, activityForTool, eventRevision, mapAgentEvent }
