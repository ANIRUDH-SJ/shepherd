import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react'
import type { AgentRecord } from '../../../shared/agent'
import {
  agentRollupLabel,
  agentStatusLabel,
  attentionAgentsForSidebar,
  workspaceAgentAriaLabel,
  workspaceAgentLabel
} from '../agentView'
import { RENDERER_EVENT } from '../events'
import { workspaceIdentity, workspaceProjectContext } from '../sidebarView'
import { type AppAction, createWorkspaceAction, type Workspace } from '../state/appReducer'
import { workspaceNotificationCounts, type InboxNotification } from '../state/notificationInbox'
import Icon from './Icon'
import NotificationCenter from './NotificationCenter'

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

  const agentsByWorkspace = useMemo(() => {
    const grouped = new Map<string, AgentRecord[]>()
    for (const agent of agents) {
      const workspaceAgents = grouped.get(agent.workspaceId)
      if (workspaceAgents) workspaceAgents.push(agent)
      else grouped.set(agent.workspaceId, [agent])
    }
    return grouped
  }, [agents])

  const agentUnreadWorkspaceIds = useMemo(
    () =>
      new Set(
        workspaces.filter((workspace) => workspace.agentUnread).map((workspace) => workspace.id)
      ),
    [workspaces]
  )
  const attentionAgents = useMemo(
    () => attentionAgentsForSidebar(agents, notifications, agentUnreadWorkspaceIds),
    [agents, notifications, agentUnreadWorkspaceIds]
  )
  const unseenCompletionWorkspaceIds = useMemo(
    () =>
      new Set(
        attentionAgents
          .filter((agent) => agent.state === 'done')
          .map((agent) => agent.workspaceId)
      ),
    [attentionAgents]
  )

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

  const focusWorkspaceAt = (index: number): void => {
    const wrapped = (index + workspaces.length) % workspaces.length
    const workspace = workspaces[wrapped]
    dispatch({ type: 'selectWorkspace', id: workspace.id })
    requestAnimationFrame(() => rowRefs.current.get(workspace.id)?.focus())
  }

  const focusAgent = (agent: AgentRecord): void => {
    dispatch({ type: 'focusAgent', id: agent.agentId })
    window.requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent(RENDERER_EVENT.focusSurface, {
          detail: agent.surfaceId
        })
      )
    })
  }

  return (
    <div className="sidebar-inner">
      <div className="sidebar-head">
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

      <div className="ws-list" aria-label="Workspaces">
        {workspaces.map((workspace, index) => {
          const identity = workspaceIdentity(workspace, index)
          const displayName = identity.primary
          const editing = editingId === workspace.id
          const workspaceAgents = agentsByWorkspace.get(workspace.id) ?? []
          const agentSummary = agentRollupLabel(
            workspaceAgents,
            unseenCompletionWorkspaceIds.has(workspace.id)
          )
          const projectContext = workspaceProjectContext(workspace, identity)
          const summary = agentSummary ?? workspace.status ?? projectContext ?? identity.context
          const notificationCounts = workspaceNotificationCounts(notifications, workspace.id)
          const unreadCount =
            notificationCounts.unread +
            Number(workspace.agentUnread && notificationCounts.unread === 0)
          const active = workspace.id === activeWorkspaceId

          return (
            <div
              key={workspace.id}
              className={'ws-row' + (active ? ' active' : '')}
              onContextMenu={(event) => {
                if (event.target instanceof HTMLInputElement) return
                event.preventDefault()
                const width = 176
                const height = workspaces.length > 1 ? 78 : 44
                setContextMenu({
                  workspaceId: workspace.id,
                  x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
                  y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8))
                })
              }}
            >
              <div
                ref={(element) => {
                  if (element) rowRefs.current.set(workspace.id, element)
                  else rowRefs.current.delete(workspace.id)
                }}
                className="ws-row-select"
                role={editing ? undefined : 'button'}
                tabIndex={editing ? undefined : active ? 0 : -1}
                aria-current={active ? 'true' : undefined}
                aria-label={
                  editing
                    ? undefined
                    : `${displayName}, ${identity.positional}${active ? ', active workspace' : ''}${unreadCount > 0 ? `, ${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}` : ''}${agentSummary ? `, ${agentSummary}` : ''}`
                }
                onClick={() => {
                  if (!editing) dispatch({ type: 'selectWorkspace', id: workspace.id })
                }}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget || editing) return
                  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                    event.preventDefault()
                    focusWorkspaceAt(index + 1)
                  } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                    event.preventDefault()
                    focusWorkspaceAt(index - 1)
                  } else if (event.key === 'Home') {
                    event.preventDefault()
                    focusWorkspaceAt(0)
                  } else if (event.key === 'End') {
                    event.preventDefault()
                    focusWorkspaceAt(workspaces.length - 1)
                  } else if (event.key === 'F2') {
                    event.preventDefault()
                    startRename(workspace)
                  } else if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    dispatch({ type: 'selectWorkspace', id: workspace.id })
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
                        finishRename(workspace, true, false)
                      }}
                      onKeyDown={(event) => {
                        event.stopPropagation()
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          ignoreNextBlur.current = true
                          finishRename(workspace, true, true)
                        } else if (event.key === 'Escape') {
                          event.preventDefault()
                          ignoreNextBlur.current = true
                          finishRename(workspace, false, true)
                        }
                      }}
                    />
                  ) : (
                    <span
                      className="ws-name"
                      title="Double-click to rename"
                      onDoubleClick={(event) => {
                        event.stopPropagation()
                        startRename(workspace)
                      }}
                    >
                      {displayName}
                    </span>
                  )}
                </div>
                {!editing && summary && <div className="ws-summary">{summary}</div>}
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
                      startRename(workspace)
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
                    onClick={(event) => {
                      event.stopPropagation()
                      dispatch({ type: 'closeWorkspace', id: workspace.id })
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

      {attentionAgents.length > 0 && (
        <section className="attention-section" aria-labelledby="attention-heading">
          <header className="attention-section-head">
            <h2 id="attention-heading">Attention</h2>
            <span aria-label={`${attentionAgents.length} actionable agent items`}>
              {attentionAgents.length}
            </span>
          </header>
          <div className="attention-list" role="list">
            {attentionAgents.map((agent) => {
              const workspaceIndex = workspaces.findIndex(
                (workspace) => workspace.id === agent.workspaceId
              )
              const workspace = workspaces[workspaceIndex]
              if (!workspace) return null
              const workspaceName = workspaceIdentity(workspace, workspaceIndex).primary
              const status = agent.state === 'done' ? 'Completed' : agentStatusLabel(agent)
              return (
                <div key={agent.agentId} role="listitem">
                  <button
                    type="button"
                    className={`attention-item state-${agent.state}`}
                    title={`${workspaceAgentLabel(agent)}${agent.message ? ` · ${agent.message}` : ''}`}
                    aria-label={workspaceAgentAriaLabel(agent, workspaceName)}
                    onClick={() => focusAgent(agent)}
                  >
                    <span className="attention-marker" aria-hidden="true" />
                    <span className="attention-item-copy">
                      <strong>{agent.displayName}</strong>
                      <small>{workspaceName}</small>
                    </span>
                    <span className="attention-state">{status}</span>
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

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
          {workspaces.length > 1 && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                dispatch({ type: 'closeWorkspace', id: contextMenu.workspaceId })
                setContextMenu(null)
              }}
            >
              <Icon name="close" />
              Close workspace
            </button>
          )}
        </div>
      )}
    </div>
  )
}
