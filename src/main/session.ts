import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

// ─────────────────────────────────────────────────────────────────────────────
// SESSION PERSISTENCE  (main process)
// Save/restore the app's workspace + pane layout to a JSON snapshot, so relaunching
// reopens where you left off. The renderer owns the state; we just read/write the
// file. See textbook/13.
// ─────────────────────────────────────────────────────────────────────────────

function sessionPath(): string {
  return process.env.CMUX_SESSION_PATH || join(app.getPath('userData'), 'session.json')
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
