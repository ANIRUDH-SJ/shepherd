import { useState } from 'react'
import { MAX_PREVIEW_URL_LENGTH, normalizePreviewUrl } from '../../../shared/preview'
import DialogFrame from './DialogFrame'

interface Props {
  ports: readonly number[]
  onOpen: (url: string) => void
  onClose: () => void
}

export default function PreviewPicker({ ports, onOpen, onClose }: Props): React.JSX.Element {
  const suggestedUrl = ports[0] ? `http://localhost:${ports[0]}` : 'http://localhost:3000'
  const [value, setValue] = useState(suggestedUrl)
  const [error, setError] = useState<string | null>(null)

  const open = (candidate: string): void => {
    const normalized = normalizePreviewUrl(candidate)
    if (!normalized.ok || !normalized.url) {
      setError(normalized.error)
      return
    }
    onOpen(normalized.url)
  }

  return (
    <DialogFrame
      title="Open localhost preview"
      descriptionId="preview-picker-description"
      className="preview-picker"
      onClose={onClose}
    >
      <p id="preview-picker-description" className="utility-description">
        Open one explicitly selected loopback server beside the current terminal.
      </p>
      {ports.length > 0 && (
        <div className="preview-suggestions" aria-label="Detected listening ports">
          <strong>Detected</strong>
          <div>
            {ports.map((port) => (
              <button key={port} type="button" onClick={() => open(`http://localhost:${port}`)}>
                :{port}
              </button>
            ))}
          </div>
        </div>
      )}
      <form
        className="preview-picker-form"
        onSubmit={(event) => {
          event.preventDefault()
          open(value)
        }}
      >
        <label htmlFor="preview-picker-url">Localhost URL</label>
        <div>
          <input
            id="preview-picker-url"
            data-dialog-autofocus
            type="url"
            maxLength={MAX_PREVIEW_URL_LENGTH}
            spellCheck="false"
            value={value}
            aria-describedby={error ? 'preview-picker-error' : undefined}
            aria-invalid={Boolean(error)}
            onChange={(event) => {
              setValue(event.target.value)
              setError(null)
            }}
          />
          <button type="submit">Open beside terminal</button>
        </div>
        {error && (
          <p id="preview-picker-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </DialogFrame>
  )
}
