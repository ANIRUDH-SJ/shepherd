export const PRODUCT_NAME = 'Shepherd'
export const PRODUCT_SLUG = 'shepherd'
export const LEGACY_PRODUCT_SLUG = 'cmux-linux'

export const DEFAULT_SOCKET_PATH = '/tmp/shepherd.sock'
export const LEGACY_DEFAULT_SOCKET_PATH = '/tmp/cmux-linux.sock'

export const PRODUCT_ENV = {
  socketPath: 'SHEPHERD_SOCKET_PATH',
  legacySocketPath: 'CMUX_SOCKET_PATH',
  sessionPath: 'SHEPHERD_SESSION_PATH',
  legacySessionPath: 'CMUX_SESSION_PATH',
  workspaceId: 'SHEPHERD_WORKSPACE_ID',
  legacyWorkspaceId: 'CMUX_WORKSPACE_ID',
  surfaceId: 'SHEPHERD_SURFACE_ID',
  legacySurfaceId: 'CMUX_SURFACE_ID',
  electron: 'SHEPHERD_ELECTRON',
  legacyElectron: 'CMUX_ELECTRON',
  performanceDiagnostics: 'SHEPHERD_PERF_DIAGNOSTICS',
  legacyPerformanceDiagnostics: 'CMUX_PERF_DIAGNOSTICS',
  memoryDiagnostics: 'SHEPHERD_MEMORY_DIAGNOSTICS',
  legacyMemoryDiagnostics: 'CMUX_MEMORY_DIAGNOSTICS'
} as const

export type ProductEnvironment = Record<string, string | undefined>

export function productEnvironmentValue(
  env: ProductEnvironment,
  primary: string,
  legacy: string
): string | undefined {
  const primaryValue = env[primary]
  if (typeof primaryValue === 'string' && primaryValue.length > 0) return primaryValue
  const legacyValue = env[legacy]
  return typeof legacyValue === 'string' && legacyValue.length > 0 ? legacyValue : undefined
}

export function productDiagnosticsEnabled(
  env: ProductEnvironment,
  primary: string,
  legacy: string
): boolean {
  return env[primary] === undefined ? env[legacy] === '1' : env[primary] === '1'
}

export function productSocketPaths(env: ProductEnvironment): string[] {
  const override = productEnvironmentValue(
    env,
    PRODUCT_ENV.socketPath,
    PRODUCT_ENV.legacySocketPath
  )
  return override ? [override] : [DEFAULT_SOCKET_PATH, LEGACY_DEFAULT_SOCKET_PATH]
}
