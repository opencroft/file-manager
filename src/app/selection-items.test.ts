import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fileSelection, type ShownFiles } from './selection-items'

const TERMINAL = 'term:node-1/terminal'

function shown(overrides: Partial<ShownFiles>): ShownFiles {
  return { source: TERMINAL, folder: '/srv/', selected: [], terminalName: 'Build box', ...overrides }
}

test('each selected file is an item on the terminal at its full path, in the order given', () => {
  const selection = fileSelection(
    shown({
      selected: [
        { id: '/srv/b.log', kind: 'file' },
        { id: '/srv/a.log', kind: 'file' },
      ],
    }),
  )
  assert.deepEqual(selection, {
    items: [
      { kind: 'file', terminal: 'node-1/terminal', path: '/srv/b.log', on: 'Build box' },
      { kind: 'file', terminal: 'node-1/terminal', path: '/srv/a.log', on: 'Build box' },
    ],
  })
})

test('a selected folder is a folder item, its path without the trailing slash', () => {
  const selection = fileSelection(shown({ selected: [{ id: '/srv/logs/', kind: 'directory' }] }))
  assert.deepEqual(selection?.items, [
    { kind: 'file', terminal: 'node-1/terminal', path: '/srv/logs', folder: true, on: 'Build box' },
  ])
})

test("paths are under the source's root path, as Copy path gives them", () => {
  const selection = fileSelection(
    shown({
      rootPath: '/home/alice',
      selected: [
        { id: '/notes.md', kind: 'file' },
        { id: '/docs/', kind: 'directory' },
      ],
    }),
  )
  assert.deepEqual(
    selection?.items.map((item) => item.kind === 'file' && item.path),
    ['/home/alice/notes.md', '/home/alice/docs'],
  )
})

test('with nothing selected the open folder is the one item', () => {
  assert.deepEqual(fileSelection(shown({ folder: '/srv/logs/' }))?.items, [
    { kind: 'file', terminal: 'node-1/terminal', path: '/srv/logs', folder: true, on: 'Build box' },
  ])
  assert.deepEqual(
    fileSelection(shown({ folder: '/', rootPath: '/home/alice' }))?.items.map(
      (item) => item.kind === 'file' && item.path,
    ),
    ['/home/alice'],
  )
  assert.deepEqual(
    fileSelection(shown({ folder: '/' }))?.items.map((item) => item.kind === 'file' && item.path),
    ['/'],
  )
})

test('a connection source offers nothing, selected or not', () => {
  assert.equal(fileSelection(shown({ source: 'conn:bucket-1' })), null)
  assert.equal(fileSelection(shown({ source: 'conn:bucket-1', selected: [{ id: '/a.txt', kind: 'file' }] })), null)
})

test('with no source open nothing is offered', () => {
  assert.equal(fileSelection(shown({ source: '' })), null)
})

test('without a terminal name the item names no terminal', () => {
  assert.deepEqual(fileSelection(shown({ terminalName: undefined, selected: [{ id: '/srv/a.log', kind: 'file' }] })), {
    items: [{ kind: 'file', terminal: 'node-1/terminal', path: '/srv/a.log' }],
  })
})
