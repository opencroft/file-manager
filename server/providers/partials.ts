// What every lister of a source sees of upload partial files: none. Free of
// host imports, so it runs under test as is.

import type { Provider } from '../types'
import { isPartialUpload, stalePartials } from './upload'

/**
 * `provider` with the partial files of uploads left out of every listing,
 * and those no upload has written for STALE_PARTIAL_MS removed as their
 * folder is listed. The removal neither holds up nor fails the listing.
 */
export function withoutPartials(provider: Provider): Provider {
  return {
    ...provider,
    async list(path, cursor) {
      const listed = await provider.list(path, cursor)
      void Promise.allSettled(stalePartials(listed.entries, Date.now()).map((entry) => provider.delete(entry.path)))
      return { ...listed, entries: listed.entries.filter((entry) => !isPartialUpload(entry.name)) }
    },
  }
}
