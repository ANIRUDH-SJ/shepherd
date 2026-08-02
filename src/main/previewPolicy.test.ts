import {
  hardenPreviewPreferences,
  previewAttachAllowed,
  previewNavigationAllowed,
  previewPermissionAllowed,
  previewWindowOpenHandler
} from './previewPolicy'
import { PREVIEW_PARTITION } from '../shared/preview'

let failures = 0
function assert(condition: unknown, message: string): void {
  if (condition) console.log(`  ok: ${message}`)
  else {
    console.error(`FAIL: ${message}`)
    failures++
  }
}

const preferences: Record<string, unknown> = {
  preload: '/tmp/hostile.js',
  nodeIntegration: true,
  nodeIntegrationInSubFrames: true,
  nodeIntegrationInWorker: true,
  contextIsolation: false,
  sandbox: false,
  webSecurity: false,
  allowRunningInsecureContent: true,
  devTools: true,
  backgroundThrottling: false
}
hardenPreviewPreferences(preferences)
assert(!('preload' in preferences), 'removes guest preload scripts')
assert(preferences.nodeIntegration === false, 'disables Node integration')
assert(preferences.nodeIntegrationInSubFrames === false, 'disables subframe Node integration')
assert(preferences.nodeIntegrationInWorker === false, 'disables worker Node integration')
assert(preferences.contextIsolation === true, 'enables context isolation')
assert(preferences.sandbox === true, 'enables the Chromium sandbox')
assert(preferences.webSecurity === true, 'keeps web security enabled')
assert(preferences.allowRunningInsecureContent === false, 'blocks mixed content')
assert(preferences.devTools === false, 'disables preview DevTools')
assert(preferences.backgroundThrottling === true, 'keeps hidden previews throttled')

assert(
  previewAttachAllowed({ src: 'http://localhost:43140/', partition: PREVIEW_PARTITION }),
  'attaches a local preview in the dedicated partition'
)
assert(
  !previewAttachAllowed({ src: 'https://example.com/', partition: PREVIEW_PARTITION }),
  'rejects a remote initial page'
)
assert(
  !previewAttachAllowed({ src: 'http://localhost:43140/', partition: 'persist:shared' }),
  'rejects another storage partition'
)
assert(previewNavigationAllowed('http://[::1]:43140/path'), 'allows local navigation')
assert(!previewNavigationAllowed('https://example.com/'), 'blocks remote navigation')
assert(previewWindowOpenHandler().action === 'deny', 'denies every popup')
assert(!previewPermissionAllowed(), 'denies every guest permission')

if (failures > 0) throw new Error(`${failures} preview policy test(s) failed`)
console.log('\n✅ ALL PREVIEW POLICY TESTS PASS')
