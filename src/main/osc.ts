// ─────────────────────────────────────────────────────────────────────────────
// OSC NOTIFICATION SNIFFER  (pure — no electron, no side effects → unit-testable)
// Scans terminal output for OSC 9 / 777 / 99 "desktop notification" escape codes.
// Any program (or agent) that emits one raises a sidebar notification with zero
// setup. This does NOT alter the stream sent to xterm — it only sniffs a copy.
// See docs/ARCHITECTURE.md for the notification data flow.
// ─────────────────────────────────────────────────────────────────────────────

export interface OscNotification {
  title: string
  body: string
}

const MAX_BUFFER = 8192 // give up on a "sequence" longer than this (not a notification)

/**
 * Scan a chunk of terminal output for OSC notification sequences.
 * Returns the complete notifications found, plus `rest` — an unterminated tail to
 * prepend to the next chunk (an escape sequence can split across reads).
 */
export function parseOsc(buffer: string): { notifications: OscNotification[]; rest: string } {
  const notifications: OscNotification[] = []
  let i = 0
  let rest = ''

  while (i < buffer.length) {
    const start = buffer.indexOf('\x1b]', i)
    if (start === -1) {
      // Keep a lone trailing ESC in case its "]" arrives in the next chunk.
      rest = buffer.endsWith('\x1b') ? '\x1b' : ''
      break
    }

    // OSC ends with BEL (\x07) or ST (\x1b\\).
    const bel = buffer.indexOf('\x07', start + 2)
    const st = buffer.indexOf('\x1b\\', start + 2)
    let end = -1
    let termLen = 0
    if (bel !== -1 && (st === -1 || bel < st)) {
      end = bel
      termLen = 1
    } else if (st !== -1) {
      end = st
      termLen = 2
    }

    if (end === -1) {
      // Incomplete — buffer from `start` for the next chunk (unless absurdly long).
      rest = buffer.length - start > MAX_BUFFER ? '' : buffer.slice(start)
      break
    }

    const notif = oscToNotification(buffer.slice(start + 2, end))
    if (notif) notifications.push(notif)
    i = end + termLen
  }

  return { notifications, rest }
}

function oscToNotification(payload: string): OscNotification | null {
  const semi = payload.indexOf(';')
  if (semi === -1) return null
  const code = payload.slice(0, semi)
  const rest = payload.slice(semi + 1)

  if (code === '9') {
    // iTerm2:  ESC ] 9 ; <message> BEL
    return rest ? { title: 'Terminal', body: rest } : null
  }
  if (code === '777') {
    // urxvt:  ESC ] 777 ; notify ; <title> ; <body> ST
    const parts = rest.split(';')
    if (parts[0] !== 'notify') return null
    const title = parts[1] || 'Terminal'
    const body = parts.slice(2).join(';')
    return { title, body: body || title }
  }
  if (code === '99') {
    // kitty:  ESC ] 99 ; <metadata> ; <body> ST   (metadata may be empty)
    const semi2 = rest.indexOf(';')
    const body = semi2 === -1 ? rest : rest.slice(semi2 + 1)
    return body ? { title: 'Terminal', body } : null
  }
  return null // other OSC codes (window title, colors, hyperlinks…) are not notifications
}
