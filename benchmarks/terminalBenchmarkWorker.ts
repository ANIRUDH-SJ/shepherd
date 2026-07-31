import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const required = [
  'SHEPHERD_BENCH_RUN_ID',
  'SHEPHERD_BENCH_READY_FILE',
  'SHEPHERD_BENCH_DONE_FILE',
  'SHEPHERD_BENCH_ERROR_FILE',
  'SHEPHERD_BENCH_STOP_FILE',
  'SHEPHERD_BENCH_FIXTURE_FILE'
] as const

for (const name of required) {
  if (!process.env[name]) throw new Error(`missing ${name}`)
}

const runId = process.env.SHEPHERD_BENCH_RUN_ID!
const readyFile = process.env.SHEPHERD_BENCH_READY_FILE!
const doneFile = process.env.SHEPHERD_BENCH_DONE_FILE!
const errorFile = process.env.SHEPHERD_BENCH_ERROR_FILE!
const stopFile = process.env.SHEPHERD_BENCH_STOP_FILE!
const fixture = readFileSync(process.env.SHEPHERD_BENCH_FIXTURE_FILE!)
const responseTimeoutMs = Number(process.env.SHEPHERD_BENCH_RESPONSE_TIMEOUT_MS ?? '15000')

if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
  throw new Error('benchmark worker requires a controlling terminal')
}

let started = false
let finished = false
let response = ''
let responseTimer: NodeJS.Timeout | undefined

function writeRecord(path: string, record: Record<string, string | number>): void {
  writeFileSync(path, `${JSON.stringify(record)}\n`, { flag: 'wx', mode: 0o600 })
}

function finish(): void {
  if (finished) return
  finished = true
  if (responseTimer) clearTimeout(responseTimer)
  writeRecord(doneFile, { runId, pid: process.pid, hrtimeNs: process.hrtime.bigint().toString() })
}

function fail(message: string): void {
  if (finished) return
  finished = true
  writeRecord(errorFile, {
    runId,
    pid: process.pid,
    hrtimeNs: process.hrtime.bigint().toString(),
    message
  })
}

process.stdin.setRawMode(true)
process.stdin.resume()
process.stdin.on('data', (chunk: Buffer) => {
  response = (response + chunk.toString('latin1')).slice(-256)
  if (response.includes('\u001b[0n')) finish()
})

process.on('SIGUSR1', () => {
  if (started || finished) return
  started = true
  responseTimer = setTimeout(() => fail('terminal did not answer the DSR probe'), responseTimeoutMs)
  process.stdout.write(fixture)
  process.stdout.write('\u001b[5n')
})

process.on('SIGTERM', () => process.exit(0))
process.on('SIGHUP', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))

const stopTimer = setInterval(() => {
  if (existsSync(stopFile)) process.exit(0)
}, 100)
stopTimer.unref()

writeRecord(readyFile, {
  runId,
  pid: process.pid,
  hrtimeNs: process.hrtime.bigint().toString(),
  fixtureBytes: fixture.length
})

setInterval(() => undefined, 60_000)
