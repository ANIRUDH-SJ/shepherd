#!/usr/bin/env node
'use strict'
// Shepherd — a tiny CLI client for the Shepherd socket API. Run this from inside
// a terminal pane, where the app injects socket and workspace identity.
const net = require('net')
const fs = require('fs')
const { mapAgentEvent } = require('./agent-events')
const { setupIntegration } = require('./integrations')

const configuredSocketPath = process.env.SHEPHERD_SOCKET_PATH || process.env.CMUX_SOCKET_PATH
const socketPath = configuredSocketPath || '/tmp/shepherd.sock'
const workspaceId = process.env.SHEPHERD_WORKSPACE_ID || process.env.CMUX_WORKSPACE_ID
const surfaceId = process.env.SHEPHERD_SURFACE_ID || process.env.CMUX_SURFACE_ID
const argv = process.argv.slice(2)
let method = argv[0]
let hookRequest = null

function printWelcome() {
  const reset = '\x1b[0m'
  const bold = '\x1b[1m'
  const subdued = '\x1b[2m'
  const cyan = '\x1b[38;2;100;210;255m'
  const sky = '\x1b[38;2;0;145;255m'
  const indigo = '\x1b[38;2;94;92;230m'
  const violet = '\x1b[38;2;124;58;237m'
  const shortcuts = [
    ['Ctrl+Shift+N', 'New workspace'],
    ['Ctrl+Shift+T', 'New terminal tab'],
    ['Ctrl+Shift+P', 'Command palette'],
    ['Ctrl+Shift+B', 'Toggle sidebar'],
    ['Ctrl+Shift+D', 'Split right'],
    ['Ctrl+Shift+E', 'Split down'],
    ['Ctrl+Shift+F', 'Find in terminal'],
    ['Ctrl+Shift+U', 'Jump to latest unread']
  ]

  console.log('')
  console.log(`${cyan}      ›${sky}_${reset}      ${sky}s${indigo}he${violet}pherd${reset}`)
  console.log(`              ${subdued}the terminal workspace for coding agents${reset}`)
  console.log('')
  console.log(`  ${bold}Shortcuts${reset}`)
  console.log('')
  for (const [shortcut, label] of shortcuts) {
    console.log(`  ${bold}${shortcut.padEnd(18)}${reset}${subdued}${label}${reset}`)
  }
  console.log('')
  console.log(
    `  ${bold}Docs${reset}${subdued}              https://github.com/ANIRUDH-SJ/shepherd${reset}`
  )
  console.log('')
  console.log(
    `  ${subdued}Run ${reset}${bold}shepherd --help${reset}${subdued} for CLI commands.${reset}`
  )
  console.log('')
}

