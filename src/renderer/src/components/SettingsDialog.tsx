import { useState } from 'react'
import { bumpFontSize, getFontSize, resetFontSize } from '../settings'
import DialogFrame from './DialogFrame'

interface Props {
  onOpenHelp: () => void
  onClose: () => void
}

export default function SettingsDialog({ onOpenHelp, onClose }: Props): React.JSX.Element {
  const [fontSize, setCurrentFontSize] = useState(getFontSize)
  return (
    <DialogFrame
      title="Settings"
      descriptionId="settings-description"
      className="settings-dialog"
      onClose={onClose}
    >
      <p id="settings-description" className="utility-description">
        Small terminal preferences without permanent settings chrome.
      </p>
      <div className="settings-sections">
        <section>
          <div className="settings-section-head">
            <span>
              <strong>Terminal font</strong>
              <small>Applied to every open terminal</small>
            </span>
            <output aria-live="polite">{fontSize}px</output>
          </div>
          <div className="settings-stepper" role="group" aria-label="Terminal font size">
            <button
              type="button"
              data-dialog-autofocus
              aria-label="Decrease terminal font"
              onClick={() => setCurrentFontSize(bumpFontSize(-1))}
            >
              −
            </button>
            <button type="button" onClick={() => setCurrentFontSize(resetFontSize())}>
              Reset
            </button>
            <button
              type="button"
              aria-label="Increase terminal font"
              onClick={() => setCurrentFontSize(bumpFontSize(1))}
            >
              +
            </button>
          </div>
        </section>
        <section>
          <div className="settings-section-head">
            <span>
              <strong>Theme integration</strong>
              <small>Neutral Shepherd chrome · independent terminal palette</small>
            </span>
            <span className="settings-value">System motion</span>
          </div>
          <p>
            System reduced-motion preferences are honored automatically; terminal colors remain
            stable for readable ANSI output.
          </p>
        </section>
        <section>
          <div className="settings-section-head">
            <span>
              <strong>Keybindings</strong>
              <small>Typed, conflict-avoiding Ctrl+Shift commands</small>
            </span>
            <button type="button" onClick={onOpenHelp}>
              View shortcuts
            </button>
          </div>
        </section>
      </div>
    </DialogFrame>
  )
}
