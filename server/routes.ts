import { Readable } from 'node:stream'

import type { ExtensionRouteContext, ExtensionRoutes } from '@opencroft/server/routes'

import { zipDownload } from './archive/pack'
import type { ArchiveProgress, ArchiveRunOptions } from './archive/progress'
import type { ContainerState } from './container-states'
import type { ListSourcesResult } from './sources'
import { NotATerminalError } from './terminal-index'
import type { Provider } from './types'

// These routes run outside the TanStack Start request context (they're dispatched
// by a raw Nitro handler, not a Start route), so everything they reach has to work
// without one: storage, graph.listHandles and terminal.getContext, which
// getProviderForRef and the listings resolve through, do, the same as secrets.

/** getProviderForRef: passed in, so the routes can be exercised without the host. */
export type ProviderFor = (space: string, ref: string) => Promise<Provider>

/** A pack or an unpack (server/archives.ts): passed in, so the routes can be exercised without the host. */
export type ArchiveRun = (
  provider: Provider,
  body: Record<string, unknown>,
  options: ArchiveRunOptions,
) => Promise<unknown>

/** What the routes reach the host through, passed in so they can be exercised without it. */
export interface RouteHost {
  providerFor: ProviderFor
  archives: { pack: ArchiveRun; unpack: ArchiveRun }
  /** The space a terminal ref is in; rejects with NotATerminalError when no space lists it. */
  terminalSpaceOf: (ref: string) => Promise<string>
  /** The sidebar's listing for the App in `space`, with the terminals of the `visible` spaces. */
  listSources: (space: string, visible: readonly { slug: string; name: string }[]) => Promise<ListSourcesResult>
  /** Whether each container terminal of the `visible` spaces is running. */
  containerStates: (visible: readonly { slug: string }[]) => Promise<Record<string, ContainerState>>
}

const TERM_PREFIX = 'term:'

class MissingParamError extends Error {}

class SpaceNotVisibleError extends Error {}

function requireParam(url: URL, name: string): string {
  const value = url.searchParams.get(name)
  if (!value) {
    throw new MissingParamError(`Missing required query param "${name}"`)
  }
  return value
}

/** The request's `space` (the App's) and the spaces the signed-in person sees, which must include it. */
async function requireVisibleSpace(url: URL, context: ExtensionRouteContext) {
  const space = requireParam(url, 'space')
  const visible = await context.spaces.list()
  if (!visible.some((entry) => entry.slug === space)) {
    throw new SpaceNotVisibleError(`Space "${space}" is not one of yours`)
  }
  return { space, visible }
}

/**
 * Refuses a terminal in a space the person doesn't see. A terminal may be in
 * any of their spaces, not only the App's; a connection is the App's space's.
 */
async function requireReachableSource(
  host: RouteHost,
  source: string,
  visible: readonly { slug: string }[],
): Promise<void> {
  if (!source.startsWith(TERM_PREFIX)) {
    return
  }
  const space = await host.terminalSpaceOf(source)
  if (!visible.some((entry) => entry.slug === space)) {
    throw new SpaceNotVisibleError(`Source "${source}" is in a space that is not one of yours`)
  }
}

function statusOf(err: unknown): number {
  if (err instanceof MissingParamError) {
    return 400
  }
  if (err instanceof SpaceNotVisibleError || err instanceof NotATerminalError) {
    return 403
  }
  return 500
}

function errorResponse(err: unknown): Response {
  return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: statusOf(err) })
}

function filenameOf(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || 'download'
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'")
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

async function download(host: RouteHost, request: Request, context: ExtensionRouteContext): Promise<Response> {
  try {
    const url = new URL(request.url)
    const { space, visible } = await requireVisibleSpace(url, context)
    const source = requireParam(url, 'source')
    const path = requireParam(url, 'path')
    await requireReachableSource(host, source, visible)

    const provider = await host.providerFor(space, source)
    const { stream, size } = await provider.readStream(path)

    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': contentDisposition(filenameOf(path)),
    }
    if (typeof size === 'number') {
      headers['Content-Length'] = String(size)
    }

    return new Response(Readable.toWeb(stream) as ReadableStream, { headers })
  } catch (err) {
    return errorResponse(err)
  }
}

/** The form's `path` fields: a form POST, so a selection of any size fits. */
async function formPaths(request: Request): Promise<string[]> {
  const form = await request.formData().catch(() => undefined)
  const paths = (form?.getAll('path') ?? []).filter(
    (value): value is string => typeof value === 'string' && value !== '',
  )
  if (!paths.length) {
    throw new MissingParamError('Missing form field "path"')
  }
  return paths
}

/**
 * Several files and folders downloaded as one zip, built from the source's
 * own reads while it streams out: nothing is written on the source. A path
 * that is not there is refused before the download starts; a read that fails
 * later cuts the download short, which the browser reports as failed. The
 * client going away stops the reads.
 */
