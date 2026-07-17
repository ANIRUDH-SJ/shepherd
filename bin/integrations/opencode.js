'use strict'
const fs = require('fs')
const { writeFileAtomic } = require('./common')

const OPENCODE_MARKER = '// cmux-linux managed agent integration'
const OPENCODE_PLUGIN = `${OPENCODE_MARKER}
const SOURCE = 'opencode:plugin'
let revision = Date.now()

async function cmux(...args) {
  if (!process.env.CMUX_SOCKET_PATH || !process.env.CMUX_SURFACE_ID) return
  try {
    const child = Bun.spawn(['cmux', ...args], {
      env: process.env,
      stdout: 'ignore',
      stderr: 'ignore'
    })
    await child.exited
  } catch {
    // The terminal may be outside cmux-linux or the app may have exited.
  }
}

function activity(tool) {
  const name = String(tool || '').toLowerCase()
  if (/web|search|fetch|browser/.test(name)) return 'web-search'
  if (/read|grep|glob|list|find/.test(name)) return 'reading'
  if (/edit|write|patch/.test(name)) return 'editing'
  if (/bash|shell|exec|command/.test(name)) return 'running-command'
  return 'thinking'
}

async function report(state, ...detail) {
  revision += 1
  await cmux(
    'agent-report',
    '--provider', 'opencode',
    '--source', SOURCE,
    '--state', state,
    '--revision', String(revision),
    ...detail
  )
}

export const CmuxAgentPlugin = async () => ({
  'tool.execute.before': async (input) => {
    await report('working', '--activity', activity(input.tool))
  },
  event: async ({ event }) => {
    if (event.type === 'permission.asked') {
      await report('blocked', '--reason', 'approval', '--message', 'Approval required')
    } else if (event.type === 'permission.replied') {
      await report('working', '--activity', 'thinking')
    } else if (event.type === 'session.created') {
      await report('idle')
    } else if (event.type === 'session.idle') {
      await report('done')
    } else if (event.type === 'session.error') {
      await report('blocked', '--reason', 'tool-error', '--message', 'Agent error')
    } else if (event.type === 'session.status') {
      const status = event.properties?.status?.type ?? event.properties?.status
      if (status === 'idle') await report('done')
      else if (status === 'busy' || status === 'retry') await report('working', '--activity', 'thinking')
    } else if (event.type === 'session.deleted' && process.env.CMUX_SURFACE_ID) {
      await cmux('agent-clear', SOURCE + ':' + process.env.CMUX_SURFACE_ID, '--source', SOURCE)
    }
  }
})
`

function installOpenCodePlugin(file) {
  let existing = null
  try {
    existing = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      return { ok: false, error: `cannot read ${file}: ${error.message || String(error)}` }
    }
  }
  if (existing !== null && !existing.startsWith(OPENCODE_MARKER)) {
    return { ok: false, error: `refusing to overwrite unmanaged plugin: ${file}` }
  }
  const changed = existing !== OPENCODE_PLUGIN
  if (changed) writeFileAtomic(file, OPENCODE_PLUGIN)
  return { ok: true, changed, file }
}

module.exports = { OPENCODE_MARKER, OPENCODE_PLUGIN, installOpenCodePlugin }
