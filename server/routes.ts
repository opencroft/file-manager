import { Readable } from 'node:stream'

import type { ExtensionRouteContext, ExtensionRoutes } from '@opencroft/server/routes'

import { NotInSpaceError } from './space-terminals'
import type { Provider } from './types'

// These routes run outside the TanStack Start request context (they're dispatched
// by a raw Nitro handler, not a Start route), so everything they reach has to work
// without one: storage and terminal.getContext, which getProviderForRef
// resolves through, do, the same as graph and secrets.

/** getProviderForRef: passed in, so the routes can be exercised without the host. */
export type ProviderFor = (space: string, ref: string) => Promise<Provider>

class MissingParamError extends Error {}

class SpaceNotVisibleError extends Error {}

function requireParam(url: URL, name: string): string {
  const value = url.searchParams.get(name)
  if (!value) {
    throw new MissingParamError(`Missing required query param "${name}"`)
  }
  return value
}

/** The request's `space`, when the signed-in person sees it. */
async function requireVisibleSpace(url: URL, context: ExtensionRouteContext): Promise<string> {
  const space = requireParam(url, 'space')
  const visible = await context.spaces.list()
  if (!visible.some((entry) => entry.slug === space)) {
    throw new SpaceNotVisibleError(`Space "${space}" is not one of yours`)
  }
  return space
}

function statusOf(err: unknown): number {
  if (err instanceof MissingParamError) {
    return 400
  }
  if (err instanceof SpaceNotVisibleError || err instanceof NotInSpaceError) {
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

async function download(providerFor: ProviderFor, request: Request, context: ExtensionRouteContext): Promise<Response> {
  try {
    const url = new URL(request.url)
    const space = await requireVisibleSpace(url, context)
    const source = requireParam(url, 'source')
    const path = requireParam(url, 'path')

    const provider = await providerFor(space, source)
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

async function upload(providerFor: ProviderFor, request: Request, context: ExtensionRouteContext): Promise<Response> {
  try {
    const url = new URL(request.url)
    const space = await requireVisibleSpace(url, context)
    const source = requireParam(url, 'source')
    const path = requireParam(url, 'path')
    const filename = requireParam(url, 'filename')

    if (!request.body) {
      throw new MissingParamError('Missing request body')
    }

    const provider = await providerFor(space, source)
    const stream = Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0])
    await provider.writeStream(path, filename, stream)

    return Response.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}

/**
 * The file transfer routes. Both reach the files of a terminal or connection,
 * so both are session routes: the host answers 401 without a session (and the
 * handler never runs), and refuses an upload sent from another site. The
 * person must see `space`, and `providerFor` holds the source to that space.
 */
export function transferRoutes(providerFor: ProviderFor): ExtensionRoutes {
  return {
    download: { session: 'person', handler: (request, context) => download(providerFor, request, context) },
    upload: { session: 'person', handler: (request, context) => upload(providerFor, request, context) },
  }
}
