import assert from 'node:assert/strict'
import { test } from 'node:test'

import { folderName, fullPath, listingPath } from '../lib/format'
import { crumbsFor } from './crumbs'

test('a full path is the listed path when the source has no root', () => {
  assert.equal(fullPath(undefined, '/var/log/app.log'), '/var/log/app.log')
  assert.equal(fullPath('', '/var/log/app.log'), '/var/log/app.log')
  assert.equal(fullPath('/', '/var/log/app.log'), '/var/log/app.log')
})

test('a full path sits under the source root', () => {
  assert.equal(fullPath('/srv/app', '/data/report.csv'), '/srv/app/data/report.csv')
  assert.equal(fullPath('/srv/app/', '/data/report.csv'), '/srv/app/data/report.csv')
  assert.equal(fullPath('srv/app', '/data/report.csv'), '/srv/app/data/report.csv')
})

test("a folder's full path has no trailing slash, except the root itself", () => {
  assert.equal(fullPath(undefined, '/home/user/docs/'), '/home/user/docs')
  assert.equal(fullPath('/srv/app', '/'), '/srv/app')
  assert.equal(fullPath(undefined, '/'), '/')
})

test('a stored folder opens at its listing path under the root as it is now', () => {
  const stored = '/srv/app/logs'
  assert.equal(listingPath(undefined, stored), '/srv/app/logs/')
  assert.equal(listingPath('/srv/app', stored), '/logs/')
  assert.equal(listingPath('/srv/app/', stored), '/logs/')
  assert.equal(listingPath('/srv', stored), '/app/logs/')
})

test('a root change leaves a stored folder where it is, or out of reach', () => {
  const stored = fullPath('/srv/app', '/logs/')
  assert.equal(stored, '/srv/app/logs')
  assert.equal(listingPath('/srv/other', stored), undefined)
  assert.equal(listingPath('/srv/app/logs/deeper', stored), undefined)
  assert.equal(listingPath('/srv/apple', '/srv/app/logs'), undefined)
  assert.equal(listingPath('/srv/app', '/srv/apple/logs'), undefined)
})

test('the root folder itself is the listing root', () => {
  assert.equal(listingPath('/srv/app', '/srv/app'), '/')
  assert.equal(listingPath(undefined, '/'), '/')
  assert.equal(listingPath('/', '/srv'), '/srv/')
})

test('fullPath and listingPath agree on a folder', () => {
  for (const root of [undefined, '/srv', '/srv/app/']) {
    for (const listed of ['/', '/a/', '/a/b c/']) {
      assert.equal(listingPath(root, fullPath(root, listed)), listed)
    }
  }
})

test("a folder's name is its last segment, and the root has none", () => {
  assert.equal(folderName('/home/user/docs/'), 'docs')
  assert.equal(folderName('/home/user/docs'), 'docs')
  assert.equal(folderName('/'), '')
})

test('crumbs carry the accumulated path with a trailing slash, root first', () => {
  assert.deepEqual(crumbsFor('term:n/h', 'Server', '/home/user/'), [
    { id: 'term:n/h', name: 'Server' },
    { id: '/home/', name: 'home' },
    { id: '/home/user/', name: 'user' },
  ])
})

test('the root path is the place crumb alone', () => {
  assert.deepEqual(crumbsFor('term:n/h', 'Server', '/'), [{ id: 'term:n/h', name: 'Server' }])
  assert.deepEqual(crumbsFor('term:n/h', 'Server'), [{ id: 'term:n/h', name: 'Server' }])
})
