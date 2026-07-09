import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Flat-config ESLint (v9). Minimal for M0: JS + TypeScript recommended rules.
// React-specific rules get added when real components arrive (M2+).
export default tseslint.config(
  { ignores: ['out', 'dist', 'dist-typecheck', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser }
    }
  },
  // The `cmux` CLI is plain CommonJS — it runs under bare Node (or Electron in
  // ELECTRON_RUN_AS_NODE mode), never through the bundler.
  {
    files: ['bin/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  }
)
