import assert from 'node:assert/strict'
import { test } from 'node:test'

import { type ArchiveActionContext, type ArchiveActionHost, archiveAction } from './archive-actions'
import type { ArchiveRun } from './routes'
import { NotATerminalError } from './terminal-index'
import type { Provider } from './types'

// Which space each terminal is in: node-a's in alpha, node-b's in gamma.
const TERMINAL_SPACES: Record<string, string> = {
  'term:node-a/terminal': 'alpha',
  'term:node-b/terminal': 'gamma',
}

/** A host that records each lookup and each provider it builds. */
function recordingHost() {
  const looked: string[] = []
  const built: { spaceSlug: string; ref: string; byPerson: boolean }[] = []
  const host: ArchiveActionHost = {
    async terminalSpaceOf(ref) {
      looked.push(ref)
      const space = TERMINAL_SPACES[ref]
      if (!space) throw new NotATerminalError(`Source "${ref}" is not a terminal of any space`)
      return space
    },
    async providerFor(spaceSlug, ref, byPerson) {
      built.push({ spaceSlug, ref, byPerson })
      return { ref } as unknown as Provider
    },
  }
  return { host, looked, built }
}

const run: ArchiveRun = async (provider) => ({ ran: (provider as unknown as { ref: string }).ref })

/** An agent's call from an App in `spaceSlug`. */
const agentIn = (spaceSlug: string): ArchiveActionContext => ({ spaceSlug })

test("an App action refuses another space's terminal before any provider is built", async () => {
  const { host, built } = recordingHost()
  await assert.rejects(archiveAction(host, run)(agentIn('alpha'), { source: 'node-b/terminal' }), NotATerminalError)
  assert.deepEqual(built, [])
})

test("an App action runs on a terminal of the App's own space", async () => {
  const { host, looked, built } = recordingHost()
  const result = await archiveAction(host, run)(agentIn('alpha'), { source: 'node-a/terminal' })
  assert.deepEqual(result, { ran: 'term:node-a/terminal' })
  assert.deepEqual(looked, ['term:node-a/terminal'])
  assert.deepEqual(built, [{ spaceSlug: 'alpha', ref: 'term:node-a/terminal', byPerson: false }])
})

test('an App action does not look up the space of a connection', async () => {
  const { host, looked, built } = recordingHost()
  await archiveAction(host, run)(agentIn('alpha'), { source: 'conn:bucket-1' })
  assert.deepEqual(looked, [])
  assert.deepEqual(built, [{ spaceSlug: 'alpha', ref: 'conn:bucket-1', byPerson: false }])
})
