import {
  MAX_PREVIEW_URL_LENGTH,
  PREVIEW_PARTITION,
  normalizePreviewUrl,
  previewRequestAllowed,
  previewUrlLabel
} from './preview'

let failures = 0
function assert(condition: unknown, message: string): void {
  if (condition) console.log(`  ok: ${message}`)
  else {
    console.error(`FAIL: ${message}`)
    failures++
  }
}

assert(PREVIEW_PARTITION === 'shepherd-preview', 'uses a dedicated ephemeral partition')
assert(
  normalizePreviewUrl('localhost:43140').url === 'http://localhost:43140/',
  'adds the default HTTP scheme'
)
assert(normalizePreviewUrl('http://127.0.0.1:3000/path').ok, 'accepts IPv4 loopback')
assert(normalizePreviewUrl('https://[::1]:8443').ok, 'accepts IPv6 loopback')
assert(normalizePreviewUrl('http://127.10.20.30:9000').ok, 'accepts the IPv4 loopback block')
assert(!normalizePreviewUrl('https://example.com').ok, 'rejects a remote host')
assert(!normalizePreviewUrl('http://localhost.example.com').ok, 'rejects a deceptive hostname')
assert(!normalizePreviewUrl('file:///etc/passwd').ok, 'rejects file URLs')
assert(!normalizePreviewUrl('javascript:alert(1)').ok, 'rejects executable URL schemes')
assert(!normalizePreviewUrl('http://user:pass@localhost:3000').ok, 'rejects credentials')
assert(
  !normalizePreviewUrl(`http://localhost/${'x'.repeat(MAX_PREVIEW_URL_LENGTH)}`).ok,
  'bounds URLs'
)
assert(!normalizePreviewUrl('http://local\0host:3000').ok, 'rejects control characters')
assert(
  previewUrlLabel('http://localhost:43140/health') === 'localhost:43140/health',
  'formats compact preview labels'
)

assert(previewRequestAllowed('http://localhost:43140/app', 'mainFrame'), 'allows local pages')
assert(previewRequestAllowed('ws://localhost:43140/hmr', 'webSocket'), 'allows local HMR')
assert(previewRequestAllowed('data:text/plain,ok', 'image'), 'allows inline subresources')
assert(
  previewRequestAllowed('blob:http://localhost:43140/id', 'xhr'),
  'allows blobs created by local pages'
)
assert(!previewRequestAllowed('https://example.com/app.js', 'script'), 'blocks remote resources')
assert(!previewRequestAllowed('wss://example.com/socket', 'webSocket'), 'blocks remote sockets')
assert(!previewRequestAllowed('blob:https://example.com/id', 'xhr'), 'blocks remote blobs')
assert(
  !previewRequestAllowed('data:text/html,unsafe', 'mainFrame'),
  'blocks inline top-level pages'
)
assert(!previewRequestAllowed('about:blank', 'mainFrame'), 'blocks blank top-level navigation')

if (failures > 0) throw new Error(`${failures} preview contract test(s) failed`)
console.log('\n✅ ALL PREVIEW CONTRACT TESTS PASS')
