import { useEffect, useState } from 'react'
import type { CompanionNetwork, CompanionStatus } from '../../../shared/companion'

export default function CompanionSettings(): React.JSX.Element {
  const [status, setStatus] = useState<CompanionStatus | null>(null)
  const [networks, setNetworks] = useState<CompanionNetwork[]>([])
  const [selectedAddress, setSelectedAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let active = true
    void Promise.all([window.api.companion.status(), window.api.companion.networks()]).then(
      ([next, available]) => {
        if (!active) return
        setStatus(next)
        setNetworks(available)
        setSelectedAddress(available[0]?.address ?? '')
      },
      () => {
        if (active) setError('Could not read companion status.')
      }
    )
    return () => {
      active = false
    }
  }, [])

  const change = (running: boolean): void => {
    if (busy) return
    setBusy(true)
    setError('')
    setCopied(false)
    const operation = running
      ? window.api.companion.start(selectedAddress)
      : window.api.companion.stop()
    void operation.then(
      (next) => {
        setStatus(next)
        setBusy(false)
      },
      (cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Could not change companion status.')
        setBusy(false)
      }
    )
  }

  return (
    <div className="settings-group-list">
      <section className="settings-group">
        <div className="settings-setting-head">
          <span>
            <strong>Phone and local-network companion</strong>
            <small>
              A read-only workspace overview for another device on the same private IPv4 network.
            </small>
          </span>
          <span className="settings-value">{status?.running ? 'On' : 'Off'}</span>
        </div>
        <p className="settings-hint">
          Off by default and after every app restart. Only workspace names, the active workspace,
          and counts of working, blocked, and done agents are shared. No terminal output, paths,
          messages, or commands are exposed.
        </p>
        <p className="settings-hint">
          This connection uses plain HTTP. Enable it only on a network you trust; anyone who learns
          the access code can read the limited status until you turn it off.
        </p>
        {!status?.running && (
          <label className="notification-policy-field">
            Network interface
            <select
              value={selectedAddress}
              onChange={(event) => setSelectedAddress(event.target.value)}
              disabled={busy || networks.length === 0}
            >
              {networks.map((network) => (
                <option key={`${network.label}:${network.address}`} value={network.address}>
                  {network.label} · {network.address}
                </option>
              ))}
            </select>
          </label>
        )}
        {networks.length === 0 && (
          <p className="settings-hint">No private IPv4 interface is available.</p>
        )}
        <button
          type="button"
          className="settings-action"
          disabled={busy || !status || (!status.running && !selectedAddress)}
          onClick={() => change(!status!.running)}
        >
          {busy ? 'Changing…' : status?.running ? 'Turn off companion' : 'Turn on companion'}
        </button>
        {error && (
          <p className="settings-form-error" role="alert">
            {error}
          </p>
        )}
      </section>
      {status?.running && (
        <section className="settings-group">
          <div className="settings-setting-head">
            <span>
              <strong>Connect another device</strong>
              <small>Open the address in its browser, then enter the access code.</small>
            </span>
          </div>
          <p className="companion-credential">
            <span>Address</span>
            <code>{status.url}</code>
          </p>
          <p className="companion-credential">
            <span>Access code</span>
            <code>{status.accessCode}</code>
          </p>
          <button
            type="button"
            className="settings-action"
            onClick={() => {
              if (!status.accessCode) return
              if (!navigator.clipboard?.writeText) {
                setError('Clipboard access is unavailable. Select and copy the code above.')
                return
              }
              void navigator.clipboard.writeText(status.accessCode).then(
                () => setCopied(true),
                () => setError('Clipboard access failed. Select and copy the code above.')
              )
            }}
          >
            {copied ? 'Copied' : 'Copy access code'}
          </button>
        </section>
      )}
    </div>
  )
}
