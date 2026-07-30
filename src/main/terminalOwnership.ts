export interface TerminalOwnershipSnapshot {
  terminalCount: number
  ownerCount: number
}

interface OwnerGroup {
  terminalIds: Set<string>
  unsubscribe: () => void
}

interface TerminalOwnershipOptions<Owner extends object, Terminal> {
  subscribeOwnerLoss(owner: Owner, listener: () => void): () => void
  onOwnerLost(id: string, terminal: Terminal): void
}

/**
 * Tracks terminals by both stable surface id and renderer owner. One owner-loss
 * listener serves every terminal belonging to that renderer.
 */
export class TerminalOwnershipRegistry<Owner extends object, Terminal> {
  private readonly terminals = new Map<string, { owner: Owner; terminal: Terminal }>()
  private readonly owners = new Map<Owner, OwnerGroup>()

  constructor(private readonly options: TerminalOwnershipOptions<Owner, Terminal>) {}

  add(id: string, owner: Owner, terminal: Terminal): void {
    if (this.terminals.has(id)) throw new Error(`terminal already registered: ${id}`)
    let group = this.owners.get(owner)
    if (!group) {
      const terminalIds = new Set<string>()
      const unsubscribe = this.options.subscribeOwnerLoss(owner, () => this.releaseOwner(owner))
      group = { terminalIds, unsubscribe }
      this.owners.set(owner, group)
    }
    group.terminalIds.add(id)
    this.terminals.set(id, { owner, terminal })
  }

  get(id: string): Terminal | undefined {
    return this.terminals.get(id)?.terminal
  }

  getOwned(id: string, owner: Owner): Terminal | undefined {
    const record = this.terminals.get(id)
    return record?.owner === owner ? record.terminal : undefined
  }

  remove(id: string, expected?: Terminal): boolean {
    const record = this.terminals.get(id)
    if (!record || (expected !== undefined && record.terminal !== expected)) return false
    this.terminals.delete(id)
    const group = this.owners.get(record.owner)
    group?.terminalIds.delete(id)
    if (group && group.terminalIds.size === 0) {
      this.owners.delete(record.owner)
      this.unsubscribe(group)
    }
    return true
  }

  entries(): Array<[string, Terminal]> {
    return [...this.terminals].map(([id, record]) => [id, record.terminal])
  }

  snapshot(): TerminalOwnershipSnapshot {
    return { terminalCount: this.terminals.size, ownerCount: this.owners.size }
  }

  clear(): Array<[string, Terminal]> {
    const entries = this.entries()
    this.terminals.clear()
    for (const group of this.owners.values()) this.unsubscribe(group)
    this.owners.clear()
    return entries
  }

  private releaseOwner(owner: Owner): void {
    const group = this.owners.get(owner)
    if (!group) return
    this.owners.delete(owner)
    this.unsubscribe(group)
    const released: Array<[string, Terminal]> = []
    for (const id of group.terminalIds) {
      const record = this.terminals.get(id)
      if (record?.owner !== owner) continue
      this.terminals.delete(id)
      released.push([id, record.terminal])
    }
    group.terminalIds.clear()
    for (const [id, terminal] of released) {
      try {
        this.options.onOwnerLost(id, terminal)
      } catch {
        // One broken terminal cleanup must not retain the owner's other PTYs.
      }
    }
  }

  private unsubscribe(group: OwnerGroup): void {
    try {
      group.unsubscribe()
    } catch {
      // Listener teardown is secondary to dropping terminal ownership records.
    }
  }
}
