// Headless tests for the OSC notification sniffer. Run via `npm test` (tsx).
import { parseOsc } from './osc'

let failures = 0
const assert = (c: boolean, m: string): void => {
  if (c) console.log('  ok:', m)
  else {
    console.error('FAIL:', m)
    failures++
  }
}

// OSC 9 (iTerm2)
let r = parseOsc('\x1b]9;hello world\x07')
assert(r.notifications.length === 1 && r.notifications[0].body === 'hello world', 'OSC 9 → body')

// OSC 777 (urxvt) → title + body
r = parseOsc('\x1b]777;notify;Build;passed\x07')
assert(
  r.notifications.length === 1 && r.notifications[0].title === 'Build' && r.notifications[0].body === 'passed',
  'OSC 777 → title + body'
)

// ST (ESC \) terminator instead of BEL
r = parseOsc('\x1b]9;done\x1b\\')
assert(r.notifications.length === 1 && r.notifications[0].body === 'done', 'OSC 9 with ST terminator')

// non-notification OSC (window title) is ignored
r = parseOsc('\x1b]0;my window title\x07')
assert(r.notifications.length === 0, 'OSC 0 (title) is not a notification')

// embedded in ordinary output
r = parseOsc('some text\x1b]9;ping\x07more text')
assert(r.notifications.length === 1 && r.notifications[0].body === 'ping', 'OSC embedded in text')

// SPLIT across two chunks (the key gotcha)
const a = parseOsc('output\x1b]9;half')
assert(a.notifications.length === 0 && a.rest === '\x1b]9;half', 'incomplete OSC is buffered as rest')
const b = parseOsc(a.rest + ' done\x07tail')
assert(b.notifications.length === 1 && b.notifications[0].body === 'half done', 'buffered OSC completes next chunk')

// two notifications in one chunk
r = parseOsc('\x1b]9;one\x07\x1b]9;two\x07')
assert(r.notifications.length === 2, 'two OSC 9 sequences in one chunk')

console.log(failures === 0 ? '\n✅ ALL OSC TESTS PASS' : `\n❌ ${failures} FAILURE(S)`)
if (failures > 0) throw new Error(`${failures} osc test(s) failed`)
