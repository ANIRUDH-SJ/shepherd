import assert from 'node:assert/strict'
import {
  DEFAULT_SOCKET_PATH,
  LEGACY_DEFAULT_SOCKET_PATH,
  PRODUCT_ENV,
  productDiagnosticsEnabled,
  productEnvironmentValue,
  productSocketPaths
} from './product'

assert.equal(
  productEnvironmentValue(
    { SHEPHERD_SOCKET_PATH: '/tmp/new.sock', CMUX_SOCKET_PATH: '/tmp/old.sock' },
    PRODUCT_ENV.socketPath,
    PRODUCT_ENV.legacySocketPath
  ),
  '/tmp/new.sock'
)
assert.equal(
  productEnvironmentValue(
    { CMUX_SOCKET_PATH: '/tmp/old.sock' },
    PRODUCT_ENV.socketPath,
    PRODUCT_ENV.legacySocketPath
  ),
  '/tmp/old.sock'
)
assert.deepEqual(productSocketPaths({}), [DEFAULT_SOCKET_PATH, LEGACY_DEFAULT_SOCKET_PATH])
assert.deepEqual(productSocketPaths({ SHEPHERD_SOCKET_PATH: '/tmp/only.sock' }), ['/tmp/only.sock'])
assert.deepEqual(productSocketPaths({ CMUX_SOCKET_PATH: '/tmp/legacy-only.sock' }), [
  '/tmp/legacy-only.sock'
])
assert.equal(
  productDiagnosticsEnabled(
    { SHEPHERD_PERF_DIAGNOSTICS: '1' },
    PRODUCT_ENV.performanceDiagnostics,
    PRODUCT_ENV.legacyPerformanceDiagnostics
  ),
  true
)
assert.equal(
  productDiagnosticsEnabled(
    { CMUX_PERF_DIAGNOSTICS: '1' },
    PRODUCT_ENV.performanceDiagnostics,
    PRODUCT_ENV.legacyPerformanceDiagnostics
  ),
  true
)
assert.equal(
  productDiagnosticsEnabled(
    { SHEPHERD_PERF_DIAGNOSTICS: '0', CMUX_PERF_DIAGNOSTICS: '1' },
    PRODUCT_ENV.performanceDiagnostics,
    PRODUCT_ENV.legacyPerformanceDiagnostics
  ),
  false
)

console.log('✅ ALL PRODUCT IDENTITY CONTRACT TESTS PASS')
