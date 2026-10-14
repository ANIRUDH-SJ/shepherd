import { strict as assert } from 'node:assert'
import {
  MAX_WORKSPACE_TEMPLATES,
  normalizeWorkspaceCommand,
  normalizeWorkspaceTemplate,
  normalizeWorkspaceTemplates
} from './workspaceTemplates'

const valid = {
  id: 'template-1',
  name: 'Web app',
  cwd: '/projects/web',
  setupCommand: 'npm install',
  runCommand: 'npm run dev'
}
assert.deepEqual(normalizeWorkspaceTemplate(valid), valid)
assert.equal(normalizeWorkspaceTemplate({ ...valid, cwd: 'relative/path' }), null)
assert.equal(normalizeWorkspaceTemplate({ ...valid, setupCommand: '', runCommand: '' }), null)
assert.equal(normalizeWorkspaceCommand('npm test\nrm -rf /'), null)
assert.equal(normalizeWorkspaceCommand('a'.repeat(501)), null)
assert.equal(normalizeWorkspaceTemplates([valid, valid, { ...valid, id: 'other' }]).length, 2)
assert.equal(
  normalizeWorkspaceTemplates(
    Array.from({ length: MAX_WORKSPACE_TEMPLATES + 5 }, (_, index) => ({
      ...valid,
      id: `template-${index}`
    }))
  ).length,
  MAX_WORKSPACE_TEMPLATES
)
console.log('✅ ALL WORKSPACE TEMPLATE TESTS PASS')
