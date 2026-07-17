import { useEffect, useRef, useState, type Dispatch } from 'react'
import type { AgentRecord } from '../../../shared/agent'
import { agentRollupLabel } from '../agentView'
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

interface WorkspaceContextMenu {
  workspaceId: string
  x: number
  y: number
}

export default function Sidebar({
  workspaces,
  agents,
  activeWorkspaceId,
  dispatch,
  onCollapse
}: Props): React.JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [contextMenu, setContextMenu] = useState<WorkspaceContextMenu | null>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const ignoreNextBlur = useRef(false)

  const startRename = (workspace: Workspace): void => {
    setContextMenu(null)
    ignoreNextBlur.current = false
    setEditingId(workspace.id)
    setDraftName(workspace.name)
  }

  useEffect(() => {
    if (!contextMenu) return
    const dismiss = (): void => setContextMenu(null)
    const dismissOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') dismiss()
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismissOnEscape)
    window.addEventListener('blur', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', dismissOnEscape)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [contextMenu])

  const finishRename = (workspace: Workspace, save: boolean, restoreFocus: boolean): void => {
    if (save) dispatch({ type: 'renameWorkspace', id: workspace.id, name: draftName })
    setEditingId(null)
    if (restoreFocus) requestAnimationFrame(() => rowRefs.current.get(workspace.id)?.focus())
  }

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
          const displayName = w.name || `workspace ${i + 1}`
          const editing = editingId === w.id
          const summary = usageSummary(w.usage)
          const agentSummary = agentRollupLabel(
            agents.filter((agent) => agent.workspaceId === w.id)
          )
          return (
            <div
              key={w.id}
              ref={(element) => {
                if (element) rowRefs.current.set(w.id, element)
                else rowRefs.current.delete(w.id)
              }}
              role="button"
              tabIndex={0}
              aria-label={`${displayName}, project ${w.projectName}, ${w.gitBranch ? `branch ${w.gitBranch}` : 'not a Git repository'}${w.id === activeWorkspaceId ? ', active workspace' : ''}${agentSummary ? `, ${agentSummary}` : ''}`}
              className={
                'ws-row' +
                (w.id === activeWorkspaceId ? ' active' : '') +
                (w.attention || w.agentAttention ? ' attention' : '')
              }
              onClick={() => dispatch({ type: 'selectWorkspace', id: w.id })}
              onContextMenu={(event) => {
                if (event.target instanceof HTMLInputElement) return
                event.preventDefault()
                const width = 160
                const height = 44
                setContextMenu({
                  workspaceId: w.id,
                  x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
                  y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8))
                })
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || editing) return
                if (event.key === 'F2') {
                  event.preventDefault()
                  startRename(w)
                } else if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  dispatch({ type: 'selectWorkspace', id: w.id })
                }
              }}
            >
              <div className="ws-row-top">
                {(w.unread || w.agentUnread) && <span className="ws-dot" title="unread" />}
                {editing ? (
                  <input
                    className="ws-name-input"
                    value={draftName}
                    placeholder={displayName}
                    maxLength={64}
                    autoFocus
                    aria-label={`Rename ${displayName}`}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setDraftName(event.target.value)}
                    onBlur={() => {
                      if (ignoreNextBlur.current) {
                        ignoreNextBlur.current = false
                        return
                      }
                      finishRename(w, true, false)
                    }}
                    onKeyDown={(event) => {
                      event.stopPropagation()
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        ignoreNextBlur.current = true
                        finishRename(w, true, true)
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        ignoreNextBlur.current = true
                        finishRename(w, false, true)
                      }
                    }}
                  />
                ) : (
                  <span
                    className="ws-name"
                    title="Double-click to rename"
                    onDoubleClick={(event) => {
                      event.stopPropagation()
                      startRename(w)
                    }}
                  >
                    {displayName}
                  </span>
                )}
                {!editing && (
                  <button
                    type="button"
                    className="ws-rename"
                    title={`Rename ${displayName} (F2)`}
                    aria-label={`Rename ${displayName}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      startRename(w)
                    }}
                  >
                    ✎
                  </button>
                )}
                {workspaces.length > 1 && (
                  <button
                    type="button"
                    className="ws-close"
                    title={`Close ${displayName}`}
                    aria-label={`Close ${displayName}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      dispatch({ type: 'closeWorkspace', id: w.id })
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="ws-meta">
                <span
                  className="ws-project"
                  title={`Project: ${w.projectName}\nDirectory: ${w.cwd}`}
                >
                  {w.projectName}
                </span>
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
              <div
                className={'ws-branch' + (w.gitBranch ? '' : ' no-git')}
                title={w.gitBranch ? `Git branch: ${w.gitBranch}` : 'Not a Git repository'}
              >
                git: {w.gitBranch ?? 'no git'}
              </div>
              {w.status && <div className="ws-status">{w.status}</div>}
              {agentSummary && (
                <div className="ws-agent-rollup" title={`Agents: ${agentSummary}`}>
                  {agentSummary}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <AgentList agents={agents} workspaces={workspaces} dispatch={dispatch} />

      {contextMenu && (
        <div
          className="ws-context-menu"
          role="menu"
          aria-label="Workspace actions"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            autoFocus
            onClick={() => {
              const workspace = workspaces.find((item) => item.id === contextMenu.workspaceId)
              if (workspace) startRename(workspace)
            }}
          >
            Rename workspace
          </button>
        </div>
      )}

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
