import {
  tabNavigationTarget,
  terminalPanelId,
  terminalTabId,
  terminalWorkspaceAriaLabel
} from './terminalChrome'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  ok:', message)
  else {
    console.error('FAIL:', message)
    failures++
  }
}

const ids = ['term-a', 'term-b', 'term-c']
assert(tabNavigationTarget(ids, 'term-b', 'ArrowLeft') === 'term-a', 'moves to the left tab')
assert(tabNavigationTarget(ids, 'term-b', 'ArrowRight') === 'term-c', 'moves to the right tab')
assert(tabNavigationTarget(ids, 'term-a', 'ArrowLeft') === 'term-c', 'wraps left navigation')
assert(tabNavigationTarget(ids, 'term-c', 'ArrowRight') === 'term-a', 'wraps right navigation')
assert(tabNavigationTarget(ids, 'term-b', 'Home') === 'term-a', 'moves Home to the first tab')
assert(tabNavigationTarget(ids, 'term-b', 'End') === 'term-c', 'moves End to the last tab')
assert(tabNavigationTarget(ids, 'term-b', 'Enter') === undefined, 'ignores non-navigation keys')
assert(tabNavigationTarget([], 'term-a', 'ArrowRight') === undefined, 'handles an empty tab list')
assert(terminalTabId('term-a') === 'terminal-tab-term-a', 'derives a stable tab id')
assert(terminalPanelId('term-a') === 'terminal-panel-term-a', 'derives a stable panel id')
assert(
  terminalWorkspaceAriaLabel('shepherd', 1, 1) === 'shepherd, 1 pane, 1 terminal',
  'labels a compact single-terminal workspace accessibly'
)
assert(
  terminalWorkspaceAriaLabel('review', 4, 6) === 'review, 4 panes, 6 terminals',
  'pluralizes compact workspace counts'
)

assert(
  terminalWorkspaceAriaLabel('empty', 0, 0) === 'empty, 0 panes, 0 terminals',
  'labels an empty workspace view'
)

if (failures > 0) throw new Error(`${failures} terminal-chrome test(s) failed`)
console.log('\n✅ ALL TERMINAL CHROME TESTS PASS')
