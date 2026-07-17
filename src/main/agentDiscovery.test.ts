import type { AgentRecord } from '../shared/agent'
import type { SocketApply } from '../shared/ipc'
import {
  AUTOMATIC_AGENT_SOURCE,
  AutomaticAgentDiscovery,
  automaticAgentState,
  classifyAgentProcesses
} from './agentDiscovery'
import type { ForegroundProcess, TerminalProcessContext } from './terminalInspection'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

function process(name: string, command = name, pid = 10): ForegroundProcess {
  return { pid, name, command }
}

assert(classifyAgentProcesses([process('codex')])?.provider === 'codex', 'detects Codex')
assert(
  classifyAgentProcesses([process('node', 'claude-code')])?.provider === 'claude',
  'detects a Node-launched Claude Code process'
)
assert(
  classifyAgentProcesses([process('bun', 'opencode')])?.provider === 'opencode',
  'detects OpenCode through a runtime wrapper'
)
assert(
  classifyAgentProcesses([process('python', 'kimi-cli')])?.displayName === 'Kimi',
  'detects Kimi'
)
assert(classifyAgentProcesses([process('aider')])?.displayName === 'Aider', 'detects Aider')
assert(
  classifyAgentProcesses([process('bash', 'bash', 20), process('codex', 'codex', 10)])?.provider ===
    'codex',
  'finds an agent behind its foreground child tool'
)
assert(
  classifyAgentProcesses([process('my-review-agent')])?.displayName === 'My Review Agent',
  'detects a generic agent-like executable'
)
assert(classifyAgentProcesses([process('bash')]) === null, 'ignores a normal shell')
assert(classifyAgentProcesses([process('vim')]) === null, 'ignores an editor')
assert(
  classifyAgentProcesses([process('agentless')]) === null,
  'avoids partial-name false positives'
)

assert(automaticAgentState(8_000, 10_000) === 'working', 'marks recent PTY activity working')
assert(automaticAgentState(5_000, 10_000) === 'idle', 'marks a quiet detected agent idle')

const emitted: SocketApply[] = []
const discovery = new AutomaticAgentDiscovery((command) => emitted.push(command))
const context = (
  lastActivityAt: number,
  processes = [process('codex')]
): TerminalProcessContext => ({
  surfaceId: 'term-1',
  workspaceId: 'ws-1',
  shellPid: 5,
  processes,
  lastActivityAt
})

discovery.scan([context(9_000)], 10_000)
assert(emitted[0]?.method === 'agent-report', 'reports an automatically detected agent')
const firstReport = emitted[0]?.params.report as Record<string, unknown>
assert(firstReport?.source === AUTOMATIC_AGENT_SOURCE, 'marks automatic reporter authority')
assert(firstReport?.state === 'working', 'reports recent automatic activity')

discovery.scan([context(9_000)], 10_500)
assert(emitted.length === 1, 'does not repeat an unchanged discovery')

discovery.scan([context(9_000)], 13_001)
const idleReport = emitted[1]?.params.report as Record<string, unknown>
assert(idleReport?.state === 'idle', 'updates a quiet automatic agent')

discovery.updateAgents([
  {
    agentId: 'codex:hooks:term-1',
    provider: 'codex',
    displayName: 'Codex',
    workspaceId: 'ws-1',
    paneId: 'pane-1',
    surfaceId: 'term-1',
    state: 'blocked',
    source: 'codex:hooks',
    revision: 1,
    updatedAt: 14_000
  } as AgentRecord
])
discovery.scan([context(14_000)], 14_000)
assert(emitted[2]?.method === 'agent-clear', 'clears automatic state when a rich report exists')
assert(emitted[2]?.params.source === AUTOMATIC_AGENT_SOURCE, 'clears only automatic authority')

discovery.updateAgents([])
discovery.scan([context(15_000, [process('kimi')])], 15_000)
const kimiReport = emitted[3]?.params.report as Record<string, unknown>
assert(kimiReport?.displayName === 'Kimi', 'rediscovers another agent on the same surface')
discovery.scan([], 16_000)
assert(emitted[4]?.method === 'agent-clear', 'clears an agent when its terminal disappears')

if (failures > 0) throw new Error(`${failures} automatic agent discovery test(s) failed`)
console.log('\n✅ ALL AUTOMATIC AGENT DISCOVERY TESTS PASS')
