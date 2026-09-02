import { APPEARANCE_MODES, isAppearanceMode, resolvedAppearance } from './appearance'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

for (const mode of APPEARANCE_MODES) {
  assert(isAppearanceMode(mode), `accepts ${mode} appearance`)
}
assert(!isAppearanceMode('sepia'), 'rejects an unsupported appearance')
assert(!isAppearanceMode(null), 'rejects a non-string appearance')
assert(resolvedAppearance(true) === 'dark', 'resolves dark native appearance')
assert(resolvedAppearance(false) === 'light', 'resolves light native appearance')

if (failures > 0) throw new Error(`${failures} appearance contract test(s) failed`)
console.log('\n✅ ALL APPEARANCE CONTRACT TESTS PASS')
