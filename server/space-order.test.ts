import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bySpace, spaceOrder } from './space-order'

test("the App's own space comes first, then the person's spaces in their order", () => {
  assert.deepEqual(spaceOrder('beta', [{ slug: 'alpha' }, { slug: 'beta' }, { slug: 'gamma' }]), [
    'beta',
    'alpha',
    'gamma',
  ])
})

test('items are grouped by space in that order, keeping their order within a space', () => {
  const items = [
    { id: 1, space: 'alpha' },
    { id: 2, space: 'beta' },
    { id: 3, space: 'alpha' },
    { id: 4, space: 'gamma' },
    { id: 5, space: 'beta' },
  ]
  assert.deepEqual(
    bySpace(items, ['beta', 'alpha']).map((item) => item.id),
    [2, 5, 1, 3],
  )
})
