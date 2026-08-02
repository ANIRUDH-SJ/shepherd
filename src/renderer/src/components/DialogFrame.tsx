import { useEffect, useRef, type ReactNode } from 'react'
import Icon from './Icon'

interface Props {
  title: string
  descriptionId?: string
  className?: string
  children: ReactNode
  onClose: () => void
}

export default function DialogFrame({
  title,
  descriptionId,
  className = '',
  children,
  onClose
}: Props): React.JSX.Element {
  const dialogRef = useRef<HTMLElement | null>(null)
  const restoreFocusRef = useRef(
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  )

  useEffect(() => {
    const initial =
      dialogRef.current?.querySelector<HTMLElement>('[data-dialog-autofocus]') ??
      dialogRef.current?.querySelector<HTMLElement>('button, input, select, [tabindex="0"]')
    initial?.focus()
    return () => {
      requestAnimationFrame(() => {
        if (!document.querySelector('.utility-dialog')) restoreFocusRef.current?.focus()
      })
    }
  }, [])

  const trapFocus = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]'
      ) ?? [])
    ]
    if (focusable.length === 0) return
    const current = focusable.indexOf(document.activeElement as HTMLElement)
    const base = current < 0 ? (event.shiftKey ? 0 : -1) : current
    const next = event.shiftKey
      ? (base - 1 + focusable.length) % focusable.length
      : (base + 1) % focusable.length
    event.preventDefault()
    focusable[next]?.focus()
  }

  return (
    <div
      className="utility-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={dialogRef}
        className={`utility-dialog ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={descriptionId}
        onKeyDown={trapFocus}
      >
        <header className="utility-dialog-head">
          <strong>{title}</strong>
          <button
            type="button"
            aria-label={`Close ${title}`}
            title="Close (Escape)"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}
