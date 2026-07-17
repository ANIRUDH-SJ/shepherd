#!/usr/bin/env node
'use strict'
// cmux — a tiny CLI client for the cmux-linux socket API. Run this from inside a
// cmux-linux terminal pane (where CMUX_SOCKET_PATH + CMUX_WORKSPACE_ID are set) to
// drive the sidebar. See textbook/11 and FEATURES.md Part 2.
const net = require('net')

const socketPath = process.env.CMUX_SOCKET_PATH || '/tmp/cmux-linux.sock'
const argv = process.argv.slice(2)
const method = argv[0]

if (!method || method === '-h' || method === '--help') {
  console.log(`cmux — drive cmux-linux from a terminal

Usage:
  cmux set-status <text>              set this workspace's sidebar subtitle
  cmux notify --title T --body B      flash this workspace + a desktop toast
  cmux log <text>                     append a status line
  cmux list-workspaces                list open workspaces
  cmux new-workspace [--name N]       create a workspace
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
  cmux list-agents                    list agents (current workspace inside a pane)
  cmux focus-agent <agent-id>         focus an agent's exact terminal
  cmux wait-agent <agent-id> --state S [--timeout-ms N]
                                      wait for semantic state blocked/done/etc.
  cmux ping                           check the app is reachable
  cmux capabilities                   list supported socket methods
  cmux identify                       show this pane's + the active workspace
  cmux hooks setup                    install a Claude Code notify hook

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
  --ttl-ms N             optional state expiry from 1 ms to 24 hours

Global: --workspace <id|name>   target a specific workspace (default: this pane's)

Inside a cmux-linux pane, CMUX_WORKSPACE_ID and CMUX_SOCKET_PATH are set for you.`)
  process.exit(method ? 0 : 1)
}

// `cmux hooks setup` is a LOCAL command (it edits ~/.claude/settings.json); it does
// not talk to the socket, so handle it before connecting.
if (method === 'hooks') {
  if (argv[1] !== 'setup') {
    console.error('usage: cmux hooks setup')
    process.exit(1)
  }
  const os = require('os')
  const fs = require('fs')
  const path = require('path')
  const settingsPath =
    process.env.CLAUDE_SETTINGS_PATH || path.join(os.homedir(), '.claude', 'settings.json')

  let settings = {}
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  } catch {
    /* no settings file yet — start fresh */
  }
  settings.hooks = settings.hooks || {}
  const list = Array.isArray(settings.hooks.Notification) ? settings.hooks.Notification : []

  // Idempotent: don't add a second cmux hook if one is already present.
  const already = list.some(
    (g) =>
      g &&
      Array.isArray(g.hooks) &&
      g.hooks.some((h) => h && typeof h.command === 'string' && h.command.includes('cmux notify'))
  )
  if (already) {
    console.log(`cmux: Claude Code notify hook already installed at ${settingsPath}`)
    process.exit(0)
  }

  list.push({
    hooks: [{ type: 'command', command: 'cmux notify --title Claude --body "needs your attention"' }]
  })
  settings.hooks.Notification = list
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
  console.log(`cmux: installed Claude Code notify hook -> ${settingsPath}`)
  console.log('      Claude Code will now flash its cmux-linux workspace when it needs you.')
  process.exit(0)
}

// Parse --flags and trailing positional text.
const params = {}
const positional = []
for (let i = 1; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) {
    // CLI flags are kebab-case; the JSON protocol uses JavaScript-style camelCase.
    const key = a.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    params[key] = argv[++i]
  }
  else positional.push(a)
}
if (method === 'focus-agent' || method === 'agent-clear') {
  if (positional[0] && !params.agentId) params.agentId = positional[0]
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
  console.error(`cmux: cannot reach cmux-linux at ${socketPath} (is the app running?) — ${e.message}`)
  process.exit(1)
})
