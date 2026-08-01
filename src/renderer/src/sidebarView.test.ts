import { workspaceIdentity, workspaceProjectContext } from './sidebarView'

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

if (failures > 0) throw new Error(`${failures} sidebar-view test(s) failed`)
console.log('\n✅ ALL SIDEBAR VIEW TESTS PASS')
