import {
  DEFAULT_AGENT_ACCESS_POLICY,
  parseAgentAccessPolicy,
  socketPermissionForMethod
} from './agentAccess'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

assert(parseAgentAccessPolicy(null) === null, 'rejects absent policy')
assert(
  parseAgentAccessPolicy({ version: 2, terminalInspection: true, terminalInput: true }) === null,
  'rejects unknown version'
)
assert(
  parseAgentAccessPolicy({ version: 1, terminalInspection: 'no', terminalInput: true }) === null,
  'rejects non-boolean permission'
)
const disabled = parseAgentAccessPolicy({
  version: 1,
  terminalInspection: false,
  terminalInput: false
})
assert(disabled !== null, 'accepts valid versioned policy')
assert(
  socketPermissionForMethod(DEFAULT_AGENT_ACCESS_POLICY, 'inspect-agent') === null,
  'preserves existing inspection default'
)
assert(
  socketPermissionForMethod(DEFAULT_AGENT_ACCESS_POLICY, 'send-text') === null,
  'preserves existing input default'
)
assert(
  !!disabled && socketPermissionForMethod(disabled, 'inspect-agent') !== null,
  'blocks inspection when disabled'
)
assert(
  !!disabled && socketPermissionForMethod(disabled, 'send-text') !== null,
  'blocks socket text when disabled'
)
assert(
  !!disabled && socketPermissionForMethod(disabled, 'send-key') !== null,
  'blocks socket keys when disabled'
)
assert(
  !!disabled && socketPermissionForMethod(disabled, 'agent-report') === null,
  'keeps status reporting available'
)
if (failures) process.exitCode = 1
