/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { captureThemeForExport } from './themeFileExport'
import { THEME_PRESETS } from './themePresets'

const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')
const attributes = new Map([
  ['data-theme', 'dark'],
  ['data-theme-preset', 'system'],
  ['data-high-contrast', '']
])
const root = {
  getAttribute: (name: string) => attributes.get(name) ?? null,
  setAttribute: (name: string, value: string) => {
    attributes.set(name, value)
  },
  removeAttribute: (name: string) => {
    attributes.delete(name)
  },
  dataset: {
    get theme() {
      return attributes.get('data-theme') ?? ''
    },
    set theme(value: string) {
      attributes.set('data-theme', value)
    },
    get themePreset() {
      return attributes.get('data-theme-preset') ?? ''
    },
    set themePreset(value: string) {
      attributes.set('data-theme-preset', value)
    }
  }
}
const globals = globalThis as unknown as {
  document: { documentElement: typeof root }
  getComputedStyle: () => { getPropertyValue: (name: string) => string }
}
globals.document = { documentElement: root }
globals.getComputedStyle = () => {
  const blocks = [css.match(/:root\s*\{[\s\S]*?\n\}/)?.[0] ?? '']
  if (root.dataset.theme === 'light')
    blocks.push(css.match(/:root\[data-theme='light'\]\s*\{[\s\S]*?\n\}/)?.[0] ?? '')
  if (root.dataset.themePreset !== 'system') {
    const expression = new RegExp(
      `:root\\[data-theme-preset='${root.dataset.themePreset}'\\]\\[data-theme='${root.dataset.theme}'\\]\\s*\\{[\\s\\S]*?\\n\\}`
    )
    blocks.push(css.match(expression)?.[0] ?? '')
  }
  const colors = new Map<string, string>()
  for (const block of blocks)
    for (const match of block.matchAll(/(--color-[a-z-]+):\s*(#[0-9a-f]{6})/gi))
      colors.set(match[1], match[2])
  return { getPropertyValue: (name: string) => colors.get(name) ?? '' }
}

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}
for (const preset of THEME_PRESETS) {
  const theme = captureThemeForExport(preset.id)
  assert(theme.name === preset.label, `${preset.label} exports by name`)
  assert(
    theme.dark.chrome.canvas === theme.dark.terminal.background,
    `${preset.label} dark chrome and terminal agree`
  )
  assert(
    theme.light.chrome.canvas === theme.light.terminal.background,
    `${preset.label} light chrome and terminal agree`
  )
}
assert(attributes.get('data-theme') === 'dark', 'restores application appearance')
assert(attributes.get('data-theme-preset') === 'system', 'restores selected preset')
assert(attributes.has('data-high-contrast'), 'restores high-contrast mode')
if (failures) process.exitCode = 1