async function downloadZip(host: RouteHost, request: Request, context: ExtensionRouteContext): Promise<Response> {
  try {
    const url = new URL(request.url)
    const { space, visible } = await requireVisibleSpace(url, context)
    const source = requireParam(url, 'source')
    const paths = await formPaths(request)
    await requireReachableSource(host, source, visible)

    const provider = await host.providerFor(space, source)
    const { name, stream } = await zipDownload(provider, paths, request.signal)
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: { 'Content-Type': 'application/zip', 'Content-Disposition': contentDisposition(name) },
    })
  } catch (err) {
    return errorResponse(err)
  }
}

async function upload(host: RouteHost, request: Request, context: ExtensionRouteContext): Promise<Response> {
  try {
    const url = new URL(request.url)
    const { space, visible } = await requireVisibleSpace(url, context)
    const source = requireParam(url, 'source')
    const path = requireParam(url, 'path')
    const filename = requireParam(url, 'filename')

    if (!request.body) {
      throw new MissingParamError('Missing request body')
    }
    await requireReachableSource(host, source, visible)

    const provider = await host.providerFor(space, source)
    const stream = Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0])
    await provider.writeStream(path, filename, stream)

    return Response.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}

// How often a running pack or unpack reports its progress, at most.
const PROGRESS_INTERVAL_MS = 250

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => undefined)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new MissingParamError('The request body must be a JSON object')
  }
  return body as Record<string, unknown>
}

/**
 * Runs a pack or unpack and answers with its course as it goes, one JSON
 * object per line: `{"progress":{"done","total"}}` now and then, and last
 * either `{"result":…}` or `{"error":"…"}`. A refusal before the run starts
 * (missing parameter, a space not the person's) answers as the other routes
 * do. The client going away (a Cancel) aborts the run, which then cleans up.
 */
async function archiveRoute(
  host: RouteHost,
  run: ArchiveRun,
  request: Request,
  context: ExtensionRouteContext,
): Promise<Response> {
  let provider: Provider
  let body: Record<string, unknown>
  try {
    const url = new URL(request.url)
    const { space, visible } = await requireVisibleSpace(url, context)
    const source = requireParam(url, 'source')
    body = await requestBody(request)
    await requireReachableSource(host, source, visible)
    provider = await host.providerFor(space, source)
  } catch (err) {
    return errorResponse(err)
  }

  const controller = new AbortController()
  request.signal?.addEventListener('abort', () => controller.abort(), { once: true })
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(sink) {
      const send = (message: unknown) => {
        if (!controller.signal.aborted) {
          sink.enqueue(encoder.encode(`${JSON.stringify(message)}\n`))
        }
      }
      let lastSent = 0
      const onProgress = (progress: ArchiveProgress) => {
        const now = Date.now()
        if (now - lastSent >= PROGRESS_INTERVAL_MS || progress.done === progress.total) {
          lastSent = now
          send({ progress })
        }
      }
      try {
        send({ result: await run(provider, body, { onProgress, signal: controller.signal }) })
      } catch (err) {
        send({ error: err instanceof Error ? err.message : String(err) })
      }
      if (!controller.signal.aborted) {
        sink.close()
      }
    },
    cancel() {
      controller.abort()
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } })
}

async function sources(host: RouteHost, request: Request, context: ExtensionRouteContext): Promise<Response> {
  try {
    const { space, visible } = await requireVisibleSpace(new URL(request.url), context)
    return Response.json(await host.listSources(space, visible))
  } catch (err) {
    return errorResponse(err)
  }
}

async function containerStates(host: RouteHost, request: Request, context: ExtensionRouteContext): Promise<Response> {
  try {
    const { visible } = await requireVisibleSpace(new URL(request.url), context)
    return Response.json(await host.containerStates(visible))
  } catch (err) {
    return errorResponse(err)
  }
}

/**
 * The App's routes. Each reaches terminals or their files, so each is a
 * session route: the host answers 401 without a session (and the handler
 * never runs), and refuses any POST (an upload, a zip download, a pack or an
 * unpack) sent from another site. The person must see `space`, the App's, and
 * any terminal named must be in a space they see. `sources` lists the
 * sidebar's places; `container-states` says which of the listed containers
 * run, apart from it, since it asks each Docker host.
 */
export function fileManagerRoutes(host: RouteHost): ExtensionRoutes {
  return {
    download: { session: 'person', handler: (request, context) => download(host, request, context) },
    'download-zip': { session: 'person', handler: (request, context) => downloadZip(host, request, context) },
    upload: { session: 'person', handler: (request, context) => upload(host, request, context) },
    pack: {
      session: 'person',
      handler: (request, context) => archiveRoute(host, host.archives.pack, request, context),
    },
    unpack: {
      session: 'person',
      handler: (request, context) => archiveRoute(host, host.archives.unpack, request, context),
    },
    sources: { session: 'person', handler: (request, context) => sources(host, request, context) },
    'container-states': {
      session: 'person',
      handler: (request, context) => containerStates(host, request, context),
    },
  }
}
