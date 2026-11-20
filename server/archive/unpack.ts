// Unpacking a zip archive on any source into a new folder beside it. The
// archive is read here, from the source's own reads and writes, so the source
// needs no unzip tool. Free of host imports, so it runs under test with a
// fake Provider.

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import nodePath from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import yauzl from 'yauzl'

import { baseName, joinPath, parentPath } from '../providers/paths'
import type { Provider } from '../types'
import { createFree } from './folder'
import { EntryOutsideError, entrySegments, isMacMetadata, unpackFolderName } from './names'
import { type ArchiveRunOptions, abortReason, counted, counting, destroyOnAbort } from './progress'

export interface UnpackRequest {
  /** The archive's path on the source. */
  archive: string
  /** The folder the new folder goes into. Default: the archive's own folder. */
  target?: string
}

export interface UnpackResult {
  /** The new folder's path on the source, with its trailing slash. */
  path: string
  name: string
  files: number
  folders: number
  /** File content unpacked, in bytes. */
  bytes: number
  /** Entries left out: symbolic links, and the `__MACOSX/` metadata Finder adds. */
  skipped: { links: number; macMetadata: number }
}

interface PlannedEntry {
  segments: string[]
  directory: boolean
  entry: yauzl.Entry
}

// An entry stored by a Unix tool with the symbolic-link file type: its content
// is the link's target. Written out it would be a file holding that path, and
// a source's write has no way to make a link, so it is left out.
const UNIX_HOST = 3
const FILE_TYPE_MASK = 0o170000
const SYMLINK_TYPE = 0o120000

function isSymlink(entry: yauzl.Entry): boolean {
  return (
    entry.versionMadeBy >> 8 === UNIX_HOST && ((entry.externalFileAttributes >>> 16) & FILE_TYPE_MASK) === SYMLINK_TYPE
  )
}

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      file,
      // strictFileNames off reads a backslash as a separator; names that
      // leave the folder are refused either way (entrySegments, refusal).
      { lazyEntries: true, autoClose: false, decodeStrings: true, strictFileNames: false, validateEntrySizes: true },
      (err, zip) => (err ? reject(err) : resolve(zip)),
    )
  })
}

// yauzl refuses an absolute or `..` name itself while reading the central
// directory, before entrySegments sees it; its message is turned into ours.
function refusal(err: unknown): unknown {
  const match = err instanceof Error ? /^(?:invalid relative path|absolute path): (.*)$/.exec(err.message) : null
  return match ? new EntryOutsideError(match[1]) : err
}

function readEntries(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: yauzl.Entry[] = []
    zip.on('entry', (entry: yauzl.Entry) => {
      entries.push(entry)
      zip.readEntry()
    })
    zip.on('end', () => resolve(entries))
    zip.on('error', (err) => reject(refusal(err)))
    zip.readEntry()
  })
}

/**
 * What unpacking `entries` writes, checked whole before anything is: every
 * name must stay inside the folder (else EntryOutsideError for the archive).
 */
export function planEntries(entries: yauzl.Entry[]): {
  planned: PlannedEntry[]
  skipped: UnpackResult['skipped']
} {
  const planned: PlannedEntry[] = []
  const skipped = { links: 0, macMetadata: 0 }
  for (const entry of entries) {
    const segments = entrySegments(entry.fileName)
    if (!segments.length) {
      continue
    }
    if (isMacMetadata(segments)) {
      skipped.macMetadata++
    } else if (isSymlink(entry)) {
      skipped.links++
    } else {
      planned.push({ segments, directory: /[/\\]$/.test(entry.fileName), entry })
    }
  }
  return { planned, skipped }
}

/**
 * Unpacks the zip archive at `request.archive` into a new folder in the
 * target folder, named after the archive under a free name, so nothing
 * already there is touched. The archive is copied to `tempDir` first (a zip
 * is read from its end) and checked whole before the folder is made: an
 * entry that would land outside it refuses the archive with nothing written.
 * A failure or an abort after that removes the folder again.
 */
export async function unpackInto(
  provider: Provider,
  request: UnpackRequest,
  { onProgress, signal, tempDir }: ArchiveRunOptions & { tempDir: string },
): Promise<UnpackResult> {
  const archive = request.archive.replace(/\/+$/, '')
  const target = request.target ?? parentPath(archive)
  const { stream, size } = await provider.readStream(archive)
  const archiveSize = size ?? 0

  // One bar for both halves: copying the archive here, then writing what it
  // holds. Until the archive is read its content size is unknown, and is
  // counted as the archive's own size meanwhile.
  let done = 0
  let total = archiveSize * 2
  const advance = (bytes: number) => {
    done += bytes
    onProgress?.({ done, total })
  }
  onProgress?.({ done, total })

  await fs.promises.mkdir(tempDir, { recursive: true })
  const copy = nodePath.join(tempDir, `unpack-${randomUUID()}.zip`)
  let zip: yauzl.ZipFile | undefined
  try {
    await pipeline(stream, counting(advance), fs.createWriteStream(copy), { signal })
    zip = await openZip(copy)
    const { planned, skipped } = planEntries(await readEntries(zip))
    const files = planned.filter((p) => !p.directory)
    total = done + files.reduce((sum, p) => sum + p.entry.uncompressedSize, 0)
    onProgress?.({ done, total })

    signal?.throwIfAborted()
    const name = await createFree(provider, target, unpackFolderName(baseName(archive)), 'directory')
    const folder = joinPath(target, name)
    const contentStart = done
    try {
      const folders = await writeEntries(provider, zip, folder, planned, advance, signal)
      return {
        path: `${folder}/`,
        name,
        files: files.length,
        folders,
        bytes: done - contentStart,
        skipped,
      }
    } catch (err) {
      await provider.delete(`${folder}/`).catch(() => undefined)
      throw err
    }
  } finally {
    stream.destroy()
    zip?.close()
    await fs.promises.rm(copy, { force: true })
  }
}

// Writes the planned entries under `folder`, making each folder an entry
// names once, whether or not the archive lists it as an entry of its own (many
// Windows archives do not). Answers how many folders it made.
async function writeEntries(
  provider: Provider,
  zip: yauzl.ZipFile,
  folder: string,
  planned: PlannedEntry[],
  advance: (bytes: number) => void,
  signal: AbortSignal | undefined,
): Promise<number> {
  const made = new Set<string>()
  const ensureFolder = async (segments: string[]) => {
    for (let depth = 1; depth <= segments.length; depth++) {
      const relative = segments.slice(0, depth).join('/')
      if (!made.has(relative)) {
        await provider.mkdir(joinPath(folder, relative))
        made.add(relative)
      }
    }
  }
  for (const { segments, directory, entry } of planned) {
    if (signal?.aborted) {
      throw abortReason(signal)
    }
    if (directory) {
      await ensureFolder(segments)
      continue
    }
    const parents = segments.slice(0, -1)
    await ensureFolder(parents)
    const content: Readable = await zip.openReadStreamPromise(entry)
    const stopWatching = destroyOnAbort(signal, content)
    try {
      const into = parents.length ? joinPath(folder, parents.join('/')) : folder
      await provider.writeStream(into, segments[segments.length - 1], counted(content, advance))
    } finally {
      stopWatching()
    }
  }
  return made.size
}
