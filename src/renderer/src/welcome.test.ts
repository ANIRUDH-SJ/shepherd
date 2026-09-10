import {
  markWelcomeShown,
  shouldShowWelcome,
  WELCOME_COMMAND,
  WELCOME_STORAGE_KEY
} from './welcome'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

const values = new Map<string, string>()
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value)
}

assert(shouldShowWelcome(false, storage), 'shows welcome for a fresh installation')
assert(!shouldShowWelcome(true, storage), 'does not interrupt a restored session')
markWelcomeShown(storage)
assert(values.get(WELCOME_STORAGE_KEY) === '1', 'persists the one-time welcome marker')
assert(!shouldShowWelcome(false, storage), 'does not repeat welcome after it was shown')
assert(WELCOME_COMMAND === 'shepherd welcome\r', 'runs the public welcome command in the shell')

const unavailableStorage = {
  getItem: () => {
    throw new Error('unavailable')
  },
  setItem: () => {
    throw new Error('unavailable')
  }
}
assert(shouldShowWelcome(false, unavailableStorage), 'fails open for a first-launch welcome')
markWelcomeShown(unavailableStorage)
assert(true, 'storage failure does not break startup')

if (failures > 0) throw new Error(`${failures} welcome test(s) failed`)
console.log('\n✅ ALL WELCOME TESTS PASS')
