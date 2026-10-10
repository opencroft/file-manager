import assert from 'node:assert/strict'
import { test } from 'node:test'

import { placeOpeningPath, type SettledPlace } from './place-opening'

const place: SettledPlace = { space: 'space-1', placeId: 'conn:alpha' }

test('the first place to settle opens at the initial path', () => {
  assert.equal(placeOpeningPath(undefined, place, '/docs/nested/'), '/docs/nested/')
})

test('the first place to settle opens at the root when there is no initial path', () => {
  assert.equal(placeOpeningPath(undefined, place, undefined), '/')
  assert.equal(placeOpeningPath(undefined, place, ''), '/')
})

test('settling on the same place again keeps the current location', () => {
  assert.equal(placeOpeningPath(place, { ...place }, '/docs/nested/'), undefined)
})

test('a different place opens at the root, not at the initial path', () => {
  assert.equal(placeOpeningPath(place, { ...place, placeId: 'conn:beta' }, '/docs/nested/'), '/')
})

test('the same place under a new root opens at the root', () => {
  assert.equal(placeOpeningPath(place, { ...place, rootPath: '/srv/app' }, '/docs/nested/'), '/')
  assert.equal(placeOpeningPath({ ...place, rootPath: '/srv/app' }, place, '/docs/nested/'), '/')
})

test('the same place id in another space opens at the root', () => {
  assert.equal(placeOpeningPath(place, { ...place, space: 'space-2' }, '/docs/nested/'), '/')
})
