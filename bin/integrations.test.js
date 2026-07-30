'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  CLAUDE_EVENTS,
  CODEX_EVENTS,
  LEGACY_OPENCODE_MARKER,
  OPENCODE_MARKER,
  integrationPaths,
  setupIntegration
} = require('./integrations')

let failures = 0
function assert(condition, message) {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shepherd-integrations-'))
const codexPath = path.join(root, 'codex', 'hooks.json')
const claudePath = path.join(root, 'claude', 'settings.json')
const opencodePath = path.join(root, 'opencode', 'shepherd-agent.js')
const env = {
  CODEX_HOOKS_PATH: codexPath,
  CLAUDE_SETTINGS_PATH: claudePath,
  OPENCODE_PLUGIN_PATH: opencodePath,
  HOME: root
}

fs.mkdirSync(path.dirname(codexPath), { recursive: true })
fs.writeFileSync(
  codexPath,
  `${JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          hooks: [
            { type: 'command', command: 'keep-me' },
            {
              type: 'command',
              command: 'command -v cmux >/dev/null 2>&1 && cmux agent-hook codex',
              timeout: 5
            }
          ]
        }
      ]
    }
  })}\n`
)

const codex = setupIntegration('codex', env)
assert(codex.ok && codex.changed, 'installs Codex lifecycle hooks')
const codexSettings = JSON.parse(fs.readFileSync(codexPath, 'utf8'))
assert(codexSettings.hooks.PreToolUse[0].hooks[0].command === 'keep-me', 'preserves Codex hooks')
assert(
  CODEX_EVENTS.every((event) =>
    codexSettings.hooks[event].some((group) =>
      group.hooks.some((hook) => hook.command.endsWith('shepherd agent-hook codex'))
    )
  ),
  'installs every supported Codex lifecycle event'
)
assert(
  !JSON.stringify(codexSettings).includes('cmux agent-hook codex'),
  'migrates exact legacy Codex hooks without duplicates'
)
const codexBefore = fs.readFileSync(codexPath, 'utf8')
assert(setupIntegration('codex', env).changed === false, 'Codex setup is idempotent')
assert(fs.readFileSync(codexPath, 'utf8') === codexBefore, 'idempotence avoids rewriting config')

fs.mkdirSync(path.dirname(claudePath), { recursive: true })
fs.writeFileSync(claudePath, `${JSON.stringify({ theme: 'dark' })}\n`)
const claude = setupIntegration('claude', env)
assert(claude.ok && claude.changed, 'installs Claude Code lifecycle hooks')
const claudeSettings = JSON.parse(fs.readFileSync(claudePath, 'utf8'))
assert(claudeSettings.theme === 'dark', 'preserves unrelated Claude Code settings')
assert(
  CLAUDE_EVENTS.every((event) => Array.isArray(claudeSettings.hooks[event])),
  'installs every supported Claude Code lifecycle event'
)
assert(setupIntegration('claude', env).changed === false, 'Claude Code setup is idempotent')

const opencode = setupIntegration('opencode', env)
assert(opencode.ok && opencode.changed, 'installs the OpenCode plugin')
assert(fs.readFileSync(opencodePath, 'utf8').startsWith(OPENCODE_MARKER), 'marks managed plugin')
const opencodePlugin = fs.readFileSync(opencodePath, 'utf8')
assert(
  opencodePlugin.includes('let revision = Date.now()'),
  'OpenCode sequences safely across reloads'
)
assert(opencodePlugin.includes("'--revision', String(revision)"), 'OpenCode reports each revision')
assert(setupIntegration('opencode', env).changed === false, 'OpenCode setup is idempotent')

const legacyOpenCodePath = path.join(root, '.config', 'opencode', 'plugins', 'cmux-agent.js')
fs.mkdirSync(path.dirname(legacyOpenCodePath), { recursive: true })
fs.writeFileSync(legacyOpenCodePath, `${LEGACY_OPENCODE_MARKER}\nlegacy managed content\n`)
const defaultPaths = integrationPaths({ HOME: root })
assert(
  defaultPaths.opencode === legacyOpenCodePath,
  'selects an existing managed legacy OpenCode path'
)
const migratedOpenCode = setupIntegration('opencode', { HOME: root })
assert(migratedOpenCode.ok && migratedOpenCode.changed, 'migrates the managed OpenCode plugin')
assert(
  fs.readFileSync(legacyOpenCodePath, 'utf8').startsWith(OPENCODE_MARKER),
  'updates the managed plugin in place'
)
assert(
  !fs.existsSync(path.join(root, '.config', 'opencode', 'plugins', 'shepherd-agent.js')),
  'does not create a duplicate OpenCode plugin during migration'
)

const conflictPath = path.join(root, 'opencode', 'custom.js')
fs.writeFileSync(conflictPath, 'export const Custom = true\n')
const conflict = setupIntegration('opencode', { ...env, OPENCODE_PLUGIN_PATH: conflictPath })
assert(
  !conflict.ok && conflict.error.includes('refusing'),
  'does not overwrite an unmanaged plugin'
)
assert(!setupIntegration('other', env).ok, 'rejects unknown integrations')

fs.rmSync(root, { recursive: true, force: true })
if (failures > 0) throw new Error(`${failures} integration test(s) failed`)
console.log('\n✅ ALL INTEGRATION TESTS PASS')
