import assert from 'node:assert/strict'
import { test } from 'node:test'

import { type ContainerProbe, containerStates, parseDockerPs } from './container-states'

const PS = ['0a1b2c3d4e5f\tshop-web-1\trunning', '9f8e7d6c5b4a\tshop-worker-1\texited', ''].join('\n')

test('docker ps lines are read as id, name and state', () => {
  assert.deepEqual(parseDockerPs(PS), [
    { id: '0a1b2c3d4e5f', name: 'shop-web-1', state: 'running' },
    { id: '9f8e7d6c5b4a', name: 'shop-worker-1', state: 'exited' },
  ])
})

test('a container is running, stopped, or not created yet, by its name or its id', async () => {
  const probes: ContainerProbe[] = [
    { ref: 'web', host: 'h1', containerId: 'shop-web-1' },
    { ref: 'worker', host: 'h1', containerId: 'shop-worker-1' },
    { ref: 'by-id', host: 'h1', containerId: '0a1b2c3d4e5f0123456789' },
    { ref: 'missing', host: 'h1', containerId: 'shop-cron-1' },
  ]
  assert.deepEqual(await containerStates(probes, async () => PS), {
    web: 'running',
    worker: 'stopped',
    'by-id': 'running',
    missing: 'stopped',
  })
})

test('each Docker host is asked once', async () => {
  const asked: string[] = []
  const probes: ContainerProbe[] = [
    { ref: 'a', host: 'h1', containerId: 'shop-web-1' },
    { ref: 'b', host: 'h1', containerId: 'shop-worker-1' },
    { ref: 'c', host: 'h2', containerId: 'shop-web-1' },
  ]
  await containerStates(probes, async (host) => {
    asked.push(host)
    return PS
  })
  assert.deepEqual(asked.sort(), ['h1', 'h2'])
})

test("a host that doesn't answer makes its containers unreachable, and only its", async () => {
  const probes: ContainerProbe[] = [
    { ref: 'down', host: 'h1', containerId: 'shop-web-1' },
    { ref: 'up', host: 'h2', containerId: 'shop-web-1' },
  ]
  const states = await containerStates(probes, async (host) => {
    if (host === 'h1') {
      throw new Error('Cannot connect to the Docker daemon')
    }
    return PS
  })
  assert.deepEqual(states, { down: 'unreachable', up: 'running' })
})
