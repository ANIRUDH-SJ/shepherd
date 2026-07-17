'use strict'
const { CODEX_TTL_MS, activityForTool, eventRevision, mapAgentEvent } = require('./agent-events')

let failures = 0
function assert(condition, message) {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

assert(activityForTool('WebSearch', {}) === 'web-search', 'maps web tools to web search')
assert(activityForTool('Bash', { command: 'npm test' }) === 'testing', 'detects tests in commands')
assert(activityForTool('Read', {}) === 'reading', 'maps read tools')
assert(activityForTool('apply_patch', {}) === 'editing', 'maps file edits')
assert(activityForTool('Bash', { command: 'git status' }) === 'running-command', 'maps commands')

const promptEvent = mapAgentEvent('codex', {
  hook_event_name: 'UserPromptSubmit',
  session_id: 'session-1'
})
assert(promptEvent?.method === 'agent-report', 'prompt starts a working report')
assert(
  promptEvent?.params.state === 'working' && promptEvent?.params.activity === 'thinking',
  'prompt thinks'
)
assert(promptEvent?.params.sessionId === 'session-1', 'preserves native session provenance')
assert(promptEvent?.params.ttlMs === CODEX_TTL_MS.working, 'Codex working state expires safely')

assert(eventRevision({ sequence: '7' }) === 7, 'accepts a producer sequence number')
assert(eventRevision({ revision: -1 }) === undefined, 'rejects invalid producer revisions')
const sequenced = mapAgentEvent('codex', {
  hook_event_name: 'PostToolUse',
  revision: 9
})
assert(sequenced?.params.revision === 9, 'preserves a producer revision when supplied')

const search = mapAgentEvent('claude', {
  hook_event_name: 'PreToolUse',
  tool_name: 'WebFetch'
})
assert(search?.params.activity === 'web-search', 'Claude tool events share activity mapping')

const approval = mapAgentEvent('codex', {
  hook_event_name: 'PermissionRequest',
  tool_name: 'Bash'
})
assert(approval?.params.state === 'blocked', 'permission request blocks the agent')
assert(approval?.params.blockReason === 'approval', 'permission request records approval reason')
assert(approval?.params.ttlMs === CODEX_TTL_MS.blocked, 'Codex approval survives a long wait')

const done = mapAgentEvent('claude', { hook_event_name: 'Stop' })
assert(done?.params.state === 'done', 'stop marks the turn done')
assert(
  done?.params.ttlMs === undefined,
  'does not add expiry when the provider reports session end'
)

const subagent = mapAgentEvent('codex', { hook_event_name: 'SubagentStart' })
assert(subagent?.params.state === 'working', 'subagent lifecycle refreshes working state')
assert(subagent?.params.message === 'Subagent started', 'subagent lifecycle keeps safe detail')

const clear = mapAgentEvent(
  'claude',
  { hook_event_name: 'SessionEnd' },
  { CMUX_SURFACE_ID: 'term-1' }
)
assert(clear?.method === 'agent-clear', 'session end clears an agent')
assert(clear?.params.agentId === 'claude:hooks:term-1', 'clear targets the derived agent id')
assert(
  mapAgentEvent('claude', { hook_event_name: 'SessionEnd' }, {}) === null,
  'does not clear without terminal identity'
)
assert(mapAgentEvent('unknown', { hook_event_name: 'Stop' }) === null, 'rejects unknown providers')
const future = mapAgentEvent('codex', { hook_event_name: 'FutureEvent', prompt: 'do not retain' })
assert(future?.params.state === 'unknown', 'degrades unsupported events to unknown state')
assert(future?.params.message === 'FutureEvent event', 'retains only the event name as safe detail')
assert(future?.params.prompt === undefined, 'does not retain unsupported event payloads')

if (failures > 0) throw new Error(`${failures} agent event test(s) failed`)
console.log('\n✅ ALL AGENT EVENT TESTS PASS')
