import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { FileEntry } from '../components/ui/file-manager/file-entry-row'
import { newEntryNameError } from '../components/ui/file-manager/use-file-browser'

const ENTRIES: FileEntry[] = [
  { id: '/docs/', name: 'docs', kind: 'directory' },
  { id: '/notes.md', name: 'notes.md', kind: 'file' },
]

test('a name no entry has is free', () => {
  assert.equal(newEntryNameError(ENTRIES, 'reports'), undefined)
})

test('a name a folder or a file already has is refused, whichever kind is new', () => {
  assert.equal(newEntryNameError(ENTRIES, 'docs'), '"docs" already exists')
  assert.equal(newEntryNameError(ENTRIES, 'notes.md'), '"notes.md" already exists')
})

test('names compare exactly as listed', () => {
  assert.equal(newEntryNameError(ENTRIES, 'Docs'), undefined)
})
