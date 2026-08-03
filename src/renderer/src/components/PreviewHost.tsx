import { useEffect, useRef, useState } from 'react'
import type { WebviewTag } from 'electron'
import {
  MAX_PREVIEW_URL_LENGTH,
  PREVIEW_PARTITION,
  normalizePreviewUrl
} from '../../../shared/preview'
import {
  createPreviewHistory,
  previewHistoryTarget,
  recordPreviewNavigation,
  type PreviewHistory
} from '../previewHistory'
import { surfacePanelId, surfaceTabId } from '../terminalChrome'
import Icon from './Icon'

interface Props {
  surfaceId: string
  url: string
  active: boolean
  onUrlChange: (url: string) => void
}

interface PreviewState {
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: string | null
}

const INITIAL_STATE: PreviewState = {
  loading: true,
  canGoBack: false,
  canGoForward: false,
  error: null
}

export default function PreviewHost({
  surfaceId,
  url,
  active,
  onUrlChange
}: Props): React.JSX.Element {
  const webviewHostRef = useRef<HTMLDivElement | null>(null)
  const webviewRef = useRef<WebviewTag | null>(null)
  const activeRef = useRef(active)
  const onUrlChangeRef = useRef(onUrlChange)
  const initialUrlRef = useRef(url)
  const historyRef = useRef<PreviewHistory>(createPreviewHistory(url))
  const [location, setLocation] = useState(url)
  const [state, setState] = useState(INITIAL_STATE)

  useEffect(() => {
    onUrlChangeRef.current = onUrlChange
  }, [onUrlChange])

  const updateHistoryState = (): void => {
    const history = historyRef.current
    setState((current) => ({
      ...current,
      canGoBack: history.index > 0,
      canGoForward: history.index < history.entries.length - 1
    }))
  }

  const recordNavigation = (nextUrl: string): void => {
    const history = historyRef.current
    recordPreviewNavigation(history, nextUrl)
    updateHistoryState()
  }

  const commitUrl = (nextUrl: string): void => {
    const normalized = normalizePreviewUrl(nextUrl)
    if (!normalized.ok || !normalized.url) return
    setLocation(normalized.url)
    setState((current) => ({ ...current, error: null }))
    onUrlChangeRef.current(normalized.url)
    recordNavigation(normalized.url)
  }

  const load = (value: string): void => {
    const normalized = normalizePreviewUrl(value)
    if (!normalized.ok || !normalized.url) {
      setState((current) => ({ ...current, error: normalized.error }))
      return
    }
    const webview = webviewRef.current
    if (!webview) return
    setLocation(normalized.url)
    setState((current) => ({ ...current, loading: true, error: null }))
    void webview.loadURL(normalized.url).catch(() => {
      setState((current) => ({
        ...current,
        loading: false,
        error: 'The localhost preview could not be loaded'
      }))
    })
  }

  useEffect(() => {
    const host = webviewHostRef.current
    if (!host) return
    const webview = document.createElement('webview') as WebviewTag
    webview.className = 'preview-webview'
    webview.setAttribute('partition', PREVIEW_PARTITION)
    webview.setAttribute('webpreferences', 'contextIsolation=yes,sandbox=yes,nodeIntegration=no')
    webview.setAttribute('src', initialUrlRef.current)
    webviewRef.current = webview

    const onAttach = (): void => {
      webview.setAudioMuted(!activeRef.current)
      updateHistoryState()
    }
    const onStart = (): void => setState((current) => ({ ...current, loading: true, error: null }))
    const onStop = (): void => {
      setState((current) => ({ ...current, loading: false }))
    }
    const onNavigate = (event: Event): void => {
      const nextUrl = (event as Event & { url?: unknown }).url
      if (typeof nextUrl === 'string') commitUrl(nextUrl)
    }
    const onWillNavigate = (event: Event): void => {
      const nextUrl = (event as Event & { url?: unknown }).url
      if (typeof nextUrl === 'string' && !normalizePreviewUrl(nextUrl).ok) {
        setState((current) => ({
          ...current,
          error: 'Navigation outside localhost was blocked'
        }))
      }
    }
    const onFail = (event: Event): void => {
      const failure = event as Event & {
        errorCode?: unknown
        errorDescription?: unknown
        isMainFrame?: unknown
      }
      if (failure.isMainFrame === false || failure.errorCode === -3) return
      setState((current) => ({
        ...current,
        loading: false,
        error:
          typeof failure.errorDescription === 'string' && failure.errorDescription
            ? `Preview failed: ${failure.errorDescription}`
            : 'The localhost preview could not be loaded'
      }))
    }
    const onGone = (): void =>
      setState((current) => ({
        ...current,
        loading: false,
        error: 'The preview process stopped. Retry to start it again.'
      }))

    webview.addEventListener('did-attach', onAttach)
    webview.addEventListener('did-start-loading', onStart)
    webview.addEventListener('did-stop-loading', onStop)
    webview.addEventListener('did-navigate', onNavigate)
    webview.addEventListener('did-navigate-in-page', onNavigate)
    webview.addEventListener('will-navigate', onWillNavigate)
    webview.addEventListener('did-fail-load', onFail)
    webview.addEventListener('render-process-gone', onGone)
    host.append(webview)

    return () => {
      webview.removeEventListener('did-attach', onAttach)
      webview.removeEventListener('did-start-loading', onStart)
      webview.removeEventListener('did-stop-loading', onStop)
      webview.removeEventListener('did-navigate', onNavigate)
      webview.removeEventListener('did-navigate-in-page', onNavigate)
      webview.removeEventListener('will-navigate', onWillNavigate)
      webview.removeEventListener('did-fail-load', onFail)
      webview.removeEventListener('render-process-gone', onGone)
      webview.remove()
      webviewRef.current = null
    }
  }, [surfaceId])

  useEffect(() => {
    activeRef.current = active
    try {
      webviewRef.current?.setAudioMuted(!active)
    } catch {
      // The guest may not be attached yet; did-attach applies the latest value.
    }
  }, [active])

  const openExternal = (): void => {
    void window.api.preview.openExternal(location).then((result) => {
      if (!result.ok) setState((current) => ({ ...current, error: result.error }))
    })
  }

  const navigateHistory = (offset: -1 | 1): void => {
    const webview = webviewRef.current
    const history = historyRef.current
    const nextIndex = previewHistoryTarget(history, offset)
    if (!webview || nextIndex === null) return
    history.pendingIndex = nextIndex
    setState((current) => ({ ...current, loading: true, error: null }))
    void webview.executeJavaScript(offset === -1 ? 'history.back()' : 'history.forward()').catch(() => {
      history.pendingIndex = null
      updateHistoryState()
      setState((current) => ({
        ...current,
        loading: false,
        error: 'Preview history navigation failed'
      }))
    })
  }

  return (
    <section
      id={surfacePanelId(surfaceId)}
      className="preview-panel"
      role="tabpanel"
      aria-labelledby={surfaceTabId(surfaceId)}
      aria-busy={state.loading}
      hidden={!active}
    >
      <form
        className="preview-toolbar"
        aria-label="Localhost preview controls"
        onSubmit={(event) => {
          event.preventDefault()
          load(location)
        }}
      >
        <button
          type="button"
          aria-label="Go back"
          title="Back"
          disabled={!state.canGoBack}
          onClick={() => navigateHistory(-1)}
        >
          <Icon name="back" />
        </button>
        <button
          type="button"
          aria-label="Go forward"
          title="Forward"
          disabled={!state.canGoForward}
          onClick={() => navigateHistory(1)}
        >
          <Icon name="forward" />
        </button>
        <button
          type="button"
          aria-label={state.loading ? 'Stop loading' : 'Reload preview'}
          title={state.loading ? 'Stop' : 'Reload'}
          onClick={() => {
            if (state.loading) webviewRef.current?.stop()
            else webviewRef.current?.reload()
          }}
        >
          <Icon name={state.loading ? 'stop' : 'reload'} />
        </button>
        <input
          type="url"
          aria-label="Preview URL"
          spellCheck="false"
          maxLength={MAX_PREVIEW_URL_LENGTH}
          value={location}
          onChange={(event) => setLocation(event.target.value)}
        />
        <button type="submit" className="preview-go">
          Go
        </button>
        <button
          type="button"
          aria-label="Open preview in system browser"
          title="Open externally"
          onClick={openExternal}
        >
          <Icon name="external" />
        </button>
      </form>
      <div ref={webviewHostRef} className="preview-webview-host" />
      {state.error && (
        <div className="preview-error" role="alert">
          <Icon name="preview" />
          <strong>Preview unavailable</strong>
          <span>{state.error}</span>
          <button type="button" onClick={() => load(location)}>
            Retry
          </button>
        </div>
      )}
    </section>
  )
}
