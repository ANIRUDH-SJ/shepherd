import type { Dispatch } from 'react'
import type { AgentRecord } from '../../../shared/agent'
import { agentAriaLabel, agentStatusLabel, sortAgentsForSidebar } from '../agentView'
import type { AppAction, Workspace } from '../state/appReducer'

interface Props {
  agents: AgentRecord[]
  workspaces: Workspace[]
  dispatch: Dispatch<AppAction>
}

export default function AgentList({ agents, workspaces, dispatch }: Props): React.JSX.Element {
  const workspaceNames = new Map(
    workspaces.map((workspace, index) => [workspace.id, workspace.name || `workspace ${index + 1}`])
  )
  const ordered = sortAgentsForSidebar(agents)

  return (
    <section className="agent-section" aria-labelledby="agent-section-title">
      <div className="agent-section-head">
        <span id="agent-section-title">agents</span>
        <span>{agents.length === 0 ? 'none' : `${agents.length} grouped`}</span>
      </div>
      {ordered.length === 0 ? (
        <div className="agent-empty">no agents reported</div>
      ) : (
        <div className="agent-list" role="list">
          {ordered.map((agent) => {
            const workspaceName = workspaceNames.get(agent.workspaceId) ?? 'unknown workspace'
            const status = agentStatusLabel(agent)
            return (
              <div key={agent.agentId} role="listitem">
                <button
                  type="button"
                  className={`agent-row state-${agent.state}`}
                  title={agent.message ?? `${agent.displayName} · ${status} · ${workspaceName}`}
                  aria-label={agentAriaLabel(agent, workspaceName)}
                  onClick={() => {
                    dispatch({ type: 'focusAgent', id: agent.agentId })
                    window.requestAnimationFrame(() => {
                      window.dispatchEvent(
                        new CustomEvent('cmux:focus-surface', { detail: agent.surfaceId })
                      )
                    })
                  }}
                >
                  <span className="agent-row-main">
                    <span className="agent-state-dot" aria-hidden="true" />
                    <span className="agent-name">{agent.displayName}</span>
                    <span className="agent-state">{status}</span>
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
      )}
    </section>
  )
}
