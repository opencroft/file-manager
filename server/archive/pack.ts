// Packing files and folders of any source into a zip archive. The archive is
// built here, from the source's own reads, so the source needs no zip tool.
// Free of host imports, so it runs under test with a fake Provider.

import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'

import yazl from 'yazl'

import { baseName, joinPath, parentPath } from '../providers/paths'
import type { FileEntry, Provider } from '../types'
import { createFree, listAll } from './folder'
import { archiveName } from './names'
import { type ArchiveRunOptions, abortReason, counted, destroyOnAbort } from './progress'

/** One entry of an archive being packed: where it is read from and what it is called inside. */
export interface PackEntry {
  /** Its path on the source. */
  source: string
  /** Its path inside the archive: relative, `/`-separated, no trailing slash. */
  name: string
  kind: 'file' | 'directory'
  size: number
  modified?: Date
}

// A folder nested deeper than this is taken to be a link to one of its own
// ancestors, which a listing that follows links would walk forever.
const MAX_DEPTH = 64

function modifiedOf(entry: FileEntry): Date | undefined {
  const date = entry.modified ? new Date(entry.modified) : undefined
  return date && !Number.isNaN(date.getTime()) ? date : undefined
}

/**
 * The entries `paths` name, each read from its folder's listing (so a path
 * may come with or without a folder's trailing slash). Throws for a path that
 * is not there, and for two with one name, which an archive could not tell apart.
 */
export async function describePaths(provider: Provider, paths: string[]): Promise<FileEntry[]> {
  if (!paths.length) {
    throw new Error('Nothing to pack: no paths given')
  }
  const listings = new Map<string, Promise<FileEntry[]>>()
  const items: FileEntry[] = []
  for (const path of paths) {
    const folder = parentPath(path)
    if (!listings.has(folder)) {
      listings.set(folder, listAll(provider, folder))
    }
    const name = baseName(path)
    const entry = (await listings.get(folder))?.find((e) => e.name === name)
    if (!entry || !name) {
      throw new Error(`"${path}" was not found`)
    }
    if (items.some((item) => item.name === name)) {
      throw new Error(`Two of the items to pack are named "${name}"; an archive holds one entry per name`)
    }
    items.push(entry)
  }
  return items
}

/** Everything an archive of `items` holds: each item, and each folder's content all the way down. */
export async function packEntries(provider: Provider, items: FileEntry[], signal?: AbortSignal): Promise<PackEntry[]> {
  const out: PackEntry[] = []
  const walk = async (entry: FileEntry, name: string, depth: number) => {
    signal?.throwIfAborted()
    if (entry.type === 'file') {
      out.push({ source: entry.path, name, kind: 'file', size: entry.size, modified: modifiedOf(entry) })
      return
    }
    if (depth > MAX_DEPTH) {
      throw new Error(`"${entry.path}" is nested more than ${MAX_DEPTH} folders deep; a link to a folder above it?`)
    }
    out.push({ source: entry.path, name, kind: 'directory', size: 0, modified: modifiedOf(entry) })
    for (const child of await listAll(provider, entry.path)) {
      await walk(child, `${name}/${child.name}`, depth + 1)
    }
  }
  for (const item of items) {
    await walk(item, item.name, 0)
  }
  return out
}

/**
 * A zip archive of `entries`, as a stream: the files are read from the source
 * one at a time, each opened only when the archive reaches it. `onBytes` hears
 * of every chunk of file content read. The stream errors when a read fails,
 * and destroying it stops the read in progress. Where it goes is the caller's:
 * a file on a source (packInto), or a download.
 */
