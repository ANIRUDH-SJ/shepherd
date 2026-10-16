import { useEffect, useState } from 'react'
import type { AuditEntry } from '../../../shared/provenance'

interface Props {
  snapshot: unknown
}

export default function SessionHistorySettings({ snapshot }: Props): React.JSX.Element {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    void window.api.provenance.list().then(
      (history) => {
        if (active) {
          setEntries(history)
          setLoading(false)
        }
      },
      () => {
        if (active) {
          setMessage('Activity history could not be loaded.')
          setLoading(false)
        }
      }
    )
    return () => {
      active = false
    }
  }, [])

  const exportSession = async (): Promise<void> => {
    setExporting(true)
    setMessage('')
    try {
      window.api.session.saveSync(snapshot)
      const result = await window.api.session.export(snapshot)
      if (result) {
        setMessage('Session exported.')
        setEntries(await window.api.provenance.list())
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Session export failed.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="settings-group-list">
      <section className="settings-group">
        <div className="settings-setting-head">
          <span>
            <strong>Export this session</strong>
            <small>
              Saves workspace layouts, linked directories, previews, the bounded inbox, and activity
              history as JSON. It does not include terminal output or running processes.
            </small>
          </span>
          <button
            className="settings-action"
            type="button"
            disabled={exporting}
            onClick={() => void exportSession()}
          >
            {exporting ? 'Exporting…' : 'Export…'}
          </button>
        </div>
        <p className="settings-hint">
          Exported files may contain local paths and notification text. Keep them private and share
          only after reviewing their contents.
        </p>
        {message && (
          <p className="settings-hint" role="status">
            {message}
          </p>
        )}
      </section>
      <section className="settings-group">
        <div className="settings-setting-head">
          <span>
            <strong>Recent activity</strong>
            <small>
              Up to 500 local events. Records workspace, repository, and tab changes only.
            </small>
          </span>
          <span className="settings-value">{entries.length}</span>
        </div>
        {loading ? (
          <p className="settings-hint">Loading activity…</p>
        ) : entries.length === 0 ? (
          <p className="settings-hint">No activity recorded yet.</p>
        ) : (
          <ol className="session-history-list">
            {entries
              .slice(-20)
              .reverse()
              .map((entry) => (
                <li key={entry.id}>
                  <span>
                    {entry.detail}
                    {entry.workspaceName ? ` · ${entry.workspaceName}` : ''}
                  </span>
                  <time dateTime={new Date(entry.at).toISOString()}>
                    {new Date(entry.at).toLocaleString()}
                  </time>
                </li>
              ))}
          </ol>
        )}
      </section>
    </div>
  )
}
