#!/usr/bin/env node
'use strict'
// cmux — a tiny CLI client for the cmux-linux socket API. Run this from inside a
// cmux-linux terminal pane (where CMUX_SOCKET_PATH + CMUX_WORKSPACE_ID are set) to
// drive the sidebar. See textbook/11 and FEATURES.md Part 2.
const net = require('net')
const fs = require('fs')
const { mapAgentEvent } = require('./agent-events')
const { setupIntegration } = require('./integrations')

const socketPath = process.env.CMUX_SOCKET_PATH || '/tmp/cmux-linux.sock'
const argv = process.argv.slice(2)
let method = argv[0]
let hookRequest = null

if (!method || method === '-h' || method === '--help') {
  console.log(`cmux — drive cmux-linux from a terminal

Usage:
  cmux set-status <text>              set this workspace's sidebar subtitle
  cmux notify --title T --body B      flash this workspace + a desktop toast
  cmux log <text>                     append a status line
  cmux list-workspaces                list open workspaces
  cmux new-workspace [--name N]       create a workspace
  cmux rename-workspace --workspace W --name N
                                      rename a workspace (empty N resets its name)
  cmux select-workspace --workspace W switch to a workspace
  cmux close-workspace --workspace W  close a workspace
  cmux new-split [right|down]         split the active pane
  cmux send-text <text>               type text into the active terminal
  cmux send-key <enter|tab|up|down|…> send a key to the active terminal
  cmux report-usage --input-tokens N --output-tokens N --accuracy exact|estimated
                                      add trustworthy usage to this workspace
  cmux agent-report --provider P --state S [--activity A | --reason R]
                                      report this terminal agent's semantic state
  cmux agent-clear <agent-id>         remove an agent record
  cmux list-agents [query flags]      list and summarize matching agents
  cmux agent-snapshot [query flags]   snapshot workspaces and matching agents
  cmux agent-schema                   print the machine-readable agent contract
  cmux agent-capabilities [provider]  discover protocol and adapter support
  cmux focus-agent <agent-id>         focus an agent's exact terminal
  cmux inspect-agent <agent-id>       read bounded terminal/process context
  cmux wait-agent <agent-id> --state S [--timeout-ms N]
                                      wait for semantic state blocked/done/etc.
  cmux ping                           check the app is reachable
  cmux capabilities                   list supported socket methods
  cmux identify                       show this pane's + the active workspace
  cmux integrations setup [provider]  install lifecycle reporting for all providers
  cmux hooks setup                    legacy alias for Claude Code integration setup

Usage flags:
  --input-tokens N       required non-negative integer
  --output-tokens N      required non-negative integer
  --accuracy A           required: exact or estimated
  --cached-tokens N      optional cache-read tokens
  --cost-usd N           optional provider-reported cost; never calculated here
  --model NAME           optional model provenance
  --provider NAME        optional provider provenance

Agent report flags:
  --provider P           required: codex, claude, opencode, or custom
  --state S              required: working, blocked, done, idle, or unknown
  --activity A           optional working detail, including web-search or testing
  --reason R             optional blocked reason, including approval or user-input
  --message TEXT         optional short display detail
  --source ID            reporter authority (defaults to cli:<provider>)
  --agent-id ID          stable identity (defaults from source + terminal)
  --revision N           optional monotonic sequence number
  --stale-after-ms N     optional transition to unknown before expiry
  --ttl-ms N             optional state expiry from 1 ms to 24 hours

Agent query flags:
  --provider P[,P]       filter by one or more providers
  --state S[,S]          filter by one or more semantic states
  --activity A[,A]       filter by working activity
  --reason R[,R]         filter by blocked reason
  --source ID            exact reporter-source filter
  --session-id ID        exact provider-session filter
  --surface-id ID        exact terminal-surface filter
  --updated-after MS     only reports newer than this ingestion timestamp
  --limit N              newest results to return (default 200, maximum 1000)

Agent inspection flags:
  --lines N              recent plain-text lines (default 50, maximum 500)
  --max-bytes N          output bytes (default 16384, maximum 65536)

Global: --workspace <id|name>   target a specific workspace (default: this pane's)

Inside a cmux-linux pane, CMUX_WORKSPACE_ID and CMUX_SOCKET_PATH are set for you.`)
  process.exit(method ? 0 : 1)
}

