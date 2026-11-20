import assert from 'node:assert/strict'
import { test } from 'node:test'

import { type DeletedEntry, deleteEntries, deleteFailureNote, deleteQuestion } from './delete-entries'

const FILE: DeletedEntry = { id: '/a.txt', name: 'a.txt', kind: 'file' }
const OTHER: DeletedEntry = { id: '/b.txt', name: 'b.txt', kind: 'file' }
const FOLDER: DeletedEntry = { id: '/photos/', name: 'photos', kind: 'directory' }

test('one entry is asked about by name, a folder saying its content goes too', () => {
  assert.equal(deleteQuestion([FILE]), 'Delete file "a.txt"?')
  assert.equal(deleteQuestion([FOLDER]), 'Delete folder (and everything in it) "photos"?')
})

test('several entries are asked about once, by how many', () => {
  assert.equal(deleteQuestion([FILE, OTHER]), 'Delete 2 items?')
  assert.equal(deleteQuestion([FILE, OTHER, FOLDER]), 'Delete 3 items? Folders are deleted with everything in them.')
})

test('deletes go one at a time, in order, and a failure does not stop the rest', async () => {
  const calls: string[] = []
  let running = 0
  const failures = await deleteEntries([FILE, FOLDER, OTHER], async (id) => {
    running++
    assert.equal(running, 1, 'one delete at a time')
    calls.push(id)
    await new Promise((resolve) => setImmediate(resolve))
    running--
    if (id === '/photos/') {
      throw new Error('Permission denied')
    }
  })
  assert.deepEqual(calls, ['/a.txt', '/photos/', '/b.txt'])
  assert.deepEqual(failures, [{ name: 'photos', message: 'Permission denied' }])
  assert.equal(deleteFailureNote(failures, 3), 'Could not delete 1 of 3 items. "photos": Permission denied')
})

test('a single failed delete reports just its reason', () => {
  assert.equal(deleteFailureNote([{ name: 'a.txt', message: 'No such file' }], 1), 'No such file')
})
