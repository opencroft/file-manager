import { React } from '@ext/host'

import { FileBrowser } from '@/components/ui/file-manager/file-browser'
import type { Crumb } from '@/components/ui/file-manager/file-toolbar'
import { useFileBrowser } from '@/components/ui/file-manager/use-file-browser'
import { deepLinkHref } from './deep-link'
import { useFileManagerHost, type FileManagerHost } from './use-file-manager-host'

const { useMemo } = React

function placeName(sections: FileManagerHost['sections'], placeId: string): string {
  for (const section of sections) {
    const item = section.items.find((i) => i.id === placeId)
    if (item) {
      return item.name
    }
  }
  return placeId
}

// Builds the full breadcrumb trail for a restored deep link, matching the entry-id
// convention (crumb id = accumulated path, always trailing-slash) so the kit hook's
// own navigation (which reads crumb.id straight from here) lines up with what
// use-file-manager-host's onLocationChange expects.
function buildInitialCrumbs(sections: FileManagerHost['sections'], placeId: string, path?: string): Crumb[] | undefined {
  if (!placeId) {
    return undefined
  }
  const root: Crumb = { id: placeId, name: placeName(sections, placeId) }
  const segments = (path ?? '').split('/').filter(Boolean)
  if (!segments.length) {
    return [root]
  }
  const crumbs = [root]
  let accumulated = ''
  for (const segment of segments) {
    accumulated += segment + '/'
    crumbs.push({ id: '/' + accumulated, name: segment })
  }
  return crumbs
}

/**
 * The browser shell: takes the space's sections + a default place already
 * computed by the caller (every connection configured in the space, plus the
 * terminals of its graphs and apps) and wires them through use-file-manager-host into
 * the design-kit FileBrowser. Renders the kit component as-is — no host-added
 * chrome — so loading/empty states are the kit's own (`sourcesLoading` forces
 * the listing into its 'loading' state; an empty `sections` list falls through
 * to the kit's own 'empty' state naturally).
 */
export function FileManagerBrowser({
  space,
  sections,
  defaultPlaceId,
  initialPath,
  onLocationSettled,
  onAddConnection,
  sourcesLoading,
  activeRootPath,
  className,
}: {
  space: string
  sections: FileManagerHost['sections']
  defaultPlaceId: string
  initialPath?: string
  onLocationSettled?: (source: string, path: string) => void
  onAddConnection?: () => void
  sourcesLoading?: boolean
  /** The root path configured for `defaultPlaceId`. Changing it re-roots browsing,
   *  so the host reloads from "/" rather than leaving the previous listing on
   *  screen. Undefined when that source has no root configured. */
  activeRootPath?: string
  className?: string
}) {
  const host = useFileManagerHost(space, sections, defaultPlaceId, initialPath, onLocationSettled, activeRootPath)
  // Only meaningful on first mount — useFileBrowser reads its initialPath option
  // once, on its own first render, so recomputing this on later place changes is
  // harmless (it's never consulted again).
  const initialCrumbs = useMemo(() => buildInitialCrumbs(sections, defaultPlaceId, initialPath), [])
  const browser = useFileBrowser({
    ...host,
    state: sourcesLoading ? 'loading' : host.state,
    onAddConnection,
    initialPlaceId: defaultPlaceId || undefined,
    initialPath: initialCrumbs,
    // A place, crumb or folder opens as this same page on that location, so a
    // middle-click on it opens it in a new tab.
    locationHref: deepLinkHref,
  })

  return <FileBrowser {...browser.props} className={className ?? 'h-full'} />
}
