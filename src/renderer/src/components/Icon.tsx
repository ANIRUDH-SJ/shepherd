import type { ReactNode } from 'react'

export type IconName =
  | 'add'
  | 'collapse'
  | 'rename'
  | 'close'
  | 'branch'
  | 'agents'
  | 'terminal'
  | 'split-right'
  | 'split-down'
  | 'bell'
  | 'check'

interface Props {
  name: IconName
}

function iconPaths(name: IconName): ReactNode {
  switch (name) {
    case 'add':
      return (
        <>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </>
      )
    case 'collapse':
      return (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16" />
          <path d="m16 9-3 3 3 3" />
        </>
      )
    case 'rename':
      return (
        <>
          <path d="m14.5 5.5 4 4" />
          <path d="M4 20h4l10.5-10.5a2.83 2.83 0 0 0-4-4L4 16v4Z" />
        </>
      )
    case 'close':
      return (
        <>
          <path d="m7 7 10 10" />
          <path d="M17 7 7 17" />
        </>
      )
    case 'branch':
      return (
        <>
          <circle cx="6" cy="5" r="2" />
          <circle cx="18" cy="6" r="2" />
          <circle cx="6" cy="19" r="2" />
          <path d="M6 7v10" />
          <path d="M8 17c6 0 4-9 8-9" />
        </>
      )
    case 'agents':
      return (
        <>
          <rect x="4" y="7" width="16" height="12" rx="3" />
          <path d="M9 11h.01M15 11h.01" />
          <path d="M9 15h6M12 7V4M9 4h6" />
        </>
      )
    case 'terminal':
      return (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="m7 9 3 3-3 3" />
          <path d="M13 15h4" />
        </>
      )
    case 'split-right':
      return (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M12 4v16" />
          <path d="m15 9 3 3-3 3" />
        </>
      )
    case 'split-down':
      return (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 12h18" />
          <path d="m9 15 3 3 3-3" />
        </>
      )
    case 'bell':
      return (
        <>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M10 21h4" />
        </>
      )
    case 'check':
      return <path d="m5 12 4 4L19 6" />
  }
}

export default function Icon({ name }: Props): React.JSX.Element {
  return (
    <svg
      className="ui-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {iconPaths(name)}
    </svg>
  )
}
