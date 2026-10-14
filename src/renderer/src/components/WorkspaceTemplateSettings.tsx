import { useState } from 'react'
import {
  MAX_WORKSPACE_TEMPLATES,
  normalizeWorkspaceTemplate,
  saveWorkspaceTemplates,
  type WorkspaceTemplate,
  type WorkspaceTemplateDraft
} from '../workspaceTemplates'

interface Props {
  templates: WorkspaceTemplate[]
  defaultDirectory: string
  onChange: (templates: WorkspaceTemplate[]) => void
  onUse: (template: WorkspaceTemplate) => void
}

const emptyDraft: WorkspaceTemplateDraft = {
  name: '',
  cwd: '',
  setupCommand: '',
  runCommand: ''
}

export default function WorkspaceTemplateSettings({
  templates,
  defaultDirectory,
  onChange,
  onUse
}: Props): React.JSX.Element {
  const [draft, setDraft] = useState<WorkspaceTemplateDraft>({
    ...emptyDraft,
    cwd: defaultDirectory.startsWith('/') ? defaultDirectory : ''
  })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const update = (patch: Partial<WorkspaceTemplateDraft>): void => {
    setDraft((current) => ({ ...current, ...patch }))
    setError('')
  }

  const persist = (next: WorkspaceTemplate[]): void => {
    saveWorkspaceTemplates(next)
    onChange(next)
  }

  const save = (event: React.FormEvent): void => {
    event.preventDefault()
    if (!editingId && templates.length >= MAX_WORKSPACE_TEMPLATES) {
      setError(`Limit reached (${MAX_WORKSPACE_TEMPLATES} templates).`)
      return
    }
    const template = normalizeWorkspaceTemplate({
      ...draft,
      id: editingId ?? crypto.randomUUID()
    })
    if (!template) {
      setError('Choose a folder, name the template, and add a one-line Setup or Run command.')
      return
    }
    persist(
      editingId
        ? templates.map((item) => (item.id === editingId ? template : item))
        : [...templates, template]
    )
    setEditingId(null)
    setDraft(emptyDraft)
    setError('')
  }

  return (
    <section className="settings-group">
      <div className="settings-setting-head">
        <span>
          <strong>Workspace templates</strong>
          <small>
            Saved locally. Commands run only when you choose Setup or Run in a workspace.
          </small>
        </span>
        <span className="settings-value">
          {templates.length}/{MAX_WORKSPACE_TEMPLATES}
        </span>
      </div>
      {templates.length > 0 && (
        <ul className="workspace-template-list" aria-label="Saved workspace templates">
          {templates.map((template) => (
            <li key={template.id}>
              <span>
                <strong>{template.name}</strong>
                <code title={template.cwd}>{template.cwd}</code>
              </span>
              <div>
                <button type="button" onClick={() => onUse(template)}>
                  Open
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(template.id)
                    setDraft({
                      name: template.name,
                      cwd: template.cwd,
                      setupCommand: template.setupCommand,
                      runCommand: template.runCommand
                    })
                    setError('')
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${template.name} template`}
                  onClick={() => {
                    if (!window.confirm(`Delete the “${template.name}” template?`)) return
                    persist(templates.filter((item) => item.id !== template.id))
                    if (editingId === template.id) {
                      setEditingId(null)
                      setDraft(emptyDraft)
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form className="workspace-template-form" onSubmit={save}>
        <h3>{editingId ? 'Edit template' : 'New template'}</h3>
        <label>
          Name
          <input
            value={draft.name}
            maxLength={80}
            onChange={(event) => update({ name: event.target.value })}
            placeholder="Web app"
          />
        </label>
        <label>
          Repository folder
          <span className="workspace-template-directory">
            <input value={draft.cwd} readOnly placeholder="Choose a folder" />
            <button
              type="button"
              onClick={() => {
                void window.api.workspace
                  .chooseDirectory()
                  .then((directory) => {
                    if (directory) update({ cwd: directory })
                  })
                  .catch(() => setError('Could not open the folder picker. Try again.'))
              }}
            >
              Browse…
            </button>
          </span>
        </label>
        <label>
          Setup command <small>(optional)</small>
          <input
            value={draft.setupCommand}
            maxLength={500}
            onChange={(event) => update({ setupCommand: event.target.value })}
            placeholder="npm install"
            spellCheck={false}
          />
        </label>
        <label>
          Run command <small>(optional)</small>
          <input
            value={draft.runCommand}
            maxLength={500}
            onChange={(event) => update({ runCommand: event.target.value })}
            placeholder="npm run dev"
            spellCheck={false}
          />
        </label>
        {error && (
          <p className="settings-form-error" role="alert">
            {error}
          </p>
        )}
        <div className="workspace-template-form-actions">
          <button type="submit">{editingId ? 'Save changes' : 'Save template'}</button>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null)
                setDraft(emptyDraft)
                setError('')
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
