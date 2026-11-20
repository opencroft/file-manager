import assert from 'node:assert/strict'
import { test } from 'node:test'

import { terminalGroups } from './terminal-tree'
import type { TerminalSourceInfo } from './types'

const SPACES = [
  { slug: 'lab', name: 'Lab' },
  { slug: 'shop', name: 'Shop' },
]

function terminal(
  ref: string,
  space: string,
  app: TerminalSourceInfo['app'],
  owner: string,
  container = false,
): TerminalSourceInfo {
  return { ref, title: ref, space, app, owner: { id: owner, name: owner }, container }
}

const SERVERS = { id: 'lab.servers', name: 'Servers', kind: 'graph' } as const
const GIT = { id: 'lab.git', name: 'Git', kind: 'app' } as const
const SHOP_DEFAULT = { id: 'shop.default', name: 'Default', kind: 'graph' } as const

const SOURCES = [
  terminal('term:local/terminal', 'lab', SERVERS, 'local'),
  terminal('term:web/instance-terminal-web-1', 'lab', SERVERS, 'web', true),
  terminal('term:web/instance-terminal-web-2', 'lab', SERVERS, 'web', true),
  terminal('term:git/worktree-a', 'lab', GIT, 'git'),
  terminal('term:git/worktree-b', 'lab', GIT, 'git'),
  terminal('term:worker/instance-terminal-worker-1', 'shop', SHOP_DEFAULT, 'worker', true),
]

const ids = (groups: Map<string, { id: string }[]>, ref: string) => groups.get(ref)?.map((step) => step.id)

test('a terminal sits under its space, then its graph', () => {
  const groups = terminalGroups(SOURCES, SPACES, 'lab')
  assert.deepEqual(ids(groups, 'term:local/terminal'), ['space:lab', 'app:lab:lab.servers'])
  assert.deepEqual(ids(groups, 'term:worker/instance-terminal-worker-1'), ['space:shop', 'app:shop:shop.default'])
})

test('a node with several terminals is a group of its own, one with a single terminal is not', () => {
  const groups = terminalGroups(SOURCES, SPACES, 'lab')
  assert.deepEqual(ids(groups, 'term:web/instance-terminal-web-1'), ['space:lab', 'app:lab:lab.servers', 'owner:web'])
  assert.equal(groups.get('term:web/instance-terminal-web-2')?.[2]?.ownerId, 'web')
  assert.equal(groups.get('term:local/terminal')?.length, 2)
})

test("an App's terminals sit straight under the App", () => {
  const groups = terminalGroups(SOURCES, SPACES, 'lab')
  assert.deepEqual(ids(groups, 'term:git/worktree-a'), ['space:lab', 'app:lab:lab.git'])
})

test("spaces are named, and only the App's own space opens on first sight", () => {
  const groups = terminalGroups(SOURCES, SPACES, 'lab')
  const lab = groups.get('term:local/terminal')?.[0]
  const shop = groups.get('term:worker/instance-terminal-worker-1')?.[0]
  assert.deepEqual([lab?.name, lab?.defaultOpen], ['Lab', true])
  assert.deepEqual([shop?.name, shop?.defaultOpen], ['Shop', false])
  assert.equal(groups.get('term:web/instance-terminal-web-1')?.[2]?.defaultOpen, false)
})

test('graphs of the same name in two spaces are two groups', () => {
  const twin = { id: 'shop.servers', name: 'Servers', kind: 'graph' } as const
  const groups = terminalGroups(
    [terminal('term:a/terminal', 'lab', SERVERS, 'a'), terminal('term:b/terminal', 'shop', twin, 'b')],
    SPACES,
    'lab',
  )
  assert.notEqual(groups.get('term:a/terminal')?.[1]?.id, groups.get('term:b/terminal')?.[1]?.id)
})