// Hook commands receive one provider event as JSON on stdin. Global hooks should
// silently do nothing when the agent is not running inside a cmux-linux terminal.
if (method === 'agent-hook') {
  if (!process.env.CMUX_SOCKET_PATH || !process.env.CMUX_SURFACE_ID) process.exit(0)
  const provider = argv[1]
  let event
  try {
    event = JSON.parse(fs.readFileSync(0, 'utf8'))
  } catch {
    process.exit(0)
  }
  hookRequest = mapAgentEvent(provider, event)
  if (!hookRequest) process.exit(0)
  method = hookRequest.method
}

// Integration setup edits provider configuration locally and never opens the app socket.
if (method === 'hooks' || method === 'integrations') {
  const legacy = method === 'hooks'
  if (argv[1] !== 'setup') {
    console.error(legacy ? 'usage: cmux hooks setup' : 'usage: cmux integrations setup [provider]')
    process.exit(1)
  }
  const requested = legacy ? 'claude' : argv[2] || 'all'
  const targets = requested === 'all' ? ['codex', 'claude', 'opencode'] : [requested]
  let failed = false
  for (const target of targets) {
    const result = setupIntegration(target)
    if (!result.ok) {
      console.error(`cmux: ${result.error}`)
      failed = true
    } else {
      console.log(
        `cmux: ${result.changed ? 'installed' : 'already installed'} ${target} integration -> ${result.file}`
      )
    }
  }
  if (!failed && targets.includes('codex')) {
    console.log('cmux: open /hooks in Codex and trust the new lifecycle hooks before use.')
  }
  process.exit(failed ? 1 : 0)
}

// Parse --flags and trailing positional text.
const params = hookRequest ? { ...hookRequest.params } : {}
const positional = []
for (let i = hookRequest ? argv.length : 1; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) {
    // CLI flags are kebab-case; the JSON protocol uses JavaScript-style camelCase.
    const key = a.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    params[key] = argv[++i]
  } else positional.push(a)
}
if (method === 'focus-agent' || method === 'agent-clear' || method === 'inspect-agent') {
  if (positional[0] && !params.agentId) params.agentId = positional[0]
} else if (method === 'agent-capabilities') {
  if (positional[0] && !params.provider) params.provider = positional[0]
} else if (method === 'wait-agent') {
  if (positional[0] && !params.agentId) params.agentId = positional[0]
  if (positional[1] && !params.state) params.state = positional[1]
} else if (positional.length) {
  const text = positional.join(' ')
  params.text = text
  if (method === 'notify') {
    if (!params.body) params.body = text
  } else if (!params.status) {
    params.status = text
  }
}
if (process.env.CMUX_WORKSPACE_ID && !params.workspace) {
  params.workspace = process.env.CMUX_WORKSPACE_ID
}
if (process.env.CMUX_SURFACE_ID && !params.surfaceId) {
  params.surfaceId = process.env.CMUX_SURFACE_ID
}
if (method === 'agent-report' && !params.source) {
  const provider = params.provider || params.agent
  if (provider) params.source = `cli:${provider}`
}

const conn = net.createConnection(socketPath, () => {
  conn.write(JSON.stringify({ id: 1, method, params }) + '\n')
})

let buf = ''
conn.on('data', (d) => {
  buf += d.toString()
  const nl = buf.indexOf('\n')
  if (nl < 0) return
  try {
    const res = JSON.parse(buf.slice(0, nl))
    if (res.error) {
      if (hookRequest) process.exit(0)
      console.error('cmux: error:', res.error)
      conn.end()
      process.exit(1)
    }
    // Print any query result (list-workspaces / capabilities / identify);
    // action replies are just {ok:true}, which we don't echo.
    if (res.result && typeof res.result === 'object' && !res.result.ok) {
      console.log(JSON.stringify(res.result, null, 2))
    }
  } catch {
    /* ignore malformed reply */
  }
  conn.end()
  process.exit(0)
})

conn.on('error', (e) => {
  if (hookRequest) process.exit(0)
  console.error(
    `cmux: cannot reach cmux-linux at ${socketPath} (is the app running?) — ${e.message}`
  )
  process.exit(1)
})
