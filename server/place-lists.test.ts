import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  bookmarked,
  type PlaceRef,
  RECENT_LIMIT,
  usedRecently,
  withFirst,
  without,
  withoutBookmarkedRecent,
} from './place-lists'

const at = (path: string, source = 'term:node/terminal'): PlaceRef => ({ source, path })

test('a new folder goes first', () => {
  assert.deepEqual(withFirst([at('/a/'), at('/b/')], at('/c/')), [at('/c/'), at('/a/'), at('/b/')])
})

test('a folder used again moves to the top, held once', () => {
  assert.deepEqual(withFirst([at('/a/'), at('/b/'), at('/c/')], at('/b/')), [at('/b/'), at('/a/'), at('/c/')])
})

test('the same path on another terminal is another folder', () => {
  const other = at('/a/', 'term:node/other')
  assert.deepEqual(withFirst([at('/a/')], other), [other, at('/a/')])
})

test('a capped list drops its oldest', () => {
  const full = Array.from({ length: RECENT_LIMIT }, (_, i) => at(`/${i}/`))
  const next = withFirst(full, at('/new/'), RECENT_LIMIT)
  assert.equal(next.length, RECENT_LIMIT)
  assert.deepEqual(next[0], at('/new/'))
  assert.deepEqual(next[RECENT_LIMIT - 1], at(`/${RECENT_LIMIT - 2}/`))
})

test('bookmarking a recent folder moves it out of Recent', () => {
  const next = bookmarked({ bookmarks: [at('/x/')], recent: [at('/a/'), at('/b/'), at('/c/')] }, at('/b/'))
  assert.deepEqual(next, { bookmarks: [at('/b/'), at('/x/')], recent: [at('/a/'), at('/c/')] })
})

test('bookmarking keeps the same path on another terminal in Recent', () => {
  const other = at('/b/', 'term:node/other')
  const next = bookmarked({ bookmarks: [], recent: [other, at('/b/')] }, at('/b/'))
  assert.deepEqual(next.recent, [other])
})

test('using a bookmarked folder leaves Recent unchanged', () => {
  const full = Array.from({ length: RECENT_LIMIT }, (_, i) => at(`/${i}/`))
  const places = { bookmarks: [at('/kept/')], recent: full }
  assert.deepEqual(usedRecently(places, at('/kept/')), places)
})

test('using a folder that is not bookmarked puts it first in Recent', () => {
  const next = usedRecently({ bookmarks: [at('/kept/')], recent: [at('/a/')] }, at('/b/'))
  assert.deepEqual(next, { bookmarks: [at('/kept/')], recent: [at('/b/'), at('/a/')] })
})

test('a stored folder in both lists reads back in Bookmarks only', () => {
  const next = withoutBookmarkedRecent({ bookmarks: [at('/b/')], recent: [at('/a/'), at('/b/')] })
  assert.deepEqual(next, { bookmarks: [at('/b/')], recent: [at('/a/')] })
})

test('removing a folder keeps the others in order', () => {
  assert.deepEqual(without([at('/a/'), at('/b/'), at('/c/')], at('/b/')), [at('/a/'), at('/c/')])
  assert.deepEqual(without([at('/a/')], at('/a/', 'term:node/other')), [at('/a/')])
})
