import {
  AGENT_PROTOCOL_METHODS,
  AGENT_PROTOCOL_SCHEMA,
  AGENT_PROTOCOL_VERSION,
  agentProtocolCapabilities
} from './agentProtocol'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

assert(AGENT_PROTOCOL_SCHEMA.version === AGENT_PROTOCOL_VERSION, 'versions the protocol schema')
assert(
  AGENT_PROTOCOL_SCHEMA.$defs.agentState.enum.includes('blocked'),
  'publishes semantic state values'
)
assert(
  AGENT_PROTOCOL_SCHEMA.methods['agent-report'].params.required.includes('surfaceId'),
  'publishes report ownership requirements'
)
const revisionSchema = AGENT_PROTOCOL_SCHEMA.methods['agent-report'].params.properties.revision as {
  oneOf: unknown[]
}
assert(revisionSchema.oneOf.length === 2, 'describes numeric and CLI-string inputs')
assert(
  AGENT_PROTOCOL_SCHEMA.methods['list-agents'].kind === 'query',
  'classifies list-agents as a query'
)
const inspectionByteSchema = AGENT_PROTOCOL_SCHEMA.methods['inspect-agent'].params.properties
  .maxBytes as { oneOf: unknown[] }
assert(inspectionByteSchema.oneOf.length === 2, 'publishes bounded inspection inputs')
assert(AGENT_PROTOCOL_METHODS.includes('agent-capabilities'), 'advertises capability discovery')

const all = agentProtocolCapabilities()
assert(all.ok, 'returns all protocol capabilities')
if (all.ok) {
  const adapters = all.capabilities.adapters as Array<Record<string, unknown>>
  const features = all.capabilities.features as Record<string, unknown>
  assert(adapters.length === 4, 'describes every supported reporter family')
  assert(features.reconnectSnapshot === true, 'describes reconnect snapshot support')
}

const codex = agentProtocolCapabilities('codex')
if (codex.ok) {
  const adapters = codex.capabilities.adapters as Array<Record<string, unknown>>
  assert(adapters.length === 1 && adapters[0].provider === 'codex', 'filters provider capability')
} else {
  assert(false, 'filters provider capability')
}
assert(!agentProtocolCapabilities('other').ok, 'rejects unknown provider capability requests')

if (failures > 0) throw new Error(`${failures} agent protocol test(s) failed`)
console.log('\n✅ ALL AGENT PROTOCOL TESTS PASS')
