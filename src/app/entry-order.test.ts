import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { FileEntry, FileSort, FileSortKey } from '../components/ui/file-manager/file-entry-row'
import { compareEntries } from '../components/ui/file-manager/use-file-browser'
import { fileKind } from '../components/ui/files/file-type-icon'

const HOUR = 3_600_000

const ENTRIES: FileEntry[] = [
  { id: 'a', name: 'zeta.mp4', kind: 'file', sizeBytes: 9_000, modifiedAt: 5 * HOUR },
  { id: 'b', name: 'Beta', kind: 'directory', modifiedAt: 1 * HOUR },
  { id: 'c', name: 'notes.md', kind: 'file', sizeBytes: 10, modifiedAt: 2 * HOUR },
  { id: 'd', name: 'alpha', kind: 'directory', modifiedAt: 4 * HOUR },
  { id: 'e', name: 'config.yaml', kind: 'file', sizeBytes: 500 },
  { id: 'f', name: 'photo.png', kind: 'file', sizeBytes: 2_000, modifiedAt: 3 * HOUR },
]

const names = (sort: FileSort) => [...ENTRIES].sort(compareEntries(sort)).map((e) => e.name)

test('folders come before files under every column and direction', () => {
  for (const key of ['name', 'date', 'type', 'size'] satisfies FileSortKey[]) {
    for (const direction of ['asc', 'desc'] as const) {
      const kinds = [...ENTRIES].sort(compareEntries({ key, direction })).map((e) => e.kind)
      assert.deepEqual(kinds, ['directory', 'directory', 'file', 'file', 'file', 'file'], `${key} ${direction}`)
    }
  }
})

test('name order is case-insensitive and natural, and flips with the direction', () => {
  assert.deepEqual(names({ key: 'name', direction: 'asc' }), [
    'alpha',
    'Beta',
    'config.yaml',
    'notes.md',
    'photo.png',
    'zeta.mp4',
  ])
  assert.deepEqual(names({ key: 'name', direction: 'desc' }), [
    'Beta',
    'alpha',
    'zeta.mp4',
    'photo.png',
    'notes.md',
    'config.yaml',
  ])
  const numbered: FileEntry[] = ['file10', 'file2', 'File1'].map((name) => ({ id: name, name, kind: 'file' }))
  assert.deepEqual(
    numbered.sort(compareEntries({ key: 'name', direction: 'asc' })).map((e) => e.name),
    ['File1', 'file2', 'file10'],
  )
})

test('date sorts by the raw timestamp, an entry without one last in both directions', () => {
  assert.deepEqual(names({ key: 'date', direction: 'asc' }), [
    'Beta',
    'alpha',
    'notes.md',
    'photo.png',
    'zeta.mp4',
    'config.yaml',
  ])
  assert.deepEqual(names({ key: 'date', direction: 'desc' }), [
    'alpha',
    'Beta',
    'zeta.mp4',
    'photo.png',
    'notes.md',
    'config.yaml',
  ])
})

test('size sorts files by bytes, and folders, which have no size, by name', () => {
  assert.deepEqual(names({ key: 'size', direction: 'asc' }), [
    'alpha',
    'Beta',
    'notes.md',
    'config.yaml',
    'photo.png',
    'zeta.mp4',
  ])
  assert.deepEqual(names({ key: 'size', direction: 'desc' }), [
    'alpha',
    'Beta',
    'zeta.mp4',
    'photo.png',
    'config.yaml',
    'notes.md',
  ])
})

test('type sorts files by their kind', () => {
  // Config, Image, Text, Video
  assert.deepEqual(names({ key: 'type', direction: 'asc' }), [
    'alpha',
    'Beta',
    'config.yaml',
    'photo.png',
    'notes.md',
    'zeta.mp4',
  ])
})

test('each kind is told apart by name', () => {
  assert.equal(fileKind('src', true), 'folder')
  assert.equal(fileKind('server.exe'), 'binary')
  assert.equal(fileKind('lib/libz.so'), 'binary')
  assert.equal(fileKind('Photo.JPG'), 'image')
  assert.equal(fileKind('song.flac'), 'audio')
  assert.equal(fileKind('clip.webm'), 'video')
  assert.equal(fileKind('notes.txt'), 'text')
  assert.equal(fileKind('README'), 'text')
  assert.equal(fileKind('settings.toml'), 'config')
  assert.equal(fileKind('.env'), 'config')
  assert.equal(fileKind('.env.production'), 'config')
  assert.equal(fileKind('main.ts'), 'code')
  assert.equal(fileKind('data.raw'), 'file')
  assert.equal(fileKind('no-extension'), 'file')
})
