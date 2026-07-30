import { useEffect, useState, type Dispatch } from 'react'
import type { AgentRecord } from '../../../shared/agent'
import {
  agentAriaLabel,
  groupAgentsForSidebar,
  agentStatusLabel,
  formatAgentElapsed
} from '../agentView'
import { RENDERER_EVENT } from '../events'
import { workspaceIdentity } from '../sidebarView'
import type { AppAction, Workspace } from '../state/appReducer'
import Icon from './Icon'

interface Props {
  agents: AgentRecord[]
  workspaces: Workspace[]
  dispatch: Dispatch<AppAction>
}

export default function AgentList({ agents, workspaces, dispatch }: Props): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (agents.length === 0) return
    let timer: number | null = null
    const stop = (): void => {
      if (timer !== null) window.clearInterval(timer)
      timer = null
    }
    const start = (): void => {
      stop()
      if (document.hidden) return
      setNow(Date.now())
      timer = window.setInterval(() => setNow(Date.now()), 10_000)
    }
    const onVisibility = (): void => start()
    document.addEventListener('visibilitychange', onVisibility)
    start()
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [agents.length])

  const workspaceNames = new Map(
    workspaces.map((workspace, index) => [
      workspace.id,
      workspaceIdentity(workspace, index).primary
    ])
  )
  const groups = groupAgentsForSidebar(agents)

  return (
    <section className="agent-section" aria-labelledby="agent-section-title">
      <div className="agent-section-head">
        <span id="agent-section-title">Agents</span>
        <span aria-label={`${agents.length} ${agents.length === 1 ? 'agent' : 'agents'}`}>
          {agents.length}
        </span>
      </div>
      {groups.length === 0 ? (
        <div className="agent-empty">
          <Icon name="agents" />
          <span>
            <strong>No agents yet</strong>
            <small>Launch one in any terminal</small>
          </span>
        </div>
      ) : (
        <div className="agent-list">
          {groups.map((group) => (
            <section
              key={group.key}
              className={`agent-group group-${group.key}`}
              aria-labelledby={`agent-group-${group.key}`}
            >
              <div className="agent-group-head">
                <span id={`agent-group-${group.key}`}>{group.label}</span>
                <span>{group.agents.length}</span>
              </div>
              <div role="list">
                {group.agents.map((agent) => {
                  const workspaceName = workspaceNames.get(agent.workspaceId) ?? 'unknown workspace'
                  const status = agentStatusLabel(agent)
                  const elapsed = formatAgentElapsed(agent.updatedAt, now)
                  const updated = elapsed === 'now' ? 'updated now' : `updated ${elapsed} ago`
                  return (
                    <div key={agent.agentId} role="listitem">
                      <button
                        type="button"
                        className={`agent-row state-${agent.state}`}
                        title={`${agent.displayName} · ${status} · ${workspaceName}${agent.message ? ` · ${agent.message}` : ''} · ${updated}`}
                        aria-label={agentAriaLabel(agent, workspaceName, now)}
                        onClick={() => {
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
                        <span className="agent-row-main">
                          <span className="agent-state-dot" aria-hidden="true" />
                          <span className="agent-name">{agent.displayName}</span>
                          <span className="agent-state">{status}</span>
                          <span className="agent-elapsed">{elapsed}</span>
                        </span>
                        <span className="agent-context">
                          {workspaceName}
                          {agent.message ? ` · ${agent.message}` : ''}
                        </span>
                      </button>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  )
}
