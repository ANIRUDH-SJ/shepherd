import { useEffect, useRef, useState, type Dispatch } from 'react'
import type { AgentRecord } from '../../../shared/agent'
import {
  agentRollupLabel,
  sortAgentsForSidebar,
  workspaceAgentAriaLabel,
  workspaceAgentLabel
} from '../agentView'
import { RENDERER_EVENT } from '../events'
import { workspaceIdentity, workspaceProjectContext, workspaceRuntimeContext } from '../sidebarView'
import { type AppAction, createWorkspaceAction, type Workspace } from '../state/appReducer'
import { workspaceNotificationCounts, type InboxNotification } from '../state/notificationInbox'
import { usageDetails, usageSummary } from '../usageView'
import Icon from './Icon'
import NotificationCenter from './NotificationCenter'

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar — the vertical list of workspaces. Each row shows a
// name + a status subtitle, with an active highlight and unread/attention markers.
// The status/attention come from the socket server (Stage 2) via the app reducer.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  workspaces: Workspace[]
  agents: AgentRecord[]
  notifications: InboxNotification[]
  activeWorkspaceId: string
  dispatch: Dispatch<AppAction>
  onCollapse: () => void
  onOpenPalette: () => void
}

interface WorkspaceContextMenu {
  workspaceId: string
  x: number
  y: number
}

export default function Sidebar({
  workspaces,
  agents,
  notifications,
  activeWorkspaceId,
  dispatch,
  onCollapse,
  onOpenPalette
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

  const agentsByWorkspace = new Map<string, AgentRecord[]>()
  for (const agent of agents) {
    const workspaceAgents = agentsByWorkspace.get(agent.workspaceId)
    if (workspaceAgents) workspaceAgents.push(agent)
    else agentsByWorkspace.set(agent.workspaceId, [agent])
  }

  return (
    <div className="sidebar-inner">
      <div className="sidebar-head">
        <span className="brand">Shepherd</span>
        <div className="sidebar-head-actions">
          <NotificationCenter
            notifications={notifications}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            dispatch={dispatch}
          />
          <button
            type="button"
            className="icon-btn"
            title="Commands (Ctrl+Shift+P)"
            aria-label="Open command palette"
            onClick={onOpenPalette}
          >
            <Icon name="command" />
          </button>
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
          const workspaceAgents = sortAgentsForSidebar(agentsByWorkspace.get(w.id) ?? [])
          const agentSummary = agentRollupLabel(workspaceAgents)
          const projectContext = workspaceProjectContext(w, identity)
          const runtimeContext = workspaceRuntimeContext(w)
          const hasMetadata = Boolean(projectContext || w.gitBranch || runtimeContext || summary)
          const notificationCounts = workspaceNotificationCounts(notifications, w.id)
          const unreadCount =
            notificationCounts.unread + Number(w.agentUnread && notificationCounts.unread === 0)
          return (
            <div
              key={w.id}
              className={'ws-row' + (w.id === activeWorkspaceId ? ' active' : '')}
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
                    : `${displayName}, ${identity.positional}, project ${w.projectName}, ${w.gitBranch ? `branch ${w.gitBranch}` : 'not a Git repository'}${runtimeContext ? `, ${runtimeContext.description}` : ''}${w.id === activeWorkspaceId ? ', active workspace' : ''}${unreadCount > 0 ? `, ${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}` : ''}${agentSummary ? `, ${agentSummary}` : ''}`
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
                  {unreadCount > 0 && (
                    <span
                      className="ws-badge"
                      title={`${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`}
                      aria-hidden="true"
                    >
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
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
                {workspaceAgents.length === 0 && w.status && (
                  <div className="ws-status">{w.status}</div>
                )}
                {hasMetadata && (
                  <div className="ws-meta">
                    {projectContext && (
                      <span
                        className="ws-context"
                        title={`Project: ${w.projectName}\nDirectory: ${w.cwd}`}
                      >
                        {projectContext}
                      </span>
                    )}
                    {w.gitBranch && (
                      <span className="ws-branch" title={`Git branch: ${w.gitBranch}`}>
                        <Icon name="branch" />
                        <span>{w.gitBranch}</span>
                      </span>
                    )}
                    {runtimeContext && (
                      <span
                        className="ws-runtime-context"
                        title={runtimeContext.description}
                        aria-label={runtimeContext.description}
                      >
                        {runtimeContext.label}
                      </span>
                    )}
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
                )}
              </div>
              {workspaceAgents.length > 0 && (
                <div className="ws-agents" aria-label={`${displayName} agents`}>
                  {workspaceAgents.map((agent) => (
                    <button
                      key={agent.agentId}
                      type="button"
                      className={`ws-agent state-${agent.state}`}
                      title={`${workspaceAgentLabel(agent)}${agent.message ? ` · ${agent.message}` : ''}`}
                      aria-label={workspaceAgentAriaLabel(agent, displayName)}
                      onClick={(event) => {
                        event.stopPropagation()
                        dispatch({ type: 'focusAgent', id: agent.agentId })
                        window.requestAnimationFrame(() => {
                          window.dispatchEvent(
                            new CustomEvent(RENDERER_EVENT.focusSurface, {
                              detail: agent.surfaceId
                            })
                          )
                        })
                      }}
                    >
                      <span className="ws-agent-dot" aria-hidden="true" />
                      <span>{workspaceAgentLabel(agent)}</span>
                    </button>
                  ))}
                </div>
              )}
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
    </div>
  )
}
