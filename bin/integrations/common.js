'use strict'
const fs = require('fs')
const path = require('path')

function readJson(file) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) }
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ok: true, value: {} }
    return {
      ok: false,
      error: `cannot parse ${file}: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

function writeFileAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, content)
  fs.renameSync(temporary, file)
}

function installCommandHooks(file, provider, events) {
  const parsed = readJson(file)
  if (!parsed.ok) return parsed
  const settings = parsed.value
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { ok: false, error: `${file} must contain a JSON object` }
  }
  settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {}
  // Global provider hooks must be harmless when the agent is launched outside
  // cmux-linux, where the pane-injected CLI may not be on PATH.
  const command = `command -v cmux >/dev/null 2>&1 && cmux agent-hook ${provider}`
  let changed = false

  for (const event of events) {
    const groups = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : []
    const installed = groups.some(
      (group) =>
        group &&
        Array.isArray(group.hooks) &&
        group.hooks.some((hook) => hook && hook.type === 'command' && hook.command === command)
    )
    if (!installed) {
      groups.push({ hooks: [{ type: 'command', command, timeout: 5 }] })
      changed = true
    }
    settings.hooks[event] = groups
  }

  if (changed) writeFileAtomic(file, `${JSON.stringify(settings, null, 2)}\n`)
  return { ok: true, changed, file }
}

module.exports = { installCommandHooks, writeFileAtomic }
