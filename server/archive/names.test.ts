import assert from 'node:assert/strict'
import { test } from 'node:test'

import { archiveName, EntryOutsideError, entrySegments, freeName, isMacMetadata, unpackFolderName } from './names'

test('one file packs to its name with .zip for its extension, one folder to its whole name', () => {
  assert.equal(archiveName([{ name: 'report.pdf', kind: 'file' }]), 'report.zip')
  assert.equal(archiveName([{ name: 'v1.2', kind: 'directory' }]), 'v1.2.zip')
  assert.equal(archiveName([{ name: '.env', kind: 'file' }]), '.env.zip')
})

test('several items pack to a neutral name', () => {
  assert.equal(
    archiveName([
      { name: 'a', kind: 'file' },
      { name: 'b', kind: 'directory' },
    ]),
    'Archive.zip',
  )
})

test('an archive unpacks into a folder named without .zip', () => {
  assert.equal(unpackFolderName('photos.zip'), 'photos')
  assert.equal(unpackFolderName('PHOTOS.ZIP'), 'PHOTOS')
  assert.equal(unpackFolderName('.zip'), 'Archive')
})

test('a taken name counts up before its extension', () => {
  assert.equal(freeName('docs.zip', new Set(['other'])), 'docs.zip')
  assert.equal(freeName('docs.zip', new Set(['docs.zip', 'docs 2.zip'])), 'docs 3.zip')
  assert.equal(freeName('photos', new Set(['photos'])), 'photos 2')
})

test('an entry splits into the folders and name it unpacks to', () => {
  assert.deepEqual(entrySegments('a/b/c.txt'), ['a', 'b', 'c.txt'])
  assert.deepEqual(entrySegments('a\\b\\c.txt'), ['a', 'b', 'c.txt'])
  assert.deepEqual(entrySegments('./a//b/'), ['a', 'b'])
  assert.deepEqual(entrySegments('./'), [])
})

test('an entry leaving the folder is refused', () => {
  for (const name of ['../evil.txt', 'a/../../evil.txt', '..\\evil.txt', '/etc/passwd', 'C:/evil.txt', 'c:evil.txt']) {
    assert.throws(() => entrySegments(name), EntryOutsideError, name)
  }
})

test('a name containing two dots that is not a parent reference is kept', () => {
  assert.deepEqual(entrySegments('a/..b/c..'), ['a', '..b', 'c..'])
})

test('only the top-level __MACOSX folder is metadata', () => {
  assert.equal(isMacMetadata(['__MACOSX', 'a', '._b']), true)
  assert.equal(isMacMetadata(['a', '__MACOSX']), false)
})
