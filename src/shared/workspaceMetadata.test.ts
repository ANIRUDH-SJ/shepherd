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
  gitBranch: 'main',
  pullRequest: { number: 48, state: 'open' as const, url: 'https://github.com/o/r/pull/48' },
  ports: [3000, 8080]
}
assert(sameWorkspaceMetadata(metadata, { ...metadata }), 'compares identical metadata')
assert(
  !sameWorkspaceMetadata(metadata, { ...metadata, gitBranch: 'feature' }),
  'detects a branch change'
)
assert(isWorkspaceMetadata(metadata), 'accepts complete workspace metadata')
assert(!isWorkspaceMetadata({ ...metadata, cwd: 'relative' }), 'rejects a relative live cwd')
assert(!isWorkspaceMetadata({ ...metadata, ports: [8080, 3000] }), 'rejects unsorted ports')
assert(!isWorkspaceMetadata({ ...metadata, ports: [0] }), 'rejects invalid ports')
assert(
  !isWorkspaceMetadata({ ...metadata, pullRequest: { ...metadata.pullRequest, state: 'queued' } }),
  'rejects unsupported pull request states'
)

if (failures > 0) throw new Error(`${failures} workspace metadata test(s) failed`)
console.log('\n✅ ALL WORKSPACE METADATA TESTS PASS')
