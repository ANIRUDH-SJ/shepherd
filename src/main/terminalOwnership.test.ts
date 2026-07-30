import { TerminalOwnershipRegistry } from './terminalOwnership'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

interface Owner {
  name: string
}

interface Terminal {
  name: string
}

const ownerListeners = new Map<Owner, () => void>()
const unsubscribeCounts = new Map<Owner, number>()
const released: string[] = []
const ownerA = { name: 'renderer-a' }
const ownerB = { name: 'renderer-b' }
const terminalA = { name: 'terminal-a' }
const terminalB = { name: 'terminal-b' }
const terminalC = { name: 'terminal-c' }

const registry = new TerminalOwnershipRegistry<Owner, Terminal>({
  subscribeOwnerLoss: (owner, listener) => {
    ownerListeners.set(owner, listener)
    return () => {
      unsubscribeCounts.set(owner, (unsubscribeCounts.get(owner) ?? 0) + 1)
      ownerListeners.delete(owner)
    }
  },
  onOwnerLost: (id) => {
    released.push(id)
    assert(registry.snapshot().terminalCount === 0, 'drops owner records before cleanup callbacks')
    if (id === 'term-a') throw new Error('simulated terminal cleanup failure')
  }
})

registry.add('term-a', ownerA, terminalA)
registry.add('term-b', ownerA, terminalB)
registry.add('term-c', ownerB, terminalC)
assert(
  registry.snapshot().terminalCount === 3 && registry.snapshot().ownerCount === 2,
  'tracks terminal and owner counts'
)
assert(ownerListeners.size === 2, 'uses one owner-loss subscription per renderer')
assert(registry.getOwned('term-a', ownerA) === terminalA, 'returns a terminal to its owner')
assert(registry.getOwned('term-a', ownerB) === undefined, 'rejects another renderer owner')
assert(!registry.remove('term-a', terminalC), 'rejects stale terminal removal')
assert(registry.get('term-a') === terminalA, 'preserves a terminal after stale removal')

registry.remove('term-c', terminalC)
assert(unsubscribeCounts.get(ownerB) === 1, 'unsubscribes when an owner loses its last terminal')
assert(registry.snapshot().ownerCount === 1, 'removes an empty owner group')

ownerListeners.get(ownerA)?.()
assert(registry.snapshot().terminalCount === 0, 'releases every terminal after owner loss')
assert(registry.snapshot().ownerCount === 0, 'releases the lost owner group')
assert(released.join(',') === 'term-a,term-b', 'continues cleanup after one callback fails')
assert(unsubscribeCounts.get(ownerA) === 1, 'unsubscribes owner loss exactly once')

registry.add('term-a', ownerB, terminalC)
assert(registry.getOwned('term-a', ownerB) === terminalC, 'allows a released id to be replaced')
assert(
  registry.getOwned('term-a', ownerA) === undefined,
  'rejects stale cleanup after another renderer replaces the id'
)
const cleared = registry.clear()
assert(cleared[0]?.[1] === terminalC, 'returns terminal records for explicit shutdown cleanup')
assert(
  registry.snapshot().terminalCount === 0 && registry.snapshot().ownerCount === 0,
  'clears every ownership record'
)
assert(unsubscribeCounts.get(ownerB) === 2, 'clear unsubscribes the remaining owner listener')

if (failures > 0) throw new Error(`${failures} terminal ownership test(s) failed`)
console.log('\n✅ ALL TERMINAL OWNERSHIP TESTS PASS')
