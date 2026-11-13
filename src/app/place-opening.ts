/** A place browsing has settled on: which source, under which root, in which space. */
export interface SettledPlace {
  space: string
  placeId: string
  rootPath?: string
}

/**
 * The path browsing opens at when `next` becomes the active place, or
 * `undefined` when `next` is the place already settled on and the current
 * location stands.
 *
 * - The first place to settle opens at `initialPath` (a reload, deep link or
 *   new tab restoring its location).
 * - The same place under the same root is not a new location. Seeing it again
 *   means the caller ran twice for one change (a mount effect re-run), or its
 *   inputs were rebuilt without changing (a sources refresh that kept the place).
 * - A different place that browsing itself just moved to (`navigatedTo`: a
 *   place or a bookmark pressed in the sidebar) is that move being reported
 *   back, and the location it opened stands.
 * - Anything else, a different place or the same place re-rooted, opens at "/":
 *   every path held so far is relative to the old place's root.
 */
export function placeOpeningPath(
  previous: SettledPlace | undefined,
  next: SettledPlace,
  initialPath: string | undefined,
  navigatedTo?: string,
): string | undefined {
  if (!previous) {
    return initialPath || '/'
  }
  const isSamePlace =
    previous.space === next.space && previous.placeId === next.placeId && previous.rootPath === next.rootPath
  if (
    isSamePlace ||
    (previous.space === next.space && previous.placeId !== next.placeId && navigatedTo === next.placeId)
  ) {
    return undefined
  }
  return '/'
}
