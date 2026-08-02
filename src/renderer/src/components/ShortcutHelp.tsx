import { APP_COMMANDS, commandEnabled, type CommandContext } from '../commands'
import DialogFrame from './DialogFrame'

interface Props {
  context: CommandContext
  onOpenPalette: () => void
  onClose: () => void
}

export default function ShortcutHelp({
  context,
  onOpenPalette,
  onClose
}: Props): React.JSX.Element {
  const commands = APP_COMMANDS.filter(
    (command) => command.shortcut && commandEnabled(command.id, context)
  )
  return (
    <DialogFrame
      title="Keyboard shortcuts"
      descriptionId="shortcut-help-description"
      className="shortcut-help"
      onClose={onClose}
    >
      <p id="shortcut-help-description" className="utility-description">
        Commands available for the current workspace. Terminal Ctrl keys remain untouched.
      </p>
      <dl className="shortcut-list">
        {commands.map((command) => (
          <div key={command.id}>
            <dt>{command.title}</dt>
            <dd>
              <kbd>{command.shortcut}</kbd>
            </dd>
          </div>
        ))}
      </dl>
      <footer className="utility-dialog-footer">
        <button type="button" data-dialog-autofocus onClick={onOpenPalette}>
          Open command palette
        </button>
      </footer>
    </DialogFrame>
  )
}
