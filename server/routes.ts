import { Readable } from 'node:stream'

import { getProviderForRef } from './connections'

// This route runs outside the TanStack Start request context (it's dispatched by a
// raw Nitro handler, not a Start route), so everything it reaches has to work
// without one: host.storage and host.terminal.getContext, which getProviderForRef
// resolves through, do, the same as host.graph and host.secrets.

class MissingParamError extends Error {}

function requireParam(url: URL, name: string): string {
  const value = url.searchParams.get(name)
  if (!value) {
    throw new MissingParamError(`Missing required query param "${name}"`)
  }
  return value
}

function errorResponse(err: unknown): Response {
  const status = err instanceof MissingParamError ? 400 : 500
  return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status })
}

function filenameOf(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || 'download'
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'")
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

async function downloadRoute(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const space = requireParam(url, 'space')
    const source = requireParam(url, 'source')
    const path = requireParam(url, 'path')

    const provider = await getProviderForRef(space, source)
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

async function uploadRoute(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const space = requireParam(url, 'space')
    const source = requireParam(url, 'source')
    const path = requireParam(url, 'path')
    const filename = requireParam(url, 'filename')

    if (!request.body) {
      throw new MissingParamError('Missing request body')
    }

    const provider = await getProviderForRef(space, source)
    const stream = Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0])
    await provider.writeStream(path, filename, stream)

    return Response.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}

export const routes = {
  download: downloadRoute,
  upload: uploadRoute,
}
