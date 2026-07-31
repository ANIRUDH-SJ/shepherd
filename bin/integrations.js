'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { CLAUDE_EVENTS, installClaudeHooks } = require('./integrations/claude')
const { CODEX_EVENTS, installCodexHooks } = require('./integrations/codex')
const {
  LEGACY_OPENCODE_MARKER,
  OPENCODE_MARKER,
  OPENCODE_PLUGIN,
  installOpenCodePlugin
} = require('./integrations/opencode')

function isLegacyManagedOpenCodePlugin(file) {
  try {
    return fs.readFileSync(file, 'utf8').startsWith(LEGACY_OPENCODE_MARKER)
  } catch {
    return false
  }
}

function integrationPaths(env = process.env) {
  const home = env.HOME || os.homedir()
  const openCodePlugins = path.join(home, '.config', 'opencode', 'plugins')
  const currentOpenCodePath = path.join(openCodePlugins, 'shepherd-agent.js')
  const legacyOpenCodePath = path.join(openCodePlugins, 'cmux-agent.js')
  return {
    codex:
      env.CODEX_HOOKS_PATH || path.join(env.CODEX_HOME || path.join(home, '.codex'), 'hooks.json'),
    claude: env.CLAUDE_SETTINGS_PATH || path.join(home, '.claude', 'settings.json'),
    opencode:
      env.OPENCODE_PLUGIN_PATH ||
      (isLegacyManagedOpenCodePlugin(legacyOpenCodePath) && !fs.existsSync(currentOpenCodePath)
        ? legacyOpenCodePath
        : currentOpenCodePath)
  }
}

function setupIntegration(target, env = process.env) {
  const paths = integrationPaths(env)
  if (target === 'codex') return installCodexHooks(paths.codex)
  if (target === 'claude') return installClaudeHooks(paths.claude)
  if (target === 'opencode') return installOpenCodePlugin(paths.opencode)
  return { ok: false, error: `unknown integration: ${target}` }
}

module.exports = {
  CLAUDE_EVENTS,
  CODEX_EVENTS,
  LEGACY_OPENCODE_MARKER,
  OPENCODE_MARKER,
  OPENCODE_PLUGIN,
  integrationPaths,
  setupIntegration
}
