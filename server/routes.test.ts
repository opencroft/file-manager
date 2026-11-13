import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { test } from 'node:test'

import type { ExtensionRouteContext, ExtensionSessionRoute } from '@opencroft/server/routes'

import { type ProviderFor, transferRoutes } from './routes'
import { NotInSpaceError } from './space-terminals'
import type { Provider } from './types'

const SOURCE = 'term:node-a/terminal'
const ORIGIN = 'http://files.example'

/** A signed-in person who sees the spaces named. */
function personSeeing(...slugs: string[]): ExtensionRouteContext {
  return {
    person: { id: 'person-1', name: 'Pat Example' },
    spaces: {
      list: async () => slugs.map((slug) => ({ slug, name: slug, icon: '' })),
      subscribe: () => () => {},
    },
    apps: {},
  } as unknown as ExtensionRouteContext
}

/** A provider over one file, recording what was asked of it. */
function providers() {
  const asked: { space: string; ref: string }[] = []
  const written: { path: string; filename: string; content: string }[] = []
  const provider = {
    readStream: async () => ({ stream: Readable.from([Buffer.from('hello')]), size: 5 }),
    writeStream: async (path: string, filename: string, stream: Readable) => {
      const chunks: Buffer[] = []
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk))
      }
      written.push({ path, filename, content: Buffer.concat(chunks).toString() })
    },
  } as unknown as Provider
  const providerFor: ProviderFor = async (space, ref) => {
    asked.push({ space, ref })
    if (ref !== SOURCE) {
      throw new NotInSpaceError(`Source "${ref}" is not a terminal of space "${space}"`)
    }
    return provider
  }
  return { providerFor, asked, written }
}

function sessionRoute(providerFor: ProviderFor, name: 'download' | 'upload'): ExtensionSessionRoute {
  const route = transferRoutes(providerFor)[name]
  assert.ok(typeof route === 'object', `${name} must be a session route, not a public handler`)
  return route
}

const downloadUrl = (space: string, source = SOURCE) =>
  `${ORIGIN}/download?space=${space}&source=${encodeURIComponent(source)}&path=/notes/hello.txt`
const uploadUrl = (space: string) =>
  `${ORIGIN}/upload?space=${space}&source=${encodeURIComponent(SOURCE)}&path=/notes&filename=up.txt`

test('both transfer routes are served only to a signed-in person', () => {
  const routes = transferRoutes(providers().providerFor)
  assert.deepEqual(Object.keys(routes).sort(), ['download', 'upload'])
  for (const route of Object.values(routes)) {
    assert.equal(typeof route === 'object' && route.session, 'person')
  }
})

test("a download from one of the person's spaces serves the file", async () => {
  const { providerFor, asked } = providers()
  const response = await sessionRoute(providerFor, 'download').handler(
    new Request(downloadUrl('alpha')),
    personSeeing('alpha'),
  )
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'hello')
  assert.match(response.headers.get('content-disposition') ?? '', /filename="hello.txt"/)
  assert.deepEqual(asked, [{ space: 'alpha', ref: SOURCE }])
})

test("a download from a space the person doesn't see is refused before any source is resolved", async () => {
  const { providerFor, asked } = providers()
  const response = await sessionRoute(providerFor, 'download').handler(
    new Request(downloadUrl('beta')),
    personSeeing('alpha'),
  )
  assert.equal(response.status, 403)
  assert.deepEqual(asked, [])
})

test("a download naming a source the space doesn't hold is refused", async () => {
  const { providerFor } = providers()
  const response = await sessionRoute(providerFor, 'download').handler(
    new Request(downloadUrl('alpha', 'term:node-elsewhere/terminal')),
    personSeeing('alpha'),
  )
  assert.equal(response.status, 403)
})

test("an upload into one of the person's spaces writes the body", async () => {
  const { providerFor, written } = providers()
  const response = await sessionRoute(providerFor, 'upload').handler(
    new Request(uploadUrl('alpha'), { method: 'POST', body: 'uploaded', duplex: 'half' } as RequestInit),
    personSeeing('alpha'),
  )
  assert.equal(response.status, 200)
  assert.deepEqual(written, [{ path: '/notes', filename: 'up.txt', content: 'uploaded' }])
})

test("an upload into a space the person doesn't see writes nothing", async () => {
  const { providerFor, asked, written } = providers()
  const response = await sessionRoute(providerFor, 'upload').handler(
    new Request(uploadUrl('beta'), { method: 'POST', body: 'uploaded' }),
    personSeeing('alpha'),
  )
  assert.equal(response.status, 403)
  assert.deepEqual(asked, [])
  assert.deepEqual(written, [])
})
