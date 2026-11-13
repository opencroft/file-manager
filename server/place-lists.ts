/**
 * A folder on one terminal source: its `term:` ref and the folder's full path
 * on that terminal (what Copy path gives, not the listing's root-relative
 * one), so changing the terminal's root path cannot point it elsewhere.
 */
export interface PlaceRef {
  source: string
  path: string
}

/** One person's Bookmarks and Recent folders in one File Manager app, each newest first. */
export interface Places {
  bookmarks: PlaceRef[]
  recent: PlaceRef[]
}

export const RECENT_LIMIT = 10

function samePlace(a: PlaceRef, b: PlaceRef): boolean {
  return a.source === b.source && a.path === b.path
}

/** `place` first, any earlier copy of it dropped, cut to `limit`. */
export function withFirst(list: PlaceRef[], place: PlaceRef, limit = Number.POSITIVE_INFINITY): PlaceRef[] {
  return [place, ...list.filter((p) => !samePlace(p, place))].slice(0, limit)
}

export function without(list: PlaceRef[], place: PlaceRef): PlaceRef[] {
  return list.filter((p) => !samePlace(p, place))
}

// A folder is in Bookmarks or in Recent, never both: bookmarking moves it out
// of Recent, and using a bookmarked folder leaves Recent as it is.

/** Bookmarks `place` first and drops it from Recent. */
export function bookmarked(places: Places, place: PlaceRef): Places {
  return { bookmarks: withFirst(places.bookmarks, place), recent: without(places.recent, place) }
}

/** `place` first in Recent, unless it is bookmarked. */
export function usedRecently(places: Places, place: PlaceRef): Places {
  if (places.bookmarks.some((b) => samePlace(b, place))) {
    return places
  }
  return { ...places, recent: withFirst(places.recent, place, RECENT_LIMIT) }
}

/** Recent without the bookmarked folders: applied on read, so stored lists that hold a folder in both show it once. */
export function withoutBookmarkedRecent(places: Places): Places {
  return { ...places, recent: places.recent.filter((r) => !places.bookmarks.some((b) => samePlace(b, r))) }
}
