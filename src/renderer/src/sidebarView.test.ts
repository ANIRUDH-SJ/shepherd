import { workspaceIdentity, workspaceProjectContext, workspaceRuntimeContext } from './sidebarView'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

const custom = workspaceIdentity({ name: 'release work', projectName: 'shepherd' }, 2)
assert(custom.primary === 'release work', 'keeps a custom workspace name primary')
assert(custom.context === 'shepherd', 'keeps the project as custom-name context')
assert(custom.positional === 'Workspace 3', 'retains stable positional context')
assert(
  workspaceProjectContext({ name: 'release work', projectName: 'shepherd' }, custom) === 'shepherd',
  'keeps useful project context below a custom name'
)

const customHome = workspaceIdentity({ name: 'API', projectName: 'Home' }, 1)
assert(
  workspaceProjectContext({ name: 'API', projectName: 'Home' }, customHome) === null,
  'hides generic Home context below a custom name'
)

const unnamed = workspaceIdentity({ name: '', projectName: 'shepherd' }, 0)
assert(unnamed.primary === 'shepherd', 'promotes the project for an unnamed workspace')
assert(unnamed.context === 'Workspace 1', 'keeps the position as project context')
assert(
  workspaceProjectContext({ name: '', projectName: 'shepherd' }, unnamed) === null,
  'does not repeat context below an unnamed project identity'
)

assert(
  workspaceRuntimeContext({ pullRequest: null, ports: [] }) === null,
  'hides unavailable runtime context completely'
)
const runtime = workspaceRuntimeContext({
  pullRequest: { number: 48, state: 'open', url: 'https://github.com/o/r/pull/48' },
  ports: [3000, 4173, 8080, 9222]
})
assert(
  runtime?.label === 'PR #48 open · :3000 :4173 +2',
  'keeps PR and several ports on one bounded detail line'
)
assert(
  runtime?.description === 'Pull request #48: open. Listening ports: 3000, 4173, 8080, 9222',
  'retains complete metadata for hover and assistive technology'
)
assert(
  workspaceRuntimeContext({ pullRequest: null, ports: [8080] })?.label === ':8080',
  'shows ports without requiring GitHub context'
)

if (failures > 0) throw new Error(`${failures} sidebar-view test(s) failed`)
console.log('\n✅ ALL SIDEBAR VIEW TESTS PASS')
