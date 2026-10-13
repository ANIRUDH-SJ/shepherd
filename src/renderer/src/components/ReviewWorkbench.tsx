import { useEffect, useRef, useState } from 'react'
import type {
  ReviewDiff,
  ReviewFile,
  ReviewPullRequestDiff,
  ReviewStatus,
  ReviewTestResult
} from '../../../shared/review'
import type { WorkspacePullRequest } from '../../../shared/workspaceMetadata'
import Icon from './Icon'

interface Props {
  workspaceName: string
  surfaceId: string
  pullRequest: WorkspacePullRequest | null
  onOpenPullRequest: (url: string) => void
  onClose: () => void
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'Review request failed'
}

function fileState(file: ReviewFile): string {
  if (file.conflicted) return 'Conflict'
  if (file.untracked) return 'Untracked'
  if (file.staged && file.unstaged) return 'Staged + modified'
  return file.staged ? 'Staged' : 'Modified'
}

export default function ReviewWorkbench({
  workspaceName,
  surfaceId,
  pullRequest,
  onOpenPullRequest,
  onClose
}: Props): React.JSX.Element {
  const panelRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [status, setStatus] = useState<ReviewStatus | null>(null)
  const [diff, setDiff] = useState<ReviewDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [testResult, setTestResult] = useState<ReviewTestResult | null>(null)
  const [pullRequestDiff, setPullRequestDiff] = useState<ReviewPullRequestDiff | null>(null)

  useEffect(() => {
    const focusOrigin =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.querySelector<HTMLElement>('[data-review-autofocus]')?.focus()
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current()
    }
    window.addEventListener('keydown', closeOnEscape, true)
    return () => {
      window.removeEventListener('keydown', closeOnEscape, true)
      requestAnimationFrame(() => {
        if (focusOrigin?.isConnected) focusOrigin.focus()
      })
    }
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setStatus(null)
    setDiff(null)
    setTestResult(null)
    setPullRequestDiff(null)
    setError(null)
    void window.api.review.status({ surfaceId }).then(
      (next) => {
        if (!active) return
        setStatus(next)
        setLoading(false)
      },
      (reason) => {
        if (!active) return
        setError(messageFor(reason))
        setLoading(false)
      }
    )
    return () => {
      active = false
    }
  }, [surfaceId])

  const refresh = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await window.api.review.status({ surfaceId }))
      setDiff(null)
      setPullRequestDiff(null)
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setBusy(false)
    }
  }

  const showDiff = async (file: ReviewFile, section: 'staged' | 'unstaged'): Promise<void> => {
    if (!status) return
    setBusy(true)
    setError(null)
    try {
      setDiff(
        await window.api.review.diff({ surfaceId, root: status.root, path: file.path, section })
      )
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setBusy(false)
    }
  }

  const changeStage = async (file: ReviewFile, action: 'stage' | 'unstage'): Promise<void> => {
    if (!status) return
    setBusy(true)
    setError(null)
    try {
      const request = { surfaceId, root: status.root, path: file.path }
      const next =
        action === 'stage'
          ? await window.api.review.stage(request)
          : await window.api.review.unstage(request)
      setStatus(next)
      setDiff(null)
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setBusy(false)
    }
  }

  const commit = async (): Promise<void> => {
    if (!status || !message.trim()) return
    setBusy(true)
    setError(null)
    try {
      setStatus(await window.api.review.commit({ surfaceId, root: status.root, message }))
      setMessage('')
      setDiff(null)
      setPullRequestDiff(null)
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setBusy(false)
    }
  }

  const runTests = async (): Promise<void> => {
    if (!status) return
    setBusy(true)
    setError(null)
    setTestResult(null)
    try {
      setTestResult(await window.api.review.test({ surfaceId, root: status.root }))
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setBusy(false)
    }
  }

  const showPullRequestDiff = async (): Promise<void> => {
    if (!status) return
    setBusy(true)
    setError(null)
    try {
      setPullRequestDiff(await window.api.review.pullRequestDiff({ surfaceId, root: status.root }))
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setBusy(false)
    }
  }

  const stagedCount = status?.files.filter((file) => file.staged && !file.conflicted).length ?? 0

  return (
    <aside
      ref={panelRef}
      className="workspace-inspector review-panel"
      role="dialog"
      aria-label={`${workspaceName} change review`}
    >
      <header className="inspector-head">
        <span>
          <small>Review</small>
          <strong>{workspaceName}</strong>
        </span>
        <button
          type="button"
          data-review-autofocus
          aria-label="Close change review"
          title="Close (Escape)"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="inspector-scroll">
        {loading && <p className="review-message">Loading repository changes…</p>}
        {error && (
          <p className="review-error" role="alert">
            {error}
          </p>
        )}
        {status && (
          <>
            <section className="inspector-section">
              <div className="review-section-heading">
                <h2>
                  Changed files · {status.files.length}
                  {status.truncated ? '+' : ''}
                </h2>
                <button type="button" disabled={busy} onClick={() => void refresh()}>
                  Refresh
                </button>
              </div>
              <code className="inspector-path" title={status.root}>
                {status.root}
              </code>
              <p className="review-branch">{status.branch ?? 'Detached HEAD'}</p>
              {status.files.length === 0 ? (
                <p className="inspector-empty">Working tree clean.</p>
              ) : (
                <ul className="review-files">
                  {status.files.map((file) => (
                    <li key={file.path}>
                      <div className="review-file-title">
                        <code title={file.path}>{file.path}</code>
                        <span>{fileState(file)}</span>
                      </div>
                      <div className="review-file-actions">
                        {file.staged && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void showDiff(file, 'staged')}
                          >
                            Staged diff
                          </button>
                        )}
                        {file.unstaged && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void showDiff(file, 'unstaged')}
                          >
                            Working diff
                          </button>
                        )}
                        {!file.conflicted && (file.unstaged || file.untracked) && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void changeStage(file, 'stage')}
                          >
                            Stage file
                          </button>
                        )}
                        {!file.conflicted && file.staged && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void changeStage(file, 'unstage')}
                          >
                            Unstage file
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {status.truncated && (
                <p className="inspector-empty">
                  Showing the first 200 files. Use Git in a terminal for the rest.
                </p>
              )}
            </section>

            {diff && (
              <section className="inspector-section" aria-label="Selected file diff">
                <h2>
                  {diff.section === 'staged' ? 'Staged' : 'Working'} diff · {diff.path}
                </h2>
                <pre className="review-output">{diff.text || 'No textual diff available.'}</pre>
              </section>
            )}

            <section className="inspector-section">
              <h2>Verify and commit</h2>
              {status.canRunNpmTest && (
                <button
                  className="inspector-action"
                  type="button"
                  disabled={busy}
                  onClick={() => void runTests()}
                >
                  Run npm test
                </button>
              )}
              {!status.canRunNpmTest && (
                <p className="inspector-empty">
                  No npm test script detected. Run your project’s checks in a terminal.
                </p>
              )}
              {testResult && (
                <div className="review-test-result" role="status">
                  <strong>
                    {testResult.ok ? 'Tests passed' : 'Tests failed'}
                    {testResult.truncated ? ' · output truncated' : ''}
                  </strong>
                  <pre className="review-output">{testResult.output}</pre>
                </div>
              )}
              <label className="review-commit-label" htmlFor="review-commit-message">
                Commit message
              </label>
              <input
                id="review-commit-message"
                type="text"
                maxLength={200}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Summarize the staged changes"
              />
              <button
                className="inspector-action"
                type="button"
                disabled={busy || status.truncated || stagedCount === 0 || !message.trim()}
                onClick={() => void commit()}
              >
                Commit {stagedCount} staged {stagedCount === 1 ? 'file' : 'files'}
              </button>
            </section>

            {pullRequest && (
              <section className="inspector-section">
                <h2>Pull request</h2>
                <button
                  className="inspector-action"
                  type="button"
                  disabled={busy}
                  onClick={() => void showPullRequestDiff()}
                >
                  View current branch PR diff
                </button>
                <button
                  className="inspector-action"
                  type="button"
                  onClick={() => onOpenPullRequest(pullRequest.url)}
                >
                  Open PR #{pullRequest.number} · {pullRequest.state}
                  <Icon name="external" />
                </button>
                {pullRequestDiff && (
                  <div className="review-test-result">
                    <strong>PR diff{pullRequestDiff.truncated ? ' · output truncated' : ''}</strong>
                    <pre className="review-output">
                      {pullRequestDiff.text || 'No textual diff available.'}
                    </pre>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