if (!method || method === '-h' || method === '--help') {
  console.log(`shepherd — drive Shepherd from a terminal

Usage:
  shepherd welcome                        show the first-launch guide again
  shepherd set-status <text>              set this workspace's sidebar subtitle
  shepherd notify --title T --body B      flash this workspace + a desktop toast
  shepherd log <text>                     append a status line
  shepherd list-workspaces                list open workspaces
  shepherd new-workspace [--name N]       create a workspace
  shepherd new-worktree --repo R --path P (--branch B | --new-branch B)
                                      create a Git worktree workspace
  shepherd rename-workspace --workspace W --name N
                                      rename a workspace (empty N resets its name)
  shepherd select-workspace --workspace W switch to a workspace
  shepherd close-workspace --workspace W  close a workspace
  shepherd new-split [right|down]         split the active pane
  shepherd send-text <text>               type text into the active terminal
  shepherd send-key <enter|tab|up|down|…> send a key to the active terminal
  shepherd report-usage --input-tokens N --output-tokens N --accuracy exact|estimated
                                      add trustworthy usage to this workspace
  shepherd agent-report --provider P --state S [--activity A | --reason R]
                                      report this terminal agent's semantic state
  shepherd agent-clear <agent-id>         remove an agent record
  shepherd list-agents [query flags]      list and summarize matching agents
  shepherd agent-snapshot [query flags]   snapshot workspaces and matching agents
  shepherd watch-agents [query flags]     stream a snapshot followed by agent updates
  shepherd agent-schema                   print the machine-readable agent contract
  shepherd agent-capabilities [provider]  discover protocol and adapter support
  shepherd focus-agent <agent-id>         focus an agent's exact terminal
  shepherd inspect-agent <agent-id>       read bounded terminal/process context
  shepherd wait-agent <agent-id> --state S [--timeout-ms N]
                                      wait for semantic state blocked/done/etc.
  shepherd ping                           check the app is reachable
  shepherd capabilities                   list supported socket methods
  shepherd identify                       show this pane's + the active workspace
  shepherd integrations setup [provider]  install lifecycle reporting for all providers
  shepherd hooks setup                    legacy alias for Claude Code integration setup

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

Worktree flags:
  --repo PATH            required absolute Git repository path
  --path PATH            required absolute path for the new worktree
  --branch REF           attach an existing branch
  --new-branch REF       create and attach a new branch
  --start-point REF      optional start for --new-branch (default HEAD)
  --name TEXT            optional workspace display name (default branch)

Global: --workspace <id|name>   target a specific workspace (default: this pane's)

Inside a Shepherd pane, SHEPHERD_WORKSPACE_ID and SHEPHERD_SOCKET_PATH are set
for you. The previous CMUX_* names remain accepted for compatibility.`)
  process.exit(method ? 0 : 1)
}

// Welcome is intentionally local: it works before the app socket is available
// and can be replayed from any ordinary shell.
if (method === 'welcome') {
  printWelcome()
  process.exit(0)
}

// Hook commands receive one provider event as JSON on stdin. Global hooks should
// silently do nothing when the agent is not running inside a Shepherd terminal.
if (method === 'agent-hook') {
  if (!configuredSocketPath || !surfaceId) process.exit(0)
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
    console.error(
      legacy ? 'usage: shepherd hooks setup' : 'usage: shepherd integrations setup [provider]'
    )
    process.exit(1)
  }
  const requested = legacy ? 'claude' : argv[2] || 'all'
  const targets = requested === 'all' ? ['codex', 'claude', 'opencode'] : [requested]
  let failed = false
  for (const target of targets) {
    const result = setupIntegration(target)
    if (!result.ok) {
      console.error(`shepherd: ${result.error}`)
      failed = true
    } else {
      console.log(
        `shepherd: ${result.changed ? 'installed' : 'already installed'} ${target} integration -> ${result.file}`
      )
    }
  }
  if (!failed && targets.includes('codex')) {
    console.log('shepherd: open /hooks in Codex and trust the new lifecycle hooks before use.')
  }
  process.exit(failed ? 1 : 0)
}

const watchAgents = method === 'watch-agents'
if (watchAgents) method = 'subscribe-agents'

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
if (workspaceId && !params.workspace) {
  params.workspace = workspaceId
}
if (surfaceId && !params.surfaceId) {
  params.surfaceId = surfaceId
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
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl)
    buf = buf.slice(nl + 1)
    if (!line.trim()) continue
    let res
    try {
      res = JSON.parse(line)
    } catch {
      if (!watchAgents) {
        conn.end()
        process.exit(0)
      }
      continue
    }
    if (res.error) {
      if (hookRequest) process.exit(0)
      console.error('shepherd: error:', res.error)
      conn.end()
      process.exit(1)
    }
    if (watchAgents) {
      console.log(JSON.stringify(res))
      continue
    }
    // Print any query result (list-workspaces / capabilities / identify);
    // action replies are just {ok:true}, which we don't echo.
    if (res.result && typeof res.result === 'object' && !res.result.ok) {
      console.log(JSON.stringify(res.result, null, 2))
    }
    conn.end()
    process.exit(0)
  }
})

conn.on('error', (e) => {
  if (hookRequest) process.exit(0)
  console.error(
    `shepherd: cannot reach Shepherd at ${socketPath} (is the app running?) — ${e.message}`
  )
  process.exit(1)
})
