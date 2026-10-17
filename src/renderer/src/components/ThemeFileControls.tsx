import { useState } from 'react'
import { setApplicationCustomTheme } from '../appearance'
import { captureThemeForExport } from '../themeFileExport'
import type { ThemePresetId } from '../themePresets'

interface Props {
  preset: ThemePresetId
  onImported: () => void
}

export default function ThemeFileControls({ preset, onImported }: Props): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const importFile = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      const theme = await window.api.theme.importFile()
      if (theme) {
        setApplicationCustomTheme(theme)
        onImported()
        setMessage(`Imported ${theme.name}.`)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Theme import failed.')
    } finally {
      setBusy(false)
    }
  }

  const exportFile = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      const theme = captureThemeForExport(preset)
      const result = await window.api.theme.exportFile(theme)
      if (result) setMessage('Theme exported.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Theme export failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-group">
      <div className="settings-setting-head">
        <span>
          <strong>Theme file</strong>
          <small>
            Import a Shepherd JSON theme with light and dark palettes, or export the selected
            palette as a starting point. Files contain colors and a name only.
          </small>
        </span>
      </div>
      <div className="theme-file-actions">
        <button
          className="settings-action"
          type="button"
          disabled={busy}
          onClick={() => void importFile()}
        >
          Import…
        </button>
        <button
          className="settings-action"
          type="button"
          disabled={busy}
          onClick={() => void exportFile()}
        >
          Export…
        </button>
      </div>
      {message && (
        <p className="settings-hint" role="status">
          {message}
        </p>
      )}
    </section>
  )
}
