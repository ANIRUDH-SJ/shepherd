import { workspaceIdentity } from './sidebarView'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

const custom = workspaceIdentity({ name: 'release work', projectName: 'cmux-linux' }, 2)
assert(custom.primary === 'release work', 'keeps a custom workspace name primary')
assert(custom.context === 'cmux-linux', 'keeps the project as custom-name context')
assert(custom.positional === 'Workspace 3', 'retains stable positional context')

const unnamed = workspaceIdentity({ name: '', projectName: 'cmux-linux' }, 0)
assert(unnamed.primary === 'cmux-linux', 'promotes the project for an unnamed workspace')
assert(unnamed.context === 'Workspace 1', 'keeps the position as project context')

if (failures > 0) throw new Error(`${failures} sidebar-view test(s) failed`)
console.log('\n✅ ALL SIDEBAR VIEW TESTS PASS')
