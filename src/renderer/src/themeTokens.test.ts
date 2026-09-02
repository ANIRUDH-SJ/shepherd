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
  '--color-backdrop',
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
const lightBlock = css.match(/:root\[data-theme='light'\]\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
const componentCss = css.replace(rootBlock, '').replace(lightBlock, '')
assert(rootBlock.length > 0, 'defines a root token boundary')
assert(lightBlock.length > 0, 'defines a light token boundary')
assert(
  !/(?:#[\da-f]{3,8}|rgba?\()/i.test(componentCss),
  'keeps raw color values inside the token boundary'
)
assert(css.includes('@media (prefers-reduced-motion: reduce)'), 'preserves reduced motion')

function token(name: string): string {
  return rootBlock.match(new RegExp(`${name}:\\s*([^;]+)`))?.[1]?.trim() ?? ''
}

function lightToken(name: string): string {
  return lightBlock.match(new RegExp(`${name}:\\s*([^;]+)`))?.[1]?.trim() ?? ''
}

function rgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '')
  if (!/^[\da-f]{6}$/i.test(normalized)) throw new Error(`invalid test color: ${hex}`)
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16)) as [
    number,
    number,
    number
  ]
}

function luminance(hex: string): number {
  const channels = rgb(hex).map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrast(left: string, right: string): number {
  const light = Math.max(luminance(left), luminance(right))
  const dark = Math.min(luminance(left), luminance(right))
  return (light + 0.05) / (dark + 0.05)
}

for (const name of [
  '--color-canvas',
  '--color-sidebar',
  '--color-surface',
  '--color-surface-hover',
  '--color-surface-raised',
  '--color-border',
  '--color-border-strong'
]) {
  const channels = rgb(token(name))
  assert(Math.max(...channels) - Math.min(...channels) <= 8, `${name} stays low-chroma graphite`)
}

assert(token('--color-canvas') === '#272823', 'uses the measured cmux terminal backdrop')
assert(
  token('--color-sidebar') === token('--color-canvas'),
  'sidebar derives from the terminal backdrop'
)
assert(token('--color-surface') === token('--color-canvas'), 'permanent chrome shares one backdrop')

for (const name of [
  '--color-accent',
  '--color-accent-strong',
  '--color-selection',
  '--color-selection-hover',
  '--color-selection-text',
  '--color-focus',
  '--color-attention',
  '--color-info',
  '--color-git'
]) {
  const [red, green, blue] = rgb(token(name))
  assert(blue - Math.max(red, green) <= 8, `${name} has no blue cast`)
}

assert(token('--color-selection') === '#393a34', 'selection uses measured graphite contrast')
assert(token('--color-selection-text') === '#dededd', 'selection uses neutral readable text')

assert(
  contrast(token('--color-text'), token('--color-canvas')) >= 10,
  'primary text has strong canvas contrast'
)
assert(
  contrast(token('--color-text-secondary'), token('--color-sidebar')) >= 7,
  'secondary text has strong sidebar contrast'
)
assert(
  contrast(token('--color-text-muted'), token('--color-sidebar')) >= 4.5,
  'muted text remains readable on the sidebar'
)
assert(
  contrast(token('--color-focus'), token('--color-canvas')) >= 4.5,
  'keyboard focus remains distinct on the canvas'
)
assert(token('--radius-md') === '4px', 'uses restrained default corner geometry')
assert(lightBlock.includes('color-scheme: light'), 'light appearance advertises native light chrome')
assert(
  contrast(lightToken('--color-text'), lightToken('--color-canvas')) >= 10,
  'light primary text has strong canvas contrast'
)
assert(
  contrast(lightToken('--color-text-muted'), lightToken('--color-sidebar')) >= 4.5,
  'light muted text remains readable on the sidebar'
)
assert(!/text-transform:\s*uppercase/i.test(componentCss), 'avoids uppercase navigation chrome')
assert(
  /button:focus-visible,\s*input:focus-visible\s*\{[^}]*outline:\s*1px solid var\(--color-focus\)/m.test(
    componentCss
  ),
  'every native control uses the accessible focus token'
)

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return componentCss.match(new RegExp(`${escaped}\\s*\\{([^}]+)`, 'm'))?.[1] ?? ''
}

assert(rule('.ws-row:hover').includes('var(--color-surface-hover)'), 'ordinary hover is neutral')
assert(rule('.ws-row.active').includes('var(--color-selection)'), 'workspace selection is explicit')
assert(
  rule('.ws-row.active').includes('var(--color-selection-text)'),
  'selected workspace is readable'
)
assert(
  !rule('.ws-row.active').includes('box-shadow'),
  'workspace selection avoids a redundant rail'
)
assert(!rule('.tab.active').includes('background'), 'active tabs remain on the shared backdrop')
assert(
  rule('.tab.active').includes('var(--color-border-strong)'),
  'active tabs use one restrained neutral edge'
)
assert(
  rule('.pane-attention-ring').includes('pane-attention-pulse'),
  'attention owns one bounded pane pulse'
)
assert(!componentCss.includes('infinite'), 'no shell attention state animates indefinitely')
assert(
  rule('.attention-item.state-blocked .attention-marker').includes('var(--color-danger)'),
  'blocked attention owns failure color'
)
assert(
  rule('.attention-marker').includes('var(--color-info)'),
  'completed attention owns a restrained information color'
)
assert(
  rule('.ws-summary').includes('var(--color-text-muted)'),
  'workspace agent states remain readable as semantic text rather than color alone'
)

console.log(failures === 0 ? '\n✅ ALL THEME TOKEN TESTS PASS' : `\n❌ ${failures} FAILURE(S)`)
if (failures > 0) throw new Error(`${failures} theme-token test(s) failed`)
