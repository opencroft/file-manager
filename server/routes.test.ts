import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { test } from 'node:test'

import type { ExtensionRouteContext, ExtensionSessionRoute } from '@opencroft/server/routes'

import { type ArchiveRun, fileManagerRoutes, type RouteHost } from './routes'
import { NotATerminalError } from './terminal-index'
import type { Provider } from './types'

const SOURCE = 'term:node-a/terminal'
const ELSEWHERE = 'term:node-b/terminal'
const CONNECTION = 'conn:bucket-1'
const ORIGIN = 'http://files.example'

// Which space each terminal is in: SOURCE in alpha, ELSEWHERE in gamma.
const TERMINAL_SPACES: Record<string, string> = { [SOURCE]: 'alpha', [ELSEWHERE]: 'gamma' }

/** A signed-in person who sees the spaces named. */
function personSeeing(...slugs: string[]): ExtensionRouteContext {
  return {
    person: { id: 'person-1', name: 'Pat Example' },
    spaces: {
      list: async () => slugs.map((slug) => ({ slug, name: `Space ${slug}`, icon: '' })),
      subscribe: () => () => {},
    },
    apps: {},
  } as unknown as ExtensionRouteContext
}

// Stand-ins for pack and unpack: each reports half-way and done, then answers
// what it was asked, or fails when the body asks it to.
const ran: { name: string; body: Record<string, unknown> }[] = []
function archiveRun(name: string): ArchiveRun {
  return async (_provider, body, { onProgress }) => {
    ran.push({ name, body })
    onProgress?.({ done: 1, total: 2 })
    onProgress?.({ done: 2, total: 2 })
    if (body.fail) {
      throw new Error('it failed')
    }
    return { name, body }
  }
}

/** A host over one file, recording what was asked of it. */
function fakeHost() {
  const asked: { space: string; ref: string }[] = []
  const written: { path: string; filename: string; content: string }[] = []
  const listed: { space: string; visible: string[] }[] = []
  const provider = {
    list: async () => ({
      entries: [{ name: 'hello.txt', path: '/notes/hello.txt', type: 'file', size: 5, modified: '' }],
    }),
    readStream: async () => ({ stream: Readable.from([Buffer.from('hello')]), size: 5 }),
    writeStream: async (path: string, filename: string, stream: Readable) => {
      const chunks: Buffer[] = []
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk))
      }
      written.push({ path, filename, content: Buffer.concat(chunks).toString() })
    },
  } as unknown as Provider
  const host: RouteHost = {
    providerFor: async (space, ref) => {
      asked.push({ space, ref })
      return provider
    },
    archives: { pack: archiveRun('pack'), unpack: archiveRun('unpack') },
    terminalSpaceOf: async (ref) => {
      const space = TERMINAL_SPACES[ref]
      if (!space) {
        throw new NotATerminalError(`Source "${ref}" is not a terminal of any space`)
      }
      return space
    },
    listSources: async (space, visible) => {
      listed.push({ space, visible: visible.map((entry) => entry.slug) })
      return { connections: [], terminalSources: [], sourceSettings: {}, spaces: [...visible] }
    },
    containerStates: async (visible) => Object.fromEntries(visible.map((entry) => [entry.slug, 'running' as const])),
  }
  return { host, asked, written, listed }
}

function sessionRoute(host: RouteHost, name: string): ExtensionSessionRoute {
  const route = fileManagerRoutes(host)[name]
  assert.ok(typeof route === 'object', `${name} must be a session route, not a public handler`)
  return route
}

const downloadUrl = (space: string, source = SOURCE) =>
  `${ORIGIN}/download?space=${space}&source=${encodeURIComponent(source)}&path=/notes/hello.txt`
const uploadUrl = (space: string, source = SOURCE) =>
  `${ORIGIN}/upload?space=${space}&source=${encodeURIComponent(source)}&path=/notes&filename=up.txt`

test('every route is served only to a signed-in person', () => {
  const routes = fileManagerRoutes(fakeHost().host)
  assert.deepEqual(Object.keys(routes).sort(), [
    'container-states',
    'download',
    'download-zip',
    'pack',
    'sources',
    'unpack',
    'upload',
  ])
  for (const route of Object.values(routes)) {
    assert.equal(typeof route === 'object' && route.session, 'person')
  }
})

