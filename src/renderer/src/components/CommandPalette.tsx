import { useEffect, useMemo, useRef, useState } from 'react'
import { commandEnabled, rankCommands, type AppCommandId, type CommandContext } from '../commands'
import DialogFrame from './DialogFrame'

interface Props {
  context: CommandContext
  onExecute: (id: AppCommandId) => void
  onClose: () => void
}

function optionId(commandId: AppCommandId): string {
  return `command-option-${commandId.replace('.', '-')}`
}

export default function CommandPalette({ context, onExecute, onClose }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const selectedRef = useRef<HTMLButtonElement | null>(null)
  const commands = useMemo(() => rankCommands(query, context), [context, query])
  const selectedIndex = commands.length === 0 ? -1 : Math.min(activeIndex, commands.length - 1)
  const selected = selectedIndex < 0 ? undefined : commands[selectedIndex]

  const execute = (id: AppCommandId): void => {
    if (commandEnabled(id, context)) onExecute(id)
  }

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected?.id])

  return (
    <DialogFrame title="Command palette" className="command-palette" onClose={onClose}>
      <div className="command-search">
        <input
          ref={inputRef}
          data-dialog-autofocus
          role="combobox"
          aria-label="Search commands"
          aria-controls="command-results"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-activedescendant={selected ? optionId(selected.id) : undefined}
          placeholder="Type a command"
          value={query}
          maxLength={120}
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveIndex(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && commands.length > 0) {
              event.preventDefault()
              setActiveIndex((index) => (index + 1) % commands.length)
            } else if (event.key === 'ArrowUp' && commands.length > 0) {
              event.preventDefault()
              setActiveIndex((index) => (index - 1 + commands.length) % commands.length)
            } else if (event.key === 'Home' && commands.length > 0) {
              event.preventDefault()
              setActiveIndex(0)
            } else if (event.key === 'End' && commands.length > 0) {
              event.preventDefault()
              setActiveIndex(commands.length - 1)
            } else if (event.key === 'Enter' && selected) {
              event.preventDefault()
              execute(selected.id)
            }
          }}
        />
        <kbd>Esc</kbd>
      </div>
      <div id="command-results" className="command-results" role="listbox" aria-label="Commands">
        {commands.length === 0 ? (
          <p className="utility-empty">No matching commands</p>
        ) : (
          commands.map((command, index) => {
            const enabled = commandEnabled(command.id, context)
            return (
              <button
                key={command.id}
                id={optionId(command.id)}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={index === selectedIndex}
                aria-disabled={!enabled}
                className={index === selectedIndex ? 'selected' : ''}
                ref={index === selectedIndex ? selectedRef : undefined}
                onMouseMove={() => setActiveIndex(index)}
                onClick={() => execute(command.id)}
              >
                <span>
                  <strong>{command.title}</strong>
                  <small>{enabled ? command.category : `${command.category} · unavailable`}</small>
                </span>
                {command.shortcut && <kbd>{command.shortcut}</kbd>}
              </button>
            )
          })
        )}
      </div>
    </DialogFrame>
  )
}
