import { useEffect, useState } from 'react'
import {
  minuteFromTimeInput,
  timeInputFromMinute,
  type DesktopNotificationMode,
  type NotificationPolicy,
  type WorkspaceNotificationRoute
} from '../../../shared/notificationPolicy'
import { workspaceIdentity } from '../sidebarView'
import type { Workspace } from '../state/appReducer'

interface Props {
  workspaces: Workspace[]
}

export default function NotificationRoutingSettings({ workspaces }: Props): React.JSX.Element {
  const [policy, setPolicy] = useState<NotificationPolicy | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [quietEnabled, setQuietEnabled] = useState(false)
  const [quietStart, setQuietStart] = useState('22:00')
  const [quietEnd, setQuietEnd] = useState('08:00')

  useEffect(() => {
    let active = true
    void window.api.notifications.getPolicy().then(
      (loaded) => {
        if (!active) return
        setPolicy(loaded)
        setQuietEnabled(loaded.quietHours.enabled)
        setQuietStart(timeInputFromMinute(loaded.quietHours.startMinute))
        setQuietEnd(timeInputFromMinute(loaded.quietHours.endMinute))
        setLoading(false)
      },
      () => {
        if (!active) return
        setError('Could not load notification settings.')
        setLoading(false)
      }
    )
    return () => {
      active = false
    }
  }, [])

  const save = (next: NotificationPolicy): void => {
    if (saving) return
    setSaving(true)
    setError('')
    void window.api.notifications.setPolicy(next).then(
      (saved) => {
        setPolicy(saved)
        setSaving(false)
      },
      () => {
        setError('Could not save notification settings. Nothing changed.')
        setSaving(false)
      }
    )
  }

  if (loading)
    return (
      <p className="settings-notice" role="status">
        Loading notification settings…
      </p>
    )
  if (!policy)
    return (
      <p className="settings-form-error" role="alert">
        {error}
      </p>
    )

  const saveQuietHours = (): void => {
    const startMinute = minuteFromTimeInput(quietStart)
    const endMinute = minuteFromTimeInput(quietEnd)
    if (startMinute === null || endMinute === null) {
      setError('Choose valid start and end times.')
      return
    }
    save({
      ...policy,
      quietHours: { enabled: quietEnabled, startMinute, endMinute }
    })
  }

  return (
    <div className="settings-group-list">
      <section className="settings-group">
        <div className="settings-setting-head">
          <span>
            <strong>Desktop alerts</strong>
            <small>The in-app inbox always keeps notifications, regardless of this setting.</small>
          </span>
        </div>
        <label className="notification-policy-field">
          Show desktop notifications
          <select
            value={policy.desktopMode}
            disabled={saving}
            onChange={(event) =>
              save({ ...policy, desktopMode: event.target.value as DesktopNotificationMode })
            }
          >
            <option value="all">For every event</option>
            <option value="background">Only when the app or workspace is in the background</option>
            <option value="off">Never</option>
          </select>
        </label>
      </section>

      <section className="settings-group">
        <div className="settings-setting-head">
          <span>
            <strong>Quiet hours</strong>
            <small>
              Uses your computer’s local time. During quiet hours, only the inbox updates.
            </small>
          </span>
        </div>
        <div className="notification-quiet-controls">
          <label className="notification-policy-check">
            <input
              type="checkbox"
              checked={quietEnabled}
              disabled={saving}
              onChange={(event) => setQuietEnabled(event.target.checked)}
            />
            Enable quiet hours
          </label>
          <label>
            From
            <input
              type="time"
              value={quietStart}
              disabled={saving}
              onChange={(event) => setQuietStart(event.target.value)}
            />
          </label>
          <label>
            Until
            <input
              type="time"
              value={quietEnd}
              disabled={saving}
              onChange={(event) => setQuietEnd(event.target.value)}
            />
          </label>
          <button type="button" disabled={saving} onClick={saveQuietHours}>
            Save schedule
          </button>
        </div>
        <p className="settings-hint">
          Overnight ranges work automatically. Matching times mean all day.
        </p>
      </section>

      <section className="settings-group">
        <div className="settings-setting-head">
          <span>
            <strong>Workspace routing</strong>
            <small>Override desktop alerts for an open workspace. Quiet hours still win.</small>
          </span>
        </div>
        <div className="notification-workspace-routes">
          {workspaces.map((workspace, index) => (
            <label key={workspace.id}>
              <span>{workspaceIdentity(workspace, index).primary}</span>
              <select
                value={policy.workspaceRoutes[workspace.id] ?? 'inherit'}
                disabled={saving}
                aria-label={`Desktop alerts for ${workspaceIdentity(workspace, index).primary}`}
                onChange={(event) => {
                  const nextRoutes = { ...policy.workspaceRoutes }
                  if (event.target.value === 'inherit') delete nextRoutes[workspace.id]
                  else nextRoutes[workspace.id] = event.target.value as WorkspaceNotificationRoute
                  save({ ...policy, workspaceRoutes: nextRoutes })
                }}
              >
                <option value="inherit">Use global setting</option>
                <option value="desktop">Always show desktop alert</option>
                <option value="inbox-only">Inbox only</option>
              </select>
            </label>
          ))}
        </div>
      </section>
      {error && (
        <p className="settings-form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
