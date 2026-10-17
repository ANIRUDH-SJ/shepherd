import {
  companionStatus,
  startCompanionServer,
  stopCompanionServer,
  updateCompanionWorkspaces
} from './companion'
import { request } from 'node:http'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

async function main(): Promise<void> {
  assert(!companionStatus().running, 'starts disabled')
  updateCompanionWorkspaces({
    workspaces: [{ id: 'a', name: 'Task' }],
    activeWorkspaceId: 'a',
    agents: []
  })
  const first = await startCompanionServer('127.0.0.1')
  assert(
    first.running && !!first.url && !!first.accessCode,
    'explicit start creates an address and code'
  )
  const page = await fetch(first.url!)
  assert(
    page.status === 200 && (await page.text()).includes('Workspace companion'),
    'serves the phone page'
  )
  const denied = await fetch(`${first.url}/api/status`)
  assert(denied.status === 401, 'denies status without a code')
  const wrong = await fetch(`${first.url}/api/status`, {
    headers: { Authorization: 'Bearer wrong' }
  })
  assert(wrong.status === 401, 'denies incorrect code')
  const spoofedStatus = await new Promise<number>((resolve, reject) => {
    const req = request(
      `${first.url}/api/status`,
      {
        headers: { Host: 'elsewhere.test', Authorization: `Bearer ${first.accessCode}` }
      },
      (response) => {
        response.resume()
        resolve(response.statusCode ?? 0)
      }
    )
    req.once('error', reject)
    req.end()
  })
  assert(spoofedStatus === 403, 'rejects a mismatched host')
  const allowed = await fetch(`${first.url}/api/status`, {
    headers: { Authorization: `Bearer ${first.accessCode}` }
  })
  const data = (await allowed.json()) as { workspaces: Array<{ name: string }> }
  assert(
    allowed.status === 200 && data.workspaces[0].name === 'Task',
    'returns only authorized status'
  )
  await stopCompanionServer()
  assert(
    !companionStatus().running && companionStatus().accessCode === null,
    'stop clears the code'
  )
  const second = await startCompanionServer('127.0.0.1')
  assert(second.accessCode !== first.accessCode, 'restart rotates the access code')
  await stopCompanionServer()
  if (failures) process.exitCode = 1
}

void main()
