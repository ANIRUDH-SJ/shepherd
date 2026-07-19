/// <reference types="node" />

import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

const requiredTokens = [
  '--font-ui',
  '--font-mono',
  '--color-canvas',
  '--color-sidebar',
  '--color-surface',
  '--color-surface-hover',
  '--color-border',
  '--color-text',
  '--color-text-muted',
  '--color-accent',
  '--color-focus',
  '--color-attention',
  '--color-danger',
  '--color-success',
  '--color-info',
  '--space-4',
  '--radius-md',
  '--shadow-popover',
  '--transition-fast'
]

for (const token of requiredTokens) {
  assert(css.includes(`${token}:`), `declares ${token}`)
  assert(css.includes(`var(${token})`), `consumes ${token}`)
}

const rootBlock = css.match(/:root\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
const componentCss = css.replace(rootBlock, '')
assert(rootBlock.length > 0, 'defines a root token boundary')
assert(
  !/(?:#[\da-f]{3,8}|rgba?\()/i.test(componentCss),
  'keeps raw color values inside the token boundary'
)
assert(css.includes('@media (prefers-reduced-motion: reduce)'), 'preserves reduced motion')

console.log(failures === 0 ? '\n✅ ALL THEME TOKEN TESTS PASS' : `\n❌ ${failures} FAILURE(S)`)
if (failures > 0) throw new Error(`${failures} theme-token test(s) failed`)
