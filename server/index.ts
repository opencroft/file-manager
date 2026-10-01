import host from '@ext/host'
import type * as opencroft from '@opencroft/server'

export { actions } from './actions'
export { routes } from './routes'

// The two storage keys from before connections were scoped to a space. Nothing
// reads them any more — every live key carries its space, as "connections:<space>"
// — so they are removed by exact name on activation.
//
// By name, and never by clearing this extension's prefix: a prefix sweep would
// take the per-space keys that replaced them. And through host.storage.delete
// rather than any shortcut, because every extension's storage shares one settings
// row, and a write that skips its lock silently drops whichever concurrent write
// lands second.
//
// This is one-shot work with no second use: drop it once every instance has
// activated the extension at least once.
const PRE_APP_KEYS = ['connections', 'sourceSettings']

async function forgetPreAppStorage(): Promise<void> {
  const present = new Set(await host.storage.list())
  for (const key of PRE_APP_KEYS) {
    if (present.has(key)) {
      await host.storage.delete(key)
      console.log(`[file-manager] removed pre-App storage key "${key}"`)
    }
  }
}

export async function load(context: opencroft.ExtensionContext) {
  // A cleanup that cannot run is not a reason to refuse the extension.
  await forgetPreAppStorage().catch((err) => {
    console.error('[file-manager] could not remove pre-App storage keys', err)
  })
}

export function unload(context: opencroft.ExtensionContext) {}
