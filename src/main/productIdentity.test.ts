import assert from 'node:assert/strict'
import { configureProductIdentity, selectProductUserDataPath } from './productIdentity'

const nothingExists = (): boolean => false
assert.deepEqual(selectProductUserDataPath('/config', nothingExists), {
  userDataPath: '/config/shepherd',
  usesLegacyState: false
})

const legacySessionExists = (path: string): boolean => path === '/config/cmux-linux/session.json'
assert.deepEqual(selectProductUserDataPath('/config', legacySessionExists), {
  userDataPath: '/config/cmux-linux',
  usesLegacyState: true
})

const bothHaveState = (path: string): boolean =>
  path === '/config/shepherd/Local Storage' || path === '/config/cmux-linux/session.json'
assert.deepEqual(selectProductUserDataPath('/config', bothHaveState), {
  userDataPath: '/config/shepherd',
  usesLegacyState: false
})

let configuredName = ''
let configuredPath = ''
const configured = configureProductIdentity(
  {
    getPath: () => '/config',
    setName: (name) => {
      configuredName = name
    },
    setPath: (_name, path) => {
      configuredPath = path
    }
  },
  legacySessionExists
)
assert.equal(configuredName, 'Shepherd')
assert.equal(configuredPath, '/config/cmux-linux')
assert.equal(configured.usesLegacyState, true)

console.log('✅ ALL PRODUCT USER-DATA TESTS PASS')
