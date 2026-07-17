'use strict'

const PROVIDERS = new Set(['codex', 'claude', 'custom'])

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

function report(provider, event, state, detail = {}) {
  return {
    method: 'agent-report',
    params: {
      provider,
      state,
      source: `${provider}:hooks`,
      ...(typeof event.session_id === 'string' ? { sessionId: event.session_id } : {}),
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
      return null
  }
}

module.exports = { activityForTool, mapAgentEvent }
