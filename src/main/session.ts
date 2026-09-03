import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { PRODUCT_ENV, productEnvironmentValue } from '../shared/product'

// ─────────────────────────────────────────────────────────────────────────────
// SESSION PERSISTENCE  (main process)
// Save/restore the app's workspace + pane layout to a JSON snapshot, so relaunching
// reopens where you left off. The renderer owns the state; we just read/write the
// file. See docs/ARCHITECTURE.md for state ownership and restoration boundaries.
// ─────────────────────────────────────────────────────────────────────────────

export function resolveSessionPath(
  env: Record<string, string | undefined>,
  userDataPath: string
): string {
  return (
    productEnvironmentValue(env, PRODUCT_ENV.sessionPath, PRODUCT_ENV.legacySessionPath) ||
    join(userDataPath, 'session.json')
  )
}

function sessionPath(): string {
  return resolveSessionPath(process.env, app.getPath('userData'))
}

/** Read the saved session (or null if none / unreadable). */
export function loadSession(): unknown {
  try {
    return JSON.parse(readFileSync(sessionPath(), 'utf8'))
  } catch {
    return null
  }
}

/** Write the session snapshot. Best-effort — never throws into the app. */
export function saveSession(state: unknown): void {
  const p = sessionPath()
  try {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(state, null, 2))
  } catch (e) {
    console.error('[session] save failed:', e)
  }
}
