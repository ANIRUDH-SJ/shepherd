import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react'
import { RENDERER_EVENT } from '../events'
import { workspaceIdentity } from '../sidebarView'
import {
  latestUnreadNotification,
  pendingNotifications,
  workspaceNotificationCounts,
  type InboxNotification
} from '../state/notificationInbox'
import type { AppAction, Workspace } from '../state/appReducer'
import Icon from './Icon'

interface Props {
  notifications: InboxNotification[]
  workspaces: Workspace[]
  activeWorkspaceId: string
  dispatch: Dispatch<AppAction>
}

function formatNotificationTime(createdAt: number): string {
  return new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function NotificationCenter({
  notifications,
  workspaces,
  activeWorkspaceId,
  dispatch
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const pending = useMemo(() => pendingNotifications(notifications), [notifications])
  const latestUnread = useMemo(() => latestUnreadNotification(notifications), [notifications])
  const unreadCount = pending.reduce((total, notification) => total + Number(notification.unread), 0)
  const resolvedCount = notifications.length - pending.length
  const currentCounts = workspaceNotificationCounts(notifications, activeWorkspaceId)

  const close = (restoreFocus: boolean): void => {
    setOpen(false)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const focusNotification = (notification: InboxNotification): void => {
    dispatch({ type: 'focusNotification', id: notification.id })
    close(false)
    if (notification.surfaceId) {
      requestAnimationFrame(() => {
        window.dispatchEvent(
          new CustomEvent(RENDERER_EVENT.focusSurface, { detail: notification.surfaceId })
        )
      })
    }
  }

  useEffect(() => {
    if (!open) return
    const popover = popoverRef.current
    const firstTarget = popover?.querySelector<HTMLElement>('[data-notification-primary]')
    ;(firstTarget ?? popover?.querySelector<HTMLElement>('button'))?.focus()

    const onPointerDown = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        !popoverRef.current?.contains(event.target) &&
        !triggerRef.current?.contains(event.target)
      ) {
        close(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close(true)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="notification-center">
      <button
        ref={triggerRef}
        type="button"
        className="icon-btn notification-trigger"
        title="Notifications"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={open}
        aria-controls="notification-popover"
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="bell" />
        {unreadCount > 0 && (
          <span className="notification-trigger-badge" aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          id="notification-popover"
          ref={popoverRef}
          className="notification-popover"
          role="dialog"
          aria-modal="false"
          aria-labelledby="notification-title"
        >
          <div className="notification-head">
            <strong id="notification-title">Notifications</strong>
            <span role="status" aria-live="polite">
              {unreadCount} unread · {pending.length} pending
            </span>
          </div>

          <div className="notification-toolbar" aria-label="Notification actions">
            <button
              type="button"
              disabled={!latestUnread}
              onClick={() => latestUnread && focusNotification(latestUnread)}
            >
              Jump to unread
            </button>
            <button
              type="button"
              disabled={currentCounts.unread === 0}
              onClick={() =>
                dispatch({ type: 'markWorkspaceNotificationsRead', id: activeWorkspaceId })
              }
            >
              Mark current read
            </button>
          </div>

          {pending.length > 0 ? (
            <ul className="notification-list" aria-label="Pending notifications">
              {pending.map((notification) => {
                const workspaceIndex = workspaces.findIndex(
                  (workspace) => workspace.id === notification.workspaceId
                )
                const workspace = workspaces[workspaceIndex]
                const workspaceName = workspace
                  ? workspaceIdentity(workspace, workspaceIndex).primary
                  : 'Closed workspace'
                return (
                  <li
                    key={notification.id}
                    className={'notification-item' + (notification.unread ? ' unread' : '')}
                  >
                    <button
                      type="button"
                      className="notification-open"
                      data-notification-primary
                      onClick={() => focusNotification(notification)}
                      aria-label={`${notification.unread ? 'Unread' : 'Pending'} notification for ${workspaceName}: ${notification.title}. ${notification.body}`}
                    >
                      <span className="notification-item-head">
                        <span className="notification-workspace">
                          {notification.unread && <span className="notification-dot" />}
                          {workspaceName}
                        </span>
                        <time dateTime={new Date(notification.createdAt).toISOString()}>
                          {formatNotificationTime(notification.createdAt)}
                        </time>
                      </span>
                      <strong>{notification.title}</strong>
                      <span className="notification-body">{notification.body}</span>
                      <span className="notification-meta">
                        {notification.unread ? 'Unread' : 'Pending'} ·{' '}
                        {notification.sources.join(' + ')}
                        {notification.occurrences > 1 ? ` · ×${notification.occurrences}` : ''}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="notification-resolve"
                      title={`Resolve ${notification.title}`}
                      aria-label={`Resolve notification: ${notification.title}`}
                      onClick={() => dispatch({ type: 'resolveNotification', id: notification.id })}
                    >
                      <Icon name="check" />
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="notification-empty" role="status">
              {resolvedCount > 0 ? 'All pending notifications cleared.' : 'No notifications.'}
            </div>
          )}

          <div className="notification-footer">
            <button
              type="button"
              disabled={resolvedCount === 0}
              onClick={() => dispatch({ type: 'clearResolvedNotifications' })}
            >
              Clear resolved ({resolvedCount})
            </button>
            <button type="button" onClick={() => close(true)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
