'use strict'
const { installCommandHooks } = require('./common')

const CLAUDE_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'StopFailure',
  'Stop',
  'Notification',
  'SessionEnd'
]

function installClaudeHooks(file) {
  return installCommandHooks(file, 'claude', CLAUDE_EVENTS)
}

module.exports = { CLAUDE_EVENTS, installClaudeHooks }
