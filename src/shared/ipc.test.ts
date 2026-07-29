import { isTermDataAck } from './ipc'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

assert(isTermDataAck({ id: 'term-1', sequence: 1 }), 'accepts a bounded output acknowledgement')
assert(!isTermDataAck(null), 'rejects a null acknowledgement')
assert(!isTermDataAck({ id: '', sequence: 1 }), 'rejects an empty terminal id')
assert(!isTermDataAck({ id: 'term-1', sequence: 0 }), 'rejects a zero sequence')
assert(!isTermDataAck({ id: 'term-1', sequence: 1.5 }), 'rejects a fractional sequence')
assert(!isTermDataAck({ id: 'x'.repeat(257), sequence: 1 }), 'rejects an oversized terminal id')

if (failures > 0) throw new Error(`${failures} terminal IPC contract test(s) failed`)
console.log('\n✅ ALL TERMINAL IPC CONTRACT TESTS PASS')
