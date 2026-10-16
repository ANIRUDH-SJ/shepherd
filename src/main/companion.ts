import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type ServerResponse, type IncomingMessage, type Server } from 'node:http'
import { networkInterfaces } from 'node:os'
import {
  companionSnapshot,
  privateIPv4,
  type CompanionSnapshot,
  type CompanionStatus,
  type CompanionNetwork
} from '../shared/companion'
import type { WorkspacesSync } from '../shared/ipc'
import { COMPANION_CSS, COMPANION_HTML, COMPANION_JS } from './companionPage'

let server: Server | null = null
let starting: Promise<CompanionStatus> | null = null
let address: string | null = null
let port: number | null = null
let accessCode: string | null = null
let snapshot: CompanionSnapshot = { version: 1, activeWorkspaceId: null, workspaces: [] }

export function updateCompanionWorkspaces(sync: WorkspacesSync): void {
  snapshot = companionSnapshot(sync)
}

export function companionStatus(): CompanionStatus {
  return {
    running: server !== null,
    url: server && address && port ? `http://${address}:${port}` : null,
    accessCode: server ? accessCode : null
  }
}

export function companionNetworks(): CompanionNetwork[] {
  const networks: CompanionNetwork[] = []
  let detected: ReturnType<typeof networkInterfaces>
  try {
    detected = networkInterfaces()
  } catch {
    return []
  }
  for (const [label, interfaces] of Object.entries(detected)) {
    for (const candidate of interfaces ?? []) {
      if (candidate.family === 'IPv4' && !candidate.internal && privateIPv4(candidate.address))
        networks.push({ label, address: candidate.address })
    }
  }
  return networks
}

export function chooseCompanionAddress(): string | null {
  return companionNetworks()[0]?.address ?? null
}

function responseHeaders(res: ServerResponse, contentType: string): void {
  res.setHeader('Content-Type', contentType)
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
  )
}

function authorized(req: IncomingMessage, expected: string): boolean {
  const supplied = req.headers.authorization
  if (typeof supplied !== 'string' || !supplied.startsWith('Bearer ')) return false
  const candidate = Buffer.from(supplied.slice(7))
  const secret = Buffer.from(expected)
  return candidate.length === secret.length && timingSafeEqual(candidate, secret)
}

function respond(req: IncomingMessage, res: ServerResponse, host: string, secret: string): void {
  const expectedHost = host
  if (
    req.headers.host !== expectedHost ||
    (req.headers.origin && req.headers.origin !== `http://${expectedHost}`)
  ) {
    res.writeHead(403).end()
    return
  }
  if (req.method !== 'GET') {
    res.writeHead(405, { Allow: 'GET' }).end()
    return
  }
  const path = req.url?.split('?')[0]
  if (path === '/api/status') {
    responseHeaders(res, 'application/json; charset=utf-8')
    if (!authorized(req, secret)) {
      res.writeHead(401).end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }
    res.writeHead(200).end(JSON.stringify(snapshot))
    return
  }
  const asset =
    path === '/'
      ? [COMPANION_HTML, 'text/html; charset=utf-8']
      : path === '/companion.css'
        ? [COMPANION_CSS, 'text/css; charset=utf-8']
        : path === '/companion.js'
          ? [COMPANION_JS, 'text/javascript; charset=utf-8']
          : null
  if (!asset) {
    res.writeHead(404).end()
    return
  }
  responseHeaders(res, asset[1])
  res.writeHead(200).end(asset[0])
}

/** The optional test address is never exposed over IPC. Production requires a private LAN IPv4. */
export async function startCompanionServer(
  bindAddress = chooseCompanionAddress()
): Promise<CompanionStatus> {
  if (server) return companionStatus()
  if (starting) return starting
  starting = startOnAddress(bindAddress)
  try {
    return await starting
  } finally {
    starting = null
  }
}

async function startOnAddress(bindAddress: string | null): Promise<CompanionStatus> {
  if (!bindAddress) throw new Error('No private IPv4 network is available')
  const secret = randomBytes(9).toString('base64url')
  const next = createServer((req, res) =>
    respond(req, res, `${bindAddress}:${(next.address() as { port: number }).port}`, secret)
  )
  next.maxConnections = 16
  next.headersTimeout = 5_000
  next.requestTimeout = 5_000
  next.keepAliveTimeout = 1_000
  try {
    await new Promise<void>((resolve, reject) => {
      next.once('error', reject)
      next.listen(0, bindAddress, () => {
        next.off('error', reject)
        resolve()
      })
    })
  } catch (error) {
    if (next.listening) next.close()
    throw error
  }
  server = next
  address = bindAddress
  port = (next.address() as { port: number }).port
  accessCode = secret
  return companionStatus()
}

export async function stopCompanionServer(): Promise<CompanionStatus> {
  if (starting) await starting.catch(() => undefined)
  const current = server
  server = null
  address = null
  port = null
  accessCode = null
  if (current) await new Promise<void>((resolve) => current.close(() => resolve()))
  return companionStatus()
}
