import {
  collectOwnedProcessIds,
  normalizeListeningPorts,
  parseListeningSocketTable,
  parsePullRequestJson,
  portsOwnedByProcesses,
  pullRequestFromCommandResult,
  MAX_LISTENING_PORTS,
  serverProcessIds
} from './workspaceContext'

let failures = 0
function assert(condition: unknown, message: string): void {
  if (condition) console.log(`  ok: ${message}`)
  else {
    console.error(`FAIL: ${message}`)
    failures++
  }
}

const open = parsePullRequestJson(
  JSON.stringify({
    number: 48,
    state: 'OPEN',
    isDraft: false,
    url: 'https://github.com/o/r/pull/48'
  })
)
assert(open?.number === 48 && open.state === 'open', 'parses an open pull request')
const draft = parsePullRequestJson(
  JSON.stringify({
    number: 49,
    state: 'OPEN',
    isDraft: true,
    url: 'https://github.com/o/r/pull/49'
  })
)
assert(draft?.state === 'draft', 'draft status takes precedence over open')
const merged = parsePullRequestJson(
  JSON.stringify({
    number: 50,
    state: 'MERGED',
    isDraft: false,
    url: 'https://github.com/o/r/pull/50'
  })
)
assert(merged?.state === 'merged', 'parses a merged pull request')
const closed = parsePullRequestJson(
  JSON.stringify({
    number: 51,
    state: 'CLOSED',
    isDraft: false,
    url: 'https://github.com/o/r/pull/51'
  })
)
assert(closed?.state === 'closed', 'parses a closed pull request')
assert(parsePullRequestJson('{bad json') === null, 'rejects malformed gh output')
assert(
  parsePullRequestJson(JSON.stringify({ number: 0, state: 'OPEN', isDraft: false, url: '' })) ===
    null,
  'rejects invalid pull request identity'
)
assert(parsePullRequestJson('x'.repeat(20_000)) === null, 'bounds gh output before parsing')
assert(
  pullRequestFromCommandResult(new Error('gh unavailable'), '{}') === null,
  'hides missing gh, remote, and authentication command failures'
)

const procNet = `
  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode
   0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 111 1
   1: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 222 1
   2: 0100007F:0050 00000000:0000 01 00000000:00000000 00:00000000 00000000 1000 0 333 1
`
const sockets = parseListeningSocketTable(procNet)
assert(sockets.length === 2, 'keeps only listening TCP sockets')
assert(sockets[0]?.port === 3000 && sockets[0].inode === '111', 'decodes a hex port')
assert(sockets[1]?.port === 8080, 'parses another listening port')

const owned = collectOwnedProcessIds(
  10,
  new Map([
    [10, 1],
    [11, 10],
    [12, 11],
    [13, 99],
    [14, 12]
  ])
)
assert([...owned].join(',') === '10,11,12,14', 'collects only shell descendants')
const capped = collectOwnedProcessIds(
  10,
  new Map([
    [11, 10],
    [12, 11],
    [13, 12]
  ]),
  2
)
assert(capped.size === 2 && capped.has(10) && capped.has(11), 'bounds descendant traversal')

const ports = portsOwnedByProcesses(
  sockets,
  owned,
  new Map([
    [11, new Set(['111'])],
    [13, new Set(['222'])],
    [14, new Set(['222'])]
  ])
)
assert(ports.join(',') === '3000,8080', 'keeps sockets owned by terminal descendants')
const reused = portsOwnedByProcesses(
  [
    { inode: '111', port: 3000 },
    { inode: '444', port: 3000 }
  ],
  owned,
  new Map([
    [11, new Set(['111'])],
    [14, new Set(['444'])]
  ])
)
assert(reused.join(',') === '3000', 'deduplicates a port reused by owned processes')
const servers = serverProcessIds(10, owned)
assert(
  !servers.has(10) && servers.has(11) && servers.has(14),
  'excludes listener descriptors inherited by the PTY shell itself'
)
assert(
  normalizeListeningPorts([3000, 80, 3000, -1, 65_536, 443.5]).join(',') === '80,3000',
  'deduplicates, sorts, and validates ports'
)
assert(
  normalizeListeningPorts(Array.from({ length: 40 }, (_, index) => index + 1)).length ===
    MAX_LISTENING_PORTS,
  'bounds the number of reported ports'
)

console.log(
  failures === 0 ? '\n✅ ALL WORKSPACE CONTEXT TESTS PASS' : `\n❌ ${failures} FAILURE(S)`
)
if (failures > 0) throw new Error(`${failures} workspace context test(s) failed`)
