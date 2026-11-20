import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { HandleInfo } from '@opencroft/server/graph'

import { sourceOf } from './terminal-source-info'

const TERMINAL = 'builtin.core.terminal-context'

const localhost: HandleInfo = {
  nodeId: 'node-local',
  spaceSlug: 'lab',
  type: 'builtin.core.localhost',
  nodeName: 'Localhost',
  graph: { address: 'lab.servers', name: 'Servers' },
  handleId: 'terminal',
  declaredId: 'terminal',
  handleType: TERMINAL,
  role: 'source',
  label: undefined,
  dynamic: false,
}

const replica: HandleInfo = {
  ...localhost,
  nodeId: 'node-web',
  type: 'acme.docker.application',
  nodeName: 'web',
  handleId: 'instance-terminal-shop-web-1',
  declaredId: 'instance-terminal-',
  dynamic: true,
}

const worktree: HandleInfo = {
  nodeId: 'app-instance-1',
  spaceSlug: 'lab',
  type: 'app:acme.git.git',
  nodeName: 'Git',
  slug: 'git',
  address: 'lab.git',
  handleId: 'worktree-terminal-api-main',
  declaredId: 'worktree-terminal-',
  handleType: TERMINAL,
  role: 'source',
  liveLabel: 'api · main',
  dynamic: true,
}

test("a node's terminal sits under the graph the node is on", () => {
  assert.deepEqual(sourceOf(localhost), {
    ref: 'term:node-local/terminal',
    title: 'Localhost',
    space: 'lab',
    app: { id: 'lab.servers', name: 'Servers', kind: 'graph' },
    owner: { id: 'node-local', name: 'Localhost' },
    container: false,
  })
})

test("an Application's replica is a container, titled by the host's name for it", () => {
  const source = sourceOf({ ...replica, title: 'web · shop-web-1' })
  assert.equal(source.container, true)
  assert.equal(source.title, 'web · shop-web-1')
})

test('a container named like its node is titled once, as the host names it', () => {
  const source = sourceOf({
    ...replica,
    nodeName: 'agent-container',
    handleId: 'instance-terminal-agent-container',
    title: 'agent-container',
  })
  assert.equal(source.title, 'agent-container')
})

test("an App's dynamic terminal sits under the App, titled by the host, and is not a container", () => {
  const source = sourceOf({ ...worktree, title: 'api · main' })
  assert.deepEqual(source.app, { id: 'lab.git', name: 'Git', kind: 'app' })
  assert.equal(source.title, 'api · main')
  assert.equal(source.container, false)
})

test('a host that gives no title leaves the terminal titled by its owner', () => {
  assert.equal(sourceOf(replica).title, 'web')
})

test('a node handle that names no graph falls under one graph row of its space', () => {
  const { graph: _graph, ...noGraph } = localhost
  assert.deepEqual(sourceOf(noGraph).app, { id: 'lab.', name: 'Graph', kind: 'graph' })
})
