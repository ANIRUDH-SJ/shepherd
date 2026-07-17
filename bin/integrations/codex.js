'use strict'
const { installCommandHooks } = require('./common')

const CODEX_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'Stop'
]

function installCodexHooks(file) {
  return installCommandHooks(file, 'codex', CODEX_EVENTS)
}

module.exports = { CODEX_EVENTS, installCodexHooks }
