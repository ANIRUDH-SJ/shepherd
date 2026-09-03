import { useEffect, useRef } from 'react'
import type { AgentRecord } from '../../../shared/agent'
import { agentStatusLabel, sortAgentsForSidebar } from '../agentView'
import { workspaceIdentity } from '../sidebarView'
import type { Workspace } from '../state/appReducer'
import { formatTokenCount, usageSummary } from '../usageView'
import { localhostPreviewUrl, workspaceSessionSummary } from '../workspaceInspector'
import Icon from './Icon'

interface Props {
  workspace: Workspace
  position: number
  agents: AgentRecord[]
  onOpenPreview: (url: string) => void
  onOpenPullRequest: (url: string) => void
  onFocusAgent: (agent: AgentRecord) => void
  onClose: () => void
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

export default function WorkspaceInspector({
  workspace,
  position,
  agents,
  onOpenPreview,
  onOpenPullRequest,
  onFocusAgent,
  onClose
}: Props): React.JSX.Element {
  const panelRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  const restoreFocusRef = useRef(true)
  onCloseRef.current = onClose
  const identity = workspaceIdentity(workspace, position)
  const session = workspaceSessionSummary(workspace.root)
  const orderedAgents = sortAgentsForSidebar(agents)
  const totalTokens = workspace.usage.totals.inputTokens + workspace.usage.totals.outputTokens
  const usageLabel = usageSummary(workspace.usage)

  useEffect(() => {
    const focusOrigin = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.querySelector<HTMLElement>('[data-inspector-autofocus]')?.focus()
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
        if (restoreFocusRef.current && focusOrigin?.isConnected) focusOrigin.focus()
      })
    }
  }, [])

  return (
    <aside
      ref={panelRef}
      className="workspace-inspector"
      role="dialog"
      aria-label={`${identity.primary} workspace inspector`}
    >
      <header className="inspector-head">
        <span>
          <small>Workspace</small>
          <strong>{identity.primary}</strong>
        </span>
        <button
          type="button"
          data-inspector-autofocus
          aria-label="Close workspace inspector"
          title="Close (Escape)"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>

      <div className="inspector-scroll">
        <section className="inspector-section" aria-labelledby="inspector-repository">
          <h2 id="inspector-repository">Repository</h2>
          <code className="inspector-path" title={workspace.gitRoot ?? workspace.cwd}>
            {workspace.gitRoot ?? workspace.cwd}
          </code>
          <dl className="inspector-facts">
            <div>
              <dt>Project</dt>
              <dd>{workspace.projectName}</dd>
            </div>
            <div>
              <dt>Branch</dt>
              <dd>{workspace.gitBranch ?? 'Not detected'}</dd>
            </div>
            <div>
              <dt>Git root</dt>
              <dd>{workspace.gitRoot ? 'Detected' : 'Not a Git repository'}</dd>
            </div>
          </dl>
          {workspace.pullRequest && (
            <button
              type="button"
              className="inspector-action"
              onClick={() => onOpenPullRequest(workspace.pullRequest!.url)}
            >
              <span>
                Pull request #{workspace.pullRequest.number} · {workspace.pullRequest.state}
              </span>
              <Icon name="external" />
            </button>
          )}
        </section>

        <section className="inspector-section" aria-labelledby="inspector-runtime">
          <h2 id="inspector-runtime">Runtime</h2>
          {workspace.ports.length === 0 ? (
            <p className="inspector-empty">No listening ports detected.</p>
          ) : (
            <div className="inspector-ports" aria-label="Detected listening ports">
              {workspace.ports.map((port) => {
                const url = localhostPreviewUrl(port)
                return (
                  <button
                    key={port}
                    type="button"
                    disabled={!url}
                    title={url ? `Open ${url} in a secure preview` : 'Invalid port'}
                    onClick={() => {
                      if (url) {
                        restoreFocusRef.current = false
                        onOpenPreview(url)
                      }
                    }}
                  >
                    <Icon name="preview" />
                    :{port}
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <section className="inspector-section" aria-labelledby="inspector-agents">
          <h2 id="inspector-agents">Agents</h2>
          {orderedAgents.length === 0 ? (
            <p className="inspector-empty">No live agent reports.</p>
          ) : (
            <div className="inspector-agents">
              {orderedAgents.map((agent) => (
                <button
                  key={agent.agentId}
                  type="button"
                  onClick={() => {
                    restoreFocusRef.current = false
                    onFocusAgent(agent)
                  }}
                  title={agent.message}
                >
                  <span className={`inspector-agent-marker state-${agent.state}`} aria-hidden="true" />
                  <span>
                    <strong>{agent.displayName}</strong>
                    <small>{agent.message ?? agent.provider}</small>
                  </span>
                  <span>{agentStatusLabel(agent)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="inspector-section" aria-labelledby="inspector-usage">
          <h2 id="inspector-usage">Usage</h2>
          {usageLabel ? (
            <dl className="inspector-facts">
              <div>
                <dt>Total tokens</dt>
                <dd>
                  {workspace.usage.totals.hasEstimated ? '~' : ''}
                  {formatTokenCount(totalTokens)}
                </dd>
              </div>
              <div>
                <dt>Cached</dt>
                <dd>{formatTokenCount(workspace.usage.totals.cachedTokens)}</dd>
              </div>
              <div>
                <dt>Reports</dt>
                <dd>{workspace.usage.totals.reportCount}</dd>
              </div>
              <div>
                <dt>Reported cost</dt>
                <dd>
                  {workspace.usage.totals.costUsd > 0
                    ? `$${workspace.usage.totals.costUsd.toFixed(4)}`
                    : 'Not reported'}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="inspector-empty">No usage reports for this workspace.</p>
          )}
        </section>

        <section className="inspector-section" aria-labelledby="inspector-session">
          <h2 id="inspector-session">Session</h2>
          <p className="inspector-session-summary">
            {plural(session.panes, 'pane')} · {plural(session.terminals, 'terminal')} ·{' '}
            {plural(session.previews, 'preview')}
          </p>
        </section>
      </div>
    </aside>
  )
}
