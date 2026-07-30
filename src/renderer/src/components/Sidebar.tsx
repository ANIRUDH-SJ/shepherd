import { useEffect, useRef, useState, type Dispatch } from 'react'
import type { AgentRecord } from '../../../shared/agent'
import { agentRollupLabel } from '../agentView'
import { workspaceIdentity } from '../sidebarView'
import { type AppAction, createWorkspaceAction, type Workspace } from '../state/appReducer'
import { usageDetails, usageSummary } from '../usageView'
import AgentList from './AgentList'
import Icon from './Icon'

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar — the vertical list of workspaces. Each row shows a
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
        <span className="brand">Shepherd</span>
        <div className="sidebar-head-actions">
          <button
            type="button"
            className="icon-btn"
            title="New workspace (Ctrl+Shift+N)"
            aria-label="New workspace"
            onClick={() => dispatch(createWorkspaceAction())}
          >
            <Icon name="add" />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Hide sidebar (Ctrl+Shift+B)"
            aria-label="Hide sidebar"
            onClick={onCollapse}
          >
            <Icon name="collapse" />
          </button>
        </div>
      </div>

      <div className="ws-list">
        {workspaces.map((w, i) => {
          const identity = workspaceIdentity(w, i)
          const displayName = identity.primary
          const editing = editingId === w.id
          const summary = usageSummary(w.usage)
          const agentSummary = agentRollupLabel(
            agents.filter((agent) => agent.workspaceId === w.id)
          )
          return (
            <div
              key={w.id}
              className={
                'ws-row' +
                (w.id === activeWorkspaceId ? ' active' : '') +
                (w.attention || w.agentAttention ? ' attention' : '')
              }
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
            >
              <div
                ref={(element) => {
                  if (element) rowRefs.current.set(w.id, element)
                  else rowRefs.current.delete(w.id)
                }}
                className="ws-row-select"
                role={editing ? undefined : 'button'}
                tabIndex={editing ? undefined : 0}
                aria-label={
                  editing
                    ? undefined
                    : `${displayName}, ${identity.positional}, project ${w.projectName}, ${w.gitBranch ? `branch ${w.gitBranch}` : 'not a Git repository'}${w.id === activeWorkspaceId ? ', active workspace' : ''}${agentSummary ? `, ${agentSummary}` : ''}`
                }
                onClick={() => {
                  if (!editing) dispatch({ type: 'selectWorkspace', id: w.id })
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
                </div>
                <div className="ws-meta">
                  <span
                    className="ws-context"
                    title={`${identity.context}\nProject: ${w.projectName}\nDirectory: ${w.cwd}`}
                  >
                    {identity.context}
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
                <div className="ws-detail-row">
                  <span
                    className={'ws-branch' + (w.gitBranch ? '' : ' no-git')}
                    title={w.gitBranch ? `Git branch: ${w.gitBranch}` : 'Not a Git repository'}
                  >
                    <Icon name="branch" />
                    <span>{w.gitBranch ?? 'No Git repository'}</span>
                  </span>
                </div>
                {w.status && <div className="ws-status">{w.status}</div>}
                {agentSummary && (
                  <div className="ws-agent-rollup" title={`Agents: ${agentSummary}`}>
                    <Icon name="agents" />
                    <span>{agentSummary}</span>
                  </div>
                )}
              </div>
              <div className="ws-row-actions">
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
                    <Icon name="rename" />
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
                    <Icon name="close" />
                  </button>
                )}
              </div>
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
            <Icon name="rename" />
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
