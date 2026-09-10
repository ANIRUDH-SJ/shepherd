import { useRef, useState } from 'react'
import type { AppearanceMode } from '../../../shared/appearance'
import { setApplicationAppearance } from '../appearance'
import {
  APPEARANCE_MODES,
  bumpFontSize,
  getRendererPreferences,
  resetFontSize,
  type RendererPreferences
} from '../settings'
import { terminalThemeForAppearance } from '../terminalTheme'
import DialogFrame from './DialogFrame'

const SETTINGS_CATEGORIES = [
  'Appearance',
  'Terminal',
  'Keyboard',
  'Notifications',
  'Workspaces',
  'Agents',
  'Advanced'
] as const

type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number]

interface Props {
  onOpenHelp: () => void
  onClose: () => void
}

function appearanceLabel(mode: AppearanceMode): string {
  return mode[0].toUpperCase() + mode.slice(1)
}

export default function SettingsDialog({ onOpenHelp, onClose }: Props): React.JSX.Element {
  const [category, setCategory] = useState<SettingsCategory>('Appearance')
  const [preferences, setPreferences] = useState<RendererPreferences>(getRendererPreferences)
  const categoryRefs = useRef<Array<HTMLButtonElement | null>>([])
  const terminalTheme = terminalThemeForAppearance(
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  )
  const systemSwatches = [
    terminalTheme.black,
    terminalTheme.red,
    terminalTheme.green,
    terminalTheme.yellow,
    terminalTheme.blue,
    terminalTheme.magenta,
    terminalTheme.cyan,
    terminalTheme.foreground
  ].filter((color): color is string => typeof color === 'string')

  const updateAppearance = (mode: AppearanceMode): void => {
    setPreferences((current) => ({ ...current, appearanceMode: mode }))
    void setApplicationAppearance(mode).catch(() => {
      setPreferences(getRendererPreferences())
    })
  }

  const updateFontSize = (next: () => number): void => {
    const terminalFontSize = next()
    setPreferences((current) => ({ ...current, terminalFontSize }))
  }

  const selectCategory = (index: number): void => {
    const wrapped = (index + SETTINGS_CATEGORIES.length) % SETTINGS_CATEGORIES.length
    const next = SETTINGS_CATEGORIES[wrapped]
    setCategory(next)
    categoryRefs.current[wrapped]?.focus()
  }

  const handleCategoryKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      selectCategory(index + 1)
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      selectCategory(index - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      selectCategory(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      selectCategory(SETTINGS_CATEGORIES.length - 1)
    }
  }

  return (
    <DialogFrame title="Settings" className="settings-dialog" onClose={onClose}>
      <div className="settings-layout">
        <nav
          className="settings-nav"
          aria-label="Settings categories"
          aria-orientation="vertical"
          role="tablist"
        >
          {SETTINGS_CATEGORIES.map((item, index) => (
            <button
              key={item}
              ref={(element) => {
                categoryRefs.current[index] = element
              }}
              id={`settings-tab-${item.toLowerCase()}`}
              type="button"
              role="tab"
              aria-selected={category === item}
              aria-controls="settings-panel"
              tabIndex={category === item ? 0 : -1}
              data-dialog-autofocus={index === 0 ? true : undefined}
              onClick={() => setCategory(item)}
              onKeyDown={(event) => handleCategoryKeyDown(event, index)}
            >
              {item}
            </button>
          ))}
        </nav>

        <div
          id="settings-panel"
          className="settings-panel"
          role="tabpanel"
          aria-labelledby={`settings-tab-${category.toLowerCase()}`}
        >
          <header className="settings-panel-head">
            <h2>{category}</h2>
          </header>

          {category === 'Appearance' && (
            <div className="settings-group-list">
              <section className="settings-group">
                <div className="settings-setting-head">
                  <span>
                    <strong>Application appearance</strong>
                    <small>Follow Linux, or keep Shepherd consistently light or dark.</small>
                  </span>
                  <span className="settings-value">
                    {appearanceLabel(preferences.appearanceMode)}
                  </span>
                </div>
                <div className="settings-choice" role="group" aria-label="Application appearance">
                  {APPEARANCE_MODES.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={preferences.appearanceMode === mode}
                      onClick={() => updateAppearance(mode)}
                    >
                      {appearanceLabel(mode)}
                    </button>
                  ))}
                </div>
              </section>
              <section className="settings-group">
                <div className="settings-setting-head">
                  <span>
                    <strong>Terminal palette</strong>
                    <small>Matches Shepherd chrome in light and dark appearance.</small>
                  </span>
                  <span className="settings-value">System</span>
                </div>
                <div className="terminal-palette-preview" aria-label="System terminal palette">
                  {systemSwatches.map((color) => (
                    <span key={color} style={{ backgroundColor: color }} />
                  ))}
                </div>
              </section>
            </div>
          )}

          {category === 'Terminal' && (
            <div className="settings-group-list">
              <section className="settings-group">
                <div className="settings-setting-head">
                  <span>
                    <strong>Font size</strong>
                    <small>Applied immediately to every open terminal.</small>
                  </span>
                  <output aria-live="polite">{preferences.terminalFontSize}px</output>
                </div>
                <div className="settings-stepper" role="group" aria-label="Terminal font size">
                  <button
                    type="button"
                    aria-label="Decrease terminal font"
                    onClick={() => updateFontSize(() => bumpFontSize(-1))}
                  >
                    −
                  </button>
                  <button type="button" onClick={() => updateFontSize(resetFontSize)}>
                    Reset
                  </button>
                  <button
                    type="button"
                    aria-label="Increase terminal font"
                    onClick={() => updateFontSize(() => bumpFontSize(1))}
                  >
                    +
                  </button>
                </div>
              </section>
              <section className="settings-group">
                <div className="settings-setting-head">
                  <span>
                    <strong>Color contract</strong>
                    <small>
                      ANSI roles stay stable while foreground and backdrop follow appearance.
                    </small>
                  </span>
                  <span className="settings-value">Synchronized</span>
                </div>
              </section>
            </div>
          )}

          {category === 'Keyboard' && (
            <div className="settings-group-list">
              <section className="settings-group">
                <div className="settings-setting-head">
                  <span>
                    <strong>Keyboard reference</strong>
                    <small>Browse every command and its current shortcut.</small>
                  </span>
                  <button type="button" className="settings-action" onClick={onOpenHelp}>
                    View shortcuts
                  </button>
                </div>
              </section>
            </div>
          )}

          {category === 'Notifications' && (
            <div className="settings-group-list">
              <section className="settings-group">
                <div className="settings-setting-head">
                  <span>
                    <strong>Notification inbox</strong>
                    <small>Agent and OSC events remain local and can jump to their terminal.</small>
                  </span>
                  <span className="settings-value">Enabled</span>
                </div>
              </section>
              <section className="settings-group">
                <div className="settings-setting-head">
                  <span>
                    <strong>Focused-workspace suppression</strong>
                    <small>
                      Background attention remains visible without interrupting active work.
                    </small>
                  </span>
                  <span className="settings-value">Automatic</span>
                </div>
              </section>
            </div>
          )}

          {category === 'Workspaces' && (
            <div className="settings-group-list">
              <section className="settings-group">
                <div className="settings-setting-head">
                  <span>
                    <strong>Session restore</strong>
                    <small>The active workspace layout and bounded inbox restore on launch.</small>
                  </span>
                  <span className="settings-value">Enabled</span>
                </div>
              </section>
              <section className="settings-group">
                <div className="settings-setting-head">
                  <span>
                    <strong>Git worktrees</strong>
                    <small>
                      New isolated workspaces remain available through Shepherd commands.
                    </small>
                  </span>
                  <span className="settings-value">Available</span>
                </div>
              </section>
            </div>
          )}

          {category === 'Agents' && (
            <div className="settings-group-list">
              <section className="settings-group">
                <div className="settings-setting-head">
                  <span>
                    <strong>Lifecycle adapters</strong>
                    <small>Codex, Claude Code, OpenCode, and custom reporters.</small>
                  </span>
                  <span className="settings-value">4 providers</span>
                </div>
              </section>
              <section className="settings-group">
                <div className="settings-setting-head">
                  <span>
                    <strong>Attention states</strong>
                    <small>
                      Working, blocked, done, idle, and stale states use text and shape.
                    </small>
                  </span>
                  <span className="settings-value">Semantic</span>
                </div>
              </section>
            </div>
          )}

          {category === 'Advanced' && (
            <div className="settings-group-list">
              <section className="settings-group">
                <div className="settings-setting-head">
                  <span>
                    <strong>Preferences schema</strong>
                    <small>Versioned local settings with safe migration and fallback.</small>
                  </span>
                  <span className="settings-value">v{preferences.version}</span>
                </div>
              </section>
              <section className="settings-group">
                <div className="settings-setting-head">
                  <span>
                    <strong>Shepherd version</strong>
                    <small>Desktop runtime and CLI compatibility version.</small>
                  </span>
                  <span className="settings-value">{window.api.version}</span>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </DialogFrame>
  )
}