test("a download from a terminal in the App's space serves the file", async () => {
  const { host, asked } = fakeHost()
  const response = await sessionRoute(host, 'download').handler(
    new Request(downloadUrl('alpha')),
    personSeeing('alpha'),
  )
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'hello')
  assert.match(response.headers.get('content-disposition') ?? '', /filename="hello.txt"/)
  assert.deepEqual(asked, [{ space: 'alpha', ref: SOURCE }])
})

test("a download from a terminal in another of the person's spaces serves the file", async () => {
  const { host, asked } = fakeHost()
  const response = await sessionRoute(host, 'download').handler(
    new Request(downloadUrl('alpha', ELSEWHERE)),
    personSeeing('alpha', 'gamma'),
  )
  assert.equal(response.status, 200)
  assert.deepEqual(asked, [{ space: 'alpha', ref: ELSEWHERE }])
})

test("a download from a terminal in a space the person doesn't see is refused before its source is resolved", async () => {
  const { host, asked } = fakeHost()
  const response = await sessionRoute(host, 'download').handler(
    new Request(downloadUrl('alpha', ELSEWHERE)),
    personSeeing('alpha'),
  )
  assert.equal(response.status, 403)
  assert.deepEqual(asked, [])
})

test("a download through an App whose space the person doesn't see is refused", async () => {
  const { host, asked } = fakeHost()
  const response = await sessionRoute(host, 'download').handler(new Request(downloadUrl('beta')), personSeeing('alpha'))
  assert.equal(response.status, 403)
  assert.deepEqual(asked, [])
})

test('a download naming a source no space lists is refused', async () => {
  const { host, asked } = fakeHost()
  const response = await sessionRoute(host, 'download').handler(
    new Request(downloadUrl('alpha', 'term:node-unknown/terminal')),
    personSeeing('alpha'),
  )
  assert.equal(response.status, 403)
  assert.deepEqual(asked, [])
})

test("a download from one of the App's connections is resolved in the App's space", async () => {
  const { host, asked } = fakeHost()
  const response = await sessionRoute(host, 'download').handler(
    new Request(downloadUrl('alpha', CONNECTION)),
    personSeeing('alpha'),
  )
  assert.equal(response.status, 200)
  assert.deepEqual(asked, [{ space: 'alpha', ref: CONNECTION }])
})

