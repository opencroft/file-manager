import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { FileEntry, Provider } from '../types'
import { withoutPartials } from './partials'
import { STALE_PARTIAL_MS } from './upload'

function entry(name: string, modified: Date): FileEntry {
  return { name, path: `/srv/${name}`, type: 'file', size: 4, modified: modified.toISOString() }
}

/** A folder held in memory: its listing, and the paths deleted from it, each delete answered at once. */
function folder(entries: FileEntry[]) {
  let held = entries
  const deleted: string[] = []
  let onDelete = () => {}
  const someDeleted = new Promise<void>((resolve) => {
    onDelete = resolve
  })
  const unused = () => Promise.reject(new Error('not used here'))
  const provider: Provider = {
    list: async () => ({ entries: held }),
    delete: async (path) => {
      deleted.push(path)
      held = held.filter((e) => e.path !== path)
      onDelete()
    },
    readStream: unused,
    writeStream: unused,
    rename: unused,
    mkdir: unused,
    createFile: unused,
  }
  return { provider, deleted, someDeleted, held: () => held }
}

test('a listing shows no partial file of an upload, and removes those left behind', async () => {
  const now = Date.now()
  const old = entry('.upload-0123456789ab.part', new Date(now - STALE_PARTIAL_MS - 60_000))
  const fresh = entry('.upload-0123456789cd.part', new Date(now - 1_000))
  const kept = entry('conf.txt', new Date(now - 10 * STALE_PARTIAL_MS))
  const source = folder([old, fresh, kept])

  const listed = await withoutPartials(source.provider).list('/srv/')

  assert.deepEqual(listed.entries, [kept])
  await source.someDeleted
  assert.deepEqual(source.deleted, [old.path])
  assert.deepEqual(source.held(), [fresh, kept])
})

test('a listing answers even when removing a partial file left behind fails', async () => {
  const source = folder([entry('.upload-0123456789ab.part', new Date(0)), entry('conf.txt', new Date(0))])
  source.provider.delete = () => Promise.reject(new Error('Permission denied'))

  const listed = await withoutPartials(source.provider).list('/srv/')

  assert.deepEqual(
    listed.entries.map((e) => e.name),
    ['conf.txt'],
  )
})
