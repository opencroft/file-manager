import { callAppAction } from '@opencroft/client/actions'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import type { PlaceRef, Places } from './types'

const NO_PLACES: Places = { bookmarks: [], recent: [] }

export function isBookmarked(places: Places, place: PlaceRef): boolean {
  return places.bookmarks.some((b) => b.source === place.source && b.path === place.path)
}

/**
 * The signed-in person's Bookmarks and Recent folders in this File Manager
 * app, kept by the App's server half (server/places.ts) so they follow the
 * person to every device. Each change answers the lists as they now stand,
 * and that answer replaces what is shown.
 */
export function usePlaces(instanceId: string) {
  const [places, setPlaces] = useState<Places>(NO_PLACES)

  const call = useCallback(
    async (action: string, params?: Record<string, unknown>) => {
      try {
        setPlaces(await callAppAction<Places>(instanceId, action, params))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    },
    [instanceId],
  )

  useEffect(() => {
    call('places')
  }, [call])

  const recordRecent = useCallback((place: PlaceRef) => call('recordRecent', { ...place }), [call])
  const addBookmark = useCallback((place: PlaceRef) => call('addBookmark', { ...place }), [call])
  const removeBookmark = useCallback((place: PlaceRef) => call('removeBookmark', { ...place }), [call])
  const toggleBookmark = useCallback(
    (place: PlaceRef) => (isBookmarked(places, place) ? removeBookmark(place) : addBookmark(place)),
    [places, addBookmark, removeBookmark],
  )

  return { places, recordRecent, addBookmark, removeBookmark, toggleBookmark }
}