export function zipStream(provider: Provider, entries: PackEntry[], onBytes?: (bytes: number) => void): Readable {
  const zip = new yazl.ZipFile()
  const output = zip.outputStream as Readable
  let reading: Readable | undefined
  const fail = (err: Error) => output.destroy(err)
  zip.on('error', fail)
  output.on('close', () => reading?.destroy())

  for (const entry of entries) {
    const options = entry.modified ? { mtime: entry.modified } : {}
    if (entry.kind === 'directory') {
      zip.addEmptyDirectory(entry.name, options)
      continue
    }
    zip.addReadStreamLazy(entry.name, options, (callback) => {
      provider.readStream(entry.source).then(({ stream }) => {
        reading = stream
        // yazl pipes what it is given without listening for its errors.
        const content = onBytes ? counted(stream, onBytes) : stream
        content.on('error', fail)
        callback(null, content)
      }, fail)
    })
  }
  zip.end()
  return output
}

/** A zip of some files and folders, made to be downloaded. */
export interface ZipDownload {
  /** What to save it as: archiveName of the items. */
  name: string
  stream: Readable
}

/**
 * A zip of `paths` (folders recursively) to be streamed into a download. The
 * items are looked up and the folders walked before the stream exists, so a
 * path that is not there throws here; a read failing later errors the stream.
 * Aborting `signal` destroys the stream, which stops the read in progress.
 */
export async function zipDownload(provider: Provider, paths: string[], signal?: AbortSignal): Promise<ZipDownload> {
  const items = await describePaths(provider, paths)
  const entries = await packEntries(provider, items, signal)
  signal?.throwIfAborted()
  const stream = zipStream(provider, entries)
  const stopWatching = destroyOnAbort(signal, stream)
  stream.on('close', stopWatching)
  return { name: archiveName(items.map(itemOf)), stream }
}

export interface PackRequest {
  /** The files and folders to pack; their names are the archive's top level. */
  paths: string[]
  /** The folder the archive goes into. Default: the first path's folder. */
  target?: string
  /** The archive's name, before a clash makes it a free one. Default: from the items (archiveName). */
  name?: string
}

export interface PackResult {
  /** The archive's path on the source. */
  path: string
  name: string
  files: number
  folders: number
  /** File content packed, in bytes, before compression. */
  bytes: number
}

/**
 * Packs `paths` into a new zip archive in the target folder, under a free
 * name. The name is taken first (an empty file), and the archive is written
 * beside it under a hidden temporary name and moved onto it once complete. A
 * failure or an abort removes both, so nothing half-written is left under
 * the archive's name.
 */
export async function packInto(
  provider: Provider,
  request: PackRequest,
  { onProgress, signal }: ArchiveRunOptions = {},
): Promise<PackResult> {
  const items = await describePaths(provider, request.paths)
  const entries = await packEntries(provider, items, signal)
  const files = entries.filter((entry) => entry.kind === 'file')
  const total = files.reduce((sum, entry) => sum + entry.size, 0)
  let done = 0
  onProgress?.({ done, total })

  const target = request.target ?? parentPath(request.paths[0])
  signal?.throwIfAborted()
  const name = await createFree(provider, target, request.name ?? archiveName(items.map(itemOf)), 'file')
  const path = joinPath(target, name)
  const temp = joinPath(target, `.${name}.${randomUUID().slice(0, 8)}.part`)

  const stream = zipStream(provider, entries, (bytes) => {
    done += bytes
    onProgress?.({ done, total })
  })
  const stopWatching = destroyOnAbort(signal, stream)
  try {
    await provider.writeStream(target, baseName(temp), stream)
    if (signal?.aborted) {
      throw abortReason(signal)
    }
    // The empty file holding the name goes first: not every source's rename
    // replaces an existing file (SFTP's refuses).
    await provider.delete(path)
    await provider.rename(temp, path)
  } catch (err) {
    stream.destroy()
    await Promise.allSettled([provider.delete(temp), provider.delete(path)])
    throw err
  } finally {
    stopWatching()
  }
  return { path, name, files: files.length, folders: entries.length - files.length, bytes: done }
}

function itemOf(entry: FileEntry): { name: string; kind: 'file' | 'directory' } {
  return { name: entry.name, kind: entry.type }
}
