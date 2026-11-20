import { cacheDir } from '@opencroft/server/storage'

import { packInto } from './archive/pack'
import { packRequestOf, unpackRequestOf } from './archive/params'
import type { ArchiveRunOptions } from './archive/progress'
import { unpackInto } from './archive/unpack'
import { type ArchiveActionHost, archiveAction } from './archive-actions'
import { getProviderForAgent, getProviderForRef } from './connections'
import { terminalSpaceOf } from './terminal-sources'
import type { Provider } from './types'

// Pack and unpack as the routes (the App's own UI, with progress) and the App
// actions (agents) both run them: the same request checks, the same code.

export function runPack(provider: Provider, params: Record<string, unknown>, options: ArchiveRunOptions) {
  return packInto(provider, packRequestOf(params), options)
}

export function runUnpack(provider: Provider, params: Record<string, unknown>, options: ArchiveRunOptions) {
  return unpackInto(provider, unpackRequestOf(params), { ...options, tempDir: cacheDir('unpack') })
}

const actionHost: ArchiveActionHost = {
  terminalSpaceOf,
  providerFor: (spaceSlug, ref, byPerson) => (byPerson ? getProviderForRef : getProviderForAgent)(spaceSlug, ref),
}

/** The App actions agents pack and unpack with. */
export const archiveActions = {
  pack: archiveAction(actionHost, runPack),
  unpack: archiveAction(actionHost, runUnpack),
}
