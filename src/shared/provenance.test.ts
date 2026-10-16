import { deriveAuditEvents, sanitizeAuditEntries, sessionExport } from './provenance'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}
const pane = (ids: string[]) => ({ type: 'pane', pane: { surfaces: ids.map((id) => ({ id })) } })
const before = {
  workspaces: [{ id: 'a', name: 'Task', linkedRepositories: [], root: pane(['one']) }],
  notifications: [{ body: 'private text' }]
}
const after = {
  workspaces: [
    { id: 'a', name: 'New task', linkedRepositories: ['/private/repo'], root: pane(['one', 'two']) }
  ],
  notifications: [{ body: 'another secret' }]
}
const events = deriveAuditEvents(before, after)
assert(
  events.some((entry) => entry.kind === 'workspace-renamed'),
  'records rename'
)
assert(
  events.some((entry) => entry.kind === 'repository-linked'),
  'records repository link'
)
assert(
  events.some((entry) => entry.kind === 'surface-opened'),
  'records tab opening'
)
assert(!JSON.stringify(events).includes('/private/repo'), 'does not audit repository paths')
assert(!JSON.stringify(events).includes('secret'), 'does not audit notification content')
assert(deriveAuditEvents(after, after).length === 0, 'unchanged snapshot creates no event')
assert(deriveAuditEvents(null, before)[0]?.kind === 'workspace-created', 'records first workspace')
assert(
  deriveAuditEvents(before, { workspaces: [] })[0]?.kind === 'workspace-closed',
  'records closing a workspace'
)
const history = sanitizeAuditEntries([
  {
    id: 'a',
    at: 1,
    kind: 'workspace-created',
    workspaceId: 'a',
    workspaceName: 'Task',
    detail: 'Workspace created'
  },
  { invalid: true }
])
assert(history.length === 1, 'rejects malformed audit records')
assert(
  sanitizeAuditEntries(
    Array.from({ length: 600 }, (_, index) => ({
      ...history[0],
      id: String(index),
      at: index
    }))
  ).length === 500,
  'bounds audit history'
)
assert(
  sanitizeAuditEntries([{ ...history[0], at: 9e15 }]).length === 0,
  'rejects out-of-range timestamps'
)
const exported = sessionExport(after, history, 100) as {
  format: string
  session: unknown
  history: unknown
}
assert(
  exported.format === 'shepherd-session-export' && exported.session === after,
  'exports a versioned session envelope'
)
assert(exported.history === history, 'includes audit history')
if (failures) process.exitCode = 1
