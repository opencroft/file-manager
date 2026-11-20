import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { FileEntry } from '../components/ui/file-manager/file-entry-row'
import {
  compareEntries,
  NO_SELECTION,
  type Selection,
  selectionAfter,
  selectionForMenu,
  selectionWithin,
} from '../components/ui/file-manager/use-file-browser'

// The listing as shown: a, b, c, d, e.
const ORDER = ['a', 'b', 'c', 'd', 'e']
const CLICK = { toggle: false, range: false }
const CTRL = { toggle: true, range: false }
const SHIFT = { toggle: false, range: true }
const CTRL_SHIFT = { toggle: true, range: true }

// Gestures applied one after another from nothing selected.
function after(...steps: [string, typeof CLICK][]): Selection {
  return steps.reduce((selection, [id, gesture]) => selectionAfter(selection, ORDER, id, gesture), NO_SELECTION)
}

test('a click selects that entry alone and anchors there', () => {
  assert.deepEqual(after(['b', CLICK], ['d', CLICK]), { ids: ['d'], anchor: 'd', touch: false })
})

test('Ctrl+click adds an entry and removes it again, leaving the rest', () => {
  assert.deepEqual(after(['a', CLICK], ['c', CTRL]).ids, ['a', 'c'])
  assert.deepEqual(after(['a', CLICK], ['c', CTRL], ['a', CTRL]).ids, ['c'])
})

test('Shift+click selects the range from the anchor, either direction, replacing the selection', () => {
  assert.deepEqual(after(['b', CLICK], ['d', SHIFT]).ids, ['b', 'c', 'd'])
  assert.deepEqual(after(['d', CLICK], ['b', SHIFT]).ids, ['b', 'c', 'd'])
  assert.deepEqual(
    after(['a', CLICK], ['e', CTRL], ['c', SHIFT]).ids,
    ['c', 'd', 'e'],
    'the Ctrl+click moved the anchor to e',
  )
})

test('the anchor stays put across Shift+clicks, so a second one re-spans from it', () => {
  const selection = after(['b', CLICK], ['e', SHIFT], ['c', SHIFT])
  assert.deepEqual(selection, { ids: ['b', 'c'], anchor: 'b', touch: false })
})

test('Ctrl+Shift+click adds the range to the selection', () => {
  assert.deepEqual(after(['a', CLICK], ['d', CTRL], ['e', CTRL_SHIFT]).ids, ['a', 'd', 'e'])
  assert.deepEqual(after(['e', CLICK], ['b', CTRL], ['c', CTRL_SHIFT]).ids, ['e', 'b', 'c'])
})

test('Shift+click with no anchor selects the entry as a click does', () => {
  assert.deepEqual(after(['c', SHIFT]), { ids: ['c'], anchor: 'c', touch: false })
})

test('a range spans the order it is given, which is the listing sorted as shown', () => {
  const entries: FileEntry[] = [
    { id: 'big', name: 'big.bin', kind: 'file', sizeBytes: 900 },
    { id: 'small', name: 'small.txt', kind: 'file', sizeBytes: 1 },
    { id: 'mid', name: 'mid.md', kind: 'file', sizeBytes: 50 },
  ]
  const bySize = [...entries].sort(compareEntries({ key: 'size', direction: 'asc' })).map((e) => e.id)
  const start = selectionAfter(NO_SELECTION, bySize, 'small', CLICK)
  assert.deepEqual(
    selectionAfter(start, bySize, 'mid', SHIFT).ids,
    ['small', 'mid'],
    'by name, big would sit between them',
  )
})

test('an entry the listing no longer holds drops out, and its anchor with it', () => {
  const selection = after(['b', CLICK], ['d', SHIFT])
  assert.deepEqual(selectionWithin(selection, ['a', 'b', 'd', 'e']).ids, ['b', 'd'])
  const anchorGone = selectionWithin(selection, ['a', 'c', 'd'])
  assert.deepEqual(anchorGone, { ids: ['c', 'd'], anchor: null, touch: false })
  assert.equal(selectionWithin(selection, ORDER), selection, 'unchanged when every entry is still there')
})

test('right-click outside the selection makes that entry the selection alone; inside, keeps it', () => {
  const three = after(['a', CLICK], ['c', SHIFT])
  assert.deepEqual(selectionForMenu(three, ORDER, 'e', false), { ids: ['e'], anchor: 'e', touch: false })
  assert.equal(selectionForMenu(three, ORDER, 'b', false), three)
})

test('a long press turns on selection mode, where taps add and remove entries', () => {
  let selection = selectionForMenu(NO_SELECTION, ORDER, 'b', true)
  assert.deepEqual(selection, { ids: ['b'], anchor: 'b', touch: true })
  selection = selectionAfter(selection, ORDER, 'd', CLICK)
  selection = selectionAfter(selection, ORDER, 'e', CLICK)
  assert.deepEqual(selection.ids, ['b', 'd', 'e'])
  selection = selectionAfter(selection, ORDER, 'd', CLICK)
  assert.deepEqual(selection, { ids: ['b', 'e'], anchor: 'd', touch: true })
})

test('a long press on another entry in selection mode adds it rather than replacing the selection', () => {
  const selection = selectionForMenu(selectionForMenu(NO_SELECTION, ORDER, 'a', true), ORDER, 'c', true)
  assert.deepEqual(selection, { ids: ['a', 'c'], anchor: 'c', touch: true })
})

test('selection mode ends when its last entry is tapped off, so the next tap selects alone', () => {
  let selection = selectionForMenu(NO_SELECTION, ORDER, 'b', true)
  selection = selectionAfter(selection, ORDER, 'b', CLICK)
  assert.deepEqual(selection, { ids: [], anchor: 'b', touch: false })
  selection = selectionAfter(selectionAfter(selection, ORDER, 'c', CLICK), ORDER, 'd', CLICK)
  assert.deepEqual(selection.ids, ['d'])
})
