import { resolveGitRepository } from './repository'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

async function main(): Promise<void> {
  const resolved = await resolveGitRepository(process.cwd())
  assert(resolved.root === process.cwd(), 'resolves the containing Git root')
  assert(resolved.name.length > 0, 'returns a concise display name')
  await resolveGitRepository('relative').then(
    () => assert(false, 'rejects relative paths'),
    () => assert(true, 'rejects relative paths')
  )
  await resolveGitRepository('/tmp').then(
    () => assert(false, 'rejects a directory outside Git'),
    () => assert(true, 'rejects a directory outside Git')
  )
  if (failures) process.exitCode = 1
}

void main()