const zipRequest = (space: string, paths: string[], source = SOURCE) => {
  const form = new URLSearchParams(paths.map((path) => ['path', path]))
  return new Request(`${ORIGIN}/download-zip?space=${space}&source=${encodeURIComponent(source)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
}

test("a zip download from one of the person's spaces serves a zip of the form's paths", async () => {
  const { host, asked } = fakeHost()
  const response = await sessionRoute(host, 'download-zip').handler(
    zipRequest('alpha', ['/notes/hello.txt']),
    personSeeing('alpha'),
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/zip')
  assert.match(response.headers.get('content-disposition') ?? '', /filename="hello.zip"/)
  const body = Buffer.from(await response.arrayBuffer())
  assert.equal(body.subarray(0, 4).toString('latin1'), 'PK\x03\x04', 'a zip local file header')
  assert.ok(body.includes('hello.txt'), 'the entry is in it')
  assert.deepEqual(asked, [{ space: 'alpha', ref: SOURCE }])
})

test("a zip download through an App whose space the person doesn't see is refused before any source is resolved", async () => {
  const { host, asked } = fakeHost()
  const response = await sessionRoute(host, 'download-zip').handler(
    zipRequest('beta', ['/notes/hello.txt']),
    personSeeing('alpha'),
  )
  assert.equal(response.status, 403)
  assert.deepEqual(asked, [])
})

test("a zip download from a terminal in a space the person doesn't see is refused before its source is resolved", async () => {
  const { host, asked } = fakeHost()
  const response = await sessionRoute(host, 'download-zip').handler(
    zipRequest('alpha', ['/notes/hello.txt'], ELSEWHERE),
    personSeeing('alpha'),
  )
  assert.equal(response.status, 403)
  assert.deepEqual(asked, [])
})

test('a zip download naming no path is refused', async () => {
  const { host, asked } = fakeHost()
  const response = await sessionRoute(host, 'download-zip').handler(zipRequest('alpha', []), personSeeing('alpha'))
  assert.equal(response.status, 400)
  assert.deepEqual(asked, [])
})

test("an upload into one of the person's spaces writes the body", async () => {
  const { host, written } = fakeHost()
  const response = await sessionRoute(host, 'upload').handler(
    new Request(uploadUrl('alpha'), { method: 'POST', body: 'uploaded', duplex: 'half' } as RequestInit),
    personSeeing('alpha'),
  )
  assert.equal(response.status, 200)
  assert.deepEqual(written, [{ path: '/notes', filename: 'up.txt', content: 'uploaded' }])
})

test("an upload into a terminal in a space the person doesn't see writes nothing", async () => {
  const { host, asked, written } = fakeHost()
  const response = await sessionRoute(host, 'upload').handler(
    new Request(uploadUrl('alpha', ELSEWHERE), { method: 'POST', body: 'uploaded', duplex: 'half' } as RequestInit),
    personSeeing('alpha'),
  )
  assert.equal(response.status, 403)
  assert.deepEqual(asked, [])
  assert.deepEqual(written, [])
})

const lines = async (response: Response) =>
  (await response.text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))

const archiveRequest = (name: 'pack' | 'unpack', space: string, body: unknown, source = SOURCE) =>
  new Request(`${ORIGIN}/${name}?space=${space}&source=${encodeURIComponent(source)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

test('a pack answers its progress line by line, then its result', async () => {
  const response = await sessionRoute(fakeHost().host, 'pack').handler(
    archiveRequest('pack', 'alpha', { paths: ['/a.txt'] }),
    personSeeing('alpha'),
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/x-ndjson')
  const answer = await lines(response)
  assert.deepEqual(answer.at(-1), { result: { name: 'pack', body: { paths: ['/a.txt'] } } })
  assert.deepEqual(answer.at(-2), { progress: { done: 2, total: 2 } }, 'the last progress is always sent')
})

test('an unpack that fails answers its error as the last line', async () => {
  const response = await sessionRoute(fakeHost().host, 'unpack').handler(
    archiveRequest('unpack', 'alpha', { archive: '/a.zip', fail: true }),
    personSeeing('alpha'),
  )
  assert.deepEqual((await lines(response)).at(-1), { error: 'it failed' })
})

test("a pack in a space the person doesn't see is refused before it runs", async () => {
  ran.length = 0
  const { host, asked } = fakeHost()
  const response = await sessionRoute(host, 'pack').handler(
    archiveRequest('pack', 'beta', { paths: ['/a.txt'] }),
    personSeeing('alpha'),
  )
  assert.equal(response.status, 403)
  assert.deepEqual(asked, [])
  assert.deepEqual(ran, [])
})

test("a pack on a terminal in a space the person doesn't see is refused before it runs", async () => {
  ran.length = 0
  const { host, asked } = fakeHost()
  const response = await sessionRoute(host, 'pack').handler(
    archiveRequest('pack', 'alpha', { paths: ['/a.txt'] }, ELSEWHERE),
    personSeeing('alpha'),
  )
  assert.equal(response.status, 403)
  assert.deepEqual(asked, [])
  assert.deepEqual(ran, [])
})

test('a pack whose body is not a JSON object is refused before it runs', async () => {
  ran.length = 0
  const response = await sessionRoute(fakeHost().host, 'pack').handler(
    archiveRequest('pack', 'alpha', ['/a.txt']),
    personSeeing('alpha'),
  )
  assert.equal(response.status, 400)
  assert.deepEqual(ran, [])
})

test('the sources listing covers every space the person sees, with their names', async () => {
  const { host, listed } = fakeHost()
  const response = await sessionRoute(host, 'sources').handler(
    new Request(`${ORIGIN}/sources?space=alpha`),
    personSeeing('alpha', 'gamma'),
  )
  assert.equal(response.status, 200)
  assert.deepEqual(listed, [{ space: 'alpha', visible: ['alpha', 'gamma'] }])
  const body = (await response.json()) as { spaces: { slug: string; name: string }[] }
  assert.deepEqual(
    body.spaces.map((entry) => entry.name),
    ['Space alpha', 'Space gamma'],
  )
})

test("the sources listing of an App whose space the person doesn't see is refused", async () => {
  const { host, listed } = fakeHost()
  const response = await sessionRoute(host, 'sources').handler(
    new Request(`${ORIGIN}/sources?space=beta`),
    personSeeing('alpha'),
  )
  assert.equal(response.status, 403)
  assert.deepEqual(listed, [])
})

test("container states are read for the person's spaces only", async () => {
  const { host } = fakeHost()
  const response = await sessionRoute(host, 'container-states').handler(
    new Request(`${ORIGIN}/container-states?space=alpha`),
    personSeeing('alpha', 'gamma'),
  )
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { alpha: 'running', gamma: 'running' })
})
