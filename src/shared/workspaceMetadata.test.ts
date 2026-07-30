import {
  isWorkspaceMetadata,
  sameWorkspaceMetadata,
  workspaceProjectName
} from './workspaceMetadata'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

assert(workspaceProjectName('~') === 'Home', 'labels the home shorthand')
assert(
  workspaceProjectName('/home/dev', null, '/home/dev') === 'Home',
  'labels the resolved home directory'
)
assert(
  workspaceProjectName('/projects/shepherd/src', '/projects/shepherd') === 'shepherd',
  'uses the Git root as the project name'
)
assert(
  workspaceProjectName('/projects/scratch') === 'scratch',
  'uses the current directory outside Git'
)

const metadata = {
  surfaceId: 'term-1',
  cwd: '/projects/shepherd',
  projectName: 'shepherd',
  gitRoot: '/projects/shepherd',
  gitBranch: 'main'
}
assert(sameWorkspaceMetadata(metadata, { ...metadata }), 'compares identical metadata')
assert(
  !sameWorkspaceMetadata(metadata, { ...metadata, gitBranch: 'feature' }),
  'detects a branch change'
)
assert(isWorkspaceMetadata(metadata), 'accepts complete workspace metadata')
assert(!isWorkspaceMetadata({ ...metadata, cwd: 'relative' }), 'rejects a relative live cwd')

if (failures > 0) throw new Error(`${failures} workspace metadata test(s) failed`)
console.log('\n✅ ALL WORKSPACE METADATA TESTS PASS')
