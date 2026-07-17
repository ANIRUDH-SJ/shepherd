import type { Dispatch } from 'react'
import type { AgentRecord } from '../../../shared/agent'
import { type AppAction, createWorkspaceAction, type Workspace } from '../state/appReducer'
import { usageDetails, usageSummary } from '../usageView'
import AgentList from './AgentList'

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar — the vertical list of workspaces (cmux's signature). Each row shows a
// name + a status subtitle, with an active highlight and unread/attention markers.
// The status/attention come from the socket server (Stage 2) via the app reducer.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  workspaces: Workspace[]
  agents: AgentRecord[]
  activeWorkspaceId: string
  dispatch: Dispatch<AppAction>
  onCollapse: () => void
}

export default function Sidebar({
  workspaces,
  agents,
  activeWorkspaceId,
  dispatch,
  onCollapse
}: Props): React.JSX.Element {
  return (
    <div className="sidebar-inner">
      <div className="sidebar-head">
        <span className="brand">cmux-linux</span>
        <div className="sidebar-head-actions">
          <button
            className="icon-btn"
            title="New workspace (Ctrl+Shift+N)"
            onClick={() => dispatch(createWorkspaceAction())}
          >
            +
          </button>
          <button className="icon-btn" title="Hide sidebar (Ctrl+Shift+B)" onClick={onCollapse}>
            ‹
          </button>
        </div>
      </div>

      <div className="ws-list">
        {workspaces.map((w, i) => {
          const summary = usageSummary(w.usage)
          return (
            <button
              key={w.id}
              className={
                'ws-row' +
                (w.id === activeWorkspaceId ? ' active' : '') +
                (w.attention || w.agentAttention ? ' attention' : '')
              }
              onClick={() => dispatch({ type: 'selectWorkspace', id: w.id })}
            >
              <div className="ws-row-top">
                {(w.unread || w.agentUnread) && <span className="ws-dot" title="unread" />}
                <span className="ws-name">{w.name || `workspace ${i + 1}`}</span>
                {workspaces.length > 1 && (
                  <span
                    className="ws-close"
                    title="Close workspace"
                    onClick={(e) => {
                      e.stopPropagation()
                      dispatch({ type: 'closeWorkspace', id: w.id })
                    }}
                  >
                    ×
                  </span>
                )}
              </div>
              <div className="ws-meta">
                <span className="ws-status">{w.status ?? w.cwd}</span>
                {summary && (
                  <span
                    className="ws-usage"
                    title={usageDetails(w.usage)}
                    aria-label={usageDetails(w.usage)}
                  >
                    {summary}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      <AgentList agents={agents} workspaces={workspaces} dispatch={dispatch} />

      <div className="shortcuts">
        <div className="shortcuts-title">shortcuts</div>
        <div>
          <kbd>Ctrl+Shift+D</kbd> split right
        </div>
        <div>
          <kbd>Ctrl+Shift+E</kbd> split down
        </div>
        <div>
          <kbd>Ctrl+Shift+T</kbd> new tab
        </div>
        <div>
          <kbd>Ctrl+Shift+N</kbd> new workspace
        </div>
        <div>
          <kbd>Ctrl+Shift+W</kbd> close
        </div>
        <div>
          <kbd>Ctrl+Shift+±</kbd> zoom terminal
        </div>
      </div>
    </div>
  )
}
