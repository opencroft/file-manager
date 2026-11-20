// What packing and unpacking need of a folder on any source: everything in it,
// and a new entry in it under a name nobody has. Free of host imports.

import { alreadyExists } from '../providers/create'
import { joinPath } from '../providers/paths'
import type { FileEntry, Provider } from '../types'
import { freeName } from './names'

/** Every entry of `folder`, across all of its listing's pages. */
export async function listAll(provider: Provider, folder: string): Promise<FileEntry[]> {
  const entries: FileEntry[] = []
  let cursor: string | undefined
  do {
    const page = await provider.list(folder, cursor)
    entries.push(...page.entries)
    cursor = page.nextCursor
  } while (cursor)
  return entries
}

// Attempts before giving up on a folder whose names keep being taken between
// the listing and the create: each failed one is someone else creating that
// very name at that moment.
const RESERVE_ATTEMPTS = 20

/**
 * Creates an empty file or a folder in `folder` under `name`, or under the
 * first free name after it (freeName) when it is taken, and answers the name
 * it got. The create itself refuses a taken name, so a name taken after the
 * listing is never overwritten: the next one is tried instead.
 */
export async function createFree(
  provider: Provider,
  folder: string,
  name: string,
  kind: 'file' | 'directory',
): Promise<string> {
  const taken = new Set((await listAll(provider, folder)).map((entry) => entry.name))
  for (let attempt = 0; attempt < RESERVE_ATTEMPTS; attempt++) {
    const candidate = freeName(name, taken)
    const path = joinPath(folder, candidate)
    try {
      await (kind === 'directory' ? provider.mkdir(path) : provider.createFile(path))
      return candidate
    } catch (err) {
      if (!(err instanceof Error) || err.message !== alreadyExists(path).message) {
        throw err
      }
      taken.add(candidate)
    }
  }
  throw new Error(`Could not find a free name for "${name}"`)
}
