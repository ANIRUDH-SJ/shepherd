import { app } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'
import { PRODUCT_ENV, productEnvironmentValue } from '../shared/product'
import { recordSessionChanges } from './provenance'
import { writeSessionSnapshot } from './sessionFile'

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

let lastSnapshot: unknown | undefined

/** Read the saved session (or null if none / unreadable). */
export function loadSession(): unknown {
  try {
    lastSnapshot = JSON.parse(readFileSync(sessionPath(), 'utf8'))
  } catch {
    lastSnapshot = null
  }
  return lastSnapshot
}

/** Write the session snapshot. Best-effort — never throws into the app. */
export function saveSession(state: unknown): void {
  const p = sessionPath()
  try {
    const previous = lastSnapshot === undefined ? loadSession() : lastSnapshot
    writeSessionSnapshot(p, state)
    lastSnapshot = state
    try {
      recordSessionChanges(previous, state)
    } catch (error) {
      console.error('[provenance] record failed:', error)
    }
  } catch (e) {
    console.error('[session] save failed:', e)
  }
}
