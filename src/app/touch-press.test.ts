import assert from 'node:assert/strict'
import { test } from 'node:test'

import { rowPress } from '../components/ui/file-manager/file-entry-row'
import {
  NO_SELECTION,
  selectionAfter,
  selectionForMenu,
  tapAction,
} from '../components/ui/file-manager/use-file-browser'

// The listing as shown: a, b, c.
const ORDER = ['a', 'b', 'c']
const TOGGLE = { toggle: true, range: false }

test("a finger's press on a row is a tap when the owner takes taps", () => {
  assert.equal(rowPress('touch', false, true), 'tap')
})

test('a mouse or pen press stays a click, a selection gesture', () => {
  assert.equal(rowPress('mouse', false, true), 'click')
  assert.equal(rowPress('pen', false, true), 'click')
  // A click with no press seen on the row (from the keyboard) is a click too.
  assert.equal(rowPress(undefined, false, true), 'click')
})

test("a finger's press is a click when the owner takes no taps", () => {
  assert.equal(rowPress('touch', false, false), 'click')
})

test('the release of a long press is ignored, whatever made it', () => {
  assert.equal(rowPress('touch', true, true), 'ignore')
  assert.equal(rowPress('mouse', true, true), 'ignore')
})

test('outside selection mode a tap opens, also with a mouse selection standing', () => {
  assert.equal(tapAction(NO_SELECTION, ORDER), 'open')
  const clicked = selectionAfter(NO_SELECTION, ORDER, 'b', { toggle: false, range: false })
  assert.equal(tapAction(clicked, ORDER), 'open')
})

test('a long press enters selection mode with the entry selected, and taps then toggle', () => {
  const pressed = selectionForMenu(NO_SELECTION, ORDER, 'b', true)
  assert.deepEqual(pressed, { ids: ['b'], anchor: 'b', touch: true })
  assert.equal(tapAction(pressed, ORDER), 'toggle')
  // A tap's toggle adds a folder or a file alike, and takes it off again.
  const added = selectionAfter(pressed, ORDER, 'c', TOGGLE)
  assert.deepEqual(added.ids, ['b', 'c'])
  assert.deepEqual(selectionAfter(added, ORDER, 'c', TOGGLE).ids, ['b'])
})

test('deselecting the last entry ends selection mode, so the next tap opens', () => {
  const pressed = selectionForMenu(NO_SELECTION, ORDER, 'b', true)
  const none = selectionAfter(pressed, ORDER, 'b', TOGGLE)
  assert.deepEqual(none.ids, [])
  assert.equal(tapAction(none, ORDER), 'open')
})

test("a second report of the same long press (Android's contextmenu) changes nothing", () => {
  const pressed = selectionForMenu(NO_SELECTION, ORDER, 'b', true)
  assert.equal(selectionForMenu(pressed, ORDER, 'b', true), pressed)
})

test('selection mode holds only while its entries are in the listing', () => {
  const pressed = selectionForMenu(NO_SELECTION, ORDER, 'b', true)
  assert.equal(tapAction(pressed, ['a', 'c']), 'open')
})
