import type { AppActionContext, AppInstanceContext, AppServerHooks } from '@opencroft/server/apps'
import { storage } from '@opencroft/server/storage'

import { archiveActions } from './archives'
import { bookmarked, type PlaceRef, type Places, usedRecently, without, withoutBookmarkedRecent } from './place-lists'

const TERM_PREFIX = 'term:'

// Per app instance and per person: the same person sees the same lists on every
// device, and nobody sees anyone else's.
const keyPrefix = (instanceId: string) => `places:${instanceId}:`
const placesKey = (instanceId: string, personId: string) => `${keyPrefix(instanceId)}${personId}`

function requirePerson(ctx: AppActionContext): string {
  const id = ctx.callerPerson?.id
  if (!id) {
    throw new Error('Bookmarks and Recent belong to a signed-in person; open the File Manager to use them')
  }
  return id
}

function requirePlace(params: Record<string, unknown>): PlaceRef {
  const { source, path } = params
  if (typeof source !== 'string' || !source.startsWith(TERM_PREFIX)) {
    throw new Error('"source" must be a terminal source ref (term:<nodeId>/<handleId>)')
  }
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new Error('"path" must be an absolute folder path')
  }
  return { source, path }
}

async function readPlaces(key: string): Promise<Places> {
  const stored = await storage.get<Places>(key)
  return withoutBookmarkedRecent({ bookmarks: stored?.bookmarks ?? [], recent: stored?.recent ?? [] })
}

// Every change is a read-modify-write of one key, and one person can send two
// at once (two uploads finishing together). Queued per key in this process so
// the second reads what the first wrote instead of overwriting it.
const queues = new Map<string, Promise<unknown>>()

function updatePlaces(key: string, change: (places: Places) => Places): Promise<Places> {
  const run = (queues.get(key) ?? Promise.resolve()).then(async () => {
    const next = change(await readPlaces(key))
    await storage.set(key, next)
    return next
  })
  const settled = run.catch(() => undefined)
  queues.set(key, settled)
  settled.then(() => {
    if (queues.get(key) === settled) {
      queues.delete(key)
    }
  })
  return run
}

function changeAction(change: (places: Places, place: PlaceRef) => Places) {
  return (ctx: AppActionContext, params: Record<string, unknown>) => {
    const place = requirePlace(params)
    return updatePlaces(placesKey(ctx.instanceId, requirePerson(ctx)), (places) => change(places, place))
  }
}

async function forgetInstance(ctx: AppInstanceContext): Promise<void> {
  const prefix = keyPrefix(ctx.instanceId)
  for (const key of await storage.list()) {
    if (key.startsWith(prefix)) {
      await storage.delete(key)
    }
  }
}

/**
 * The File Manager App's server half: the calling person's Bookmarks and
 * Recent folders, run from the App's own UI (`callAppAction`), which is what
 * binds `ctx.callerPerson`, each answering the lists as they now stand; and
 * pack and unpack, which agents call.
 */
export const fileManagerApp: AppServerHooks = {
  actions: {
    ...archiveActions,
    places: (ctx) => readPlaces(placesKey(ctx.instanceId, requirePerson(ctx))),
    recordRecent: changeAction(usedRecently),
    addBookmark: changeAction(bookmarked),
    removeBookmark: changeAction((places, place) => ({ ...places, bookmarks: without(places.bookmarks, place) })),
  },
  onRemoved: forgetInstance,
}
