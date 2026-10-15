import { useEffect, useState } from 'react'
import type { AgentAccessPolicy } from '../../../shared/agentAccess'

export default function AgentAccessSettings(): React.JSX.Element {
  const [policy, setPolicy] = useState<AgentAccessPolicy | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void window.api.agents.getAccessPolicy().then(
      (loaded) => {
        if (!active) return
        setPolicy(loaded)
        setLoading(false)
      },
      () => {
        if (!active) return
        setError('Could not load local socket permissions.')
        setLoading(false)
      }
    )
    return () => {
      active = false
    }
  }, [])

  const save = (next: AgentAccessPolicy): void => {
    if (saving) return
    setSaving(true)
    setError('')
    void window.api.agents.setAccessPolicy(next).then(
      (saved) => {
        setPolicy(saved)
        setSaving(false)
      },
      () => {
        setError('Could not save socket permissions. Nothing changed.')
        setSaving(false)
      }
    )
  }

  if (loading)
    return (
      <p className="settings-notice" role="status">
        Loading agent permissions…
      </p>
    )
  if (!policy)
    return (
      <p className="settings-form-error" role="alert">
        {error}
      </p>
    )

  return (
    <div className="settings-group-list">
      <section className="settings-group">
        <div className="settings-setting-head">
          <span>
            <strong>Agent adapters</strong>
            <small>
              Lifecycle hooks report Codex and Claude Code; a managed plugin reports OpenCode. Other
              tools may use the local CLI/socket.
            </small>
          </span>
        </div>
        <p className="settings-notice">
          Adapters report state, activity, and an optional short message. Automatic discovery reads
          foreground process names. Shepherd does not verify the provider name supplied by a local
          socket client.
        </p>
      </section>
      <section className="settings-group">
        <div className="settings-setting-head">
          <span>
            <strong>Local socket permissions</strong>
            <small>
              These controls apply to every local socket client, including agent integrations and
              the Shepherd CLI. They do not affect typing directly in a terminal.
            </small>
          </span>
        </div>
        <label className="notification-policy-field">
          <input
            type="checkbox"
            checked={policy.terminalInspection}
            disabled={saving}
            onChange={(event) => save({ ...policy, terminalInspection: event.target.checked })}
          />
          Allow clients to inspect bounded terminal output and process context
        </label>
        <label className="notification-policy-field">
          <input
            type="checkbox"
            checked={policy.terminalInput}
            disabled={saving}
            onChange={(event) => save({ ...policy, terminalInput: event.target.checked })}
          />
          Allow clients to send text and keys to a terminal
        </label>
        <p className="settings-notice">
          Agent status reporting and read-only state queries remain available. Use{' '}
          <code>shepherd agent-permissions</code> to inspect the active policy.
        </p>
        {error && (
          <p className="settings-form-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  )
}
