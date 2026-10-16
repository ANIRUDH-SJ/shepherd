import {
  MAX_LINKED_REPOSITORIES,
  sanitizeLinkedRepositories,
  validRepositoryRoot
} from './repository'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}
assert(validRepositoryRoot('/tmp/repo'), 'accepts an absolute repository root')
assert(!validRepositoryRoot('repo'), 'rejects relative path')
assert(!validRepositoryRoot('/tmp/no\nthanks'), 'rejects control characters')
assert(
  sanitizeLinkedRepositories(['/tmp/a', '/tmp/a', 'relative', '/tmp/b']).join(',') ===
    '/tmp/a,/tmp/b',
  'deduplicates and drops invalid restored roots'
)
assert(
  sanitizeLinkedRepositories(Array.from({ length: 20 }, (_, index) => `/tmp/${index}`)).length ===
    MAX_LINKED_REPOSITORIES,
  'bounds restored repository list'
)
if (failures) process.exitCode = 1
