import { usePublishSelection } from '@opencroft/client/chat'
import { useMemo, useState } from 'react'

import { FileBrowser } from '@/components/ui/file-manager/file-browser'
import type { Crumb } from '@/components/ui/file-manager/file-toolbar'
import { useFileBrowser } from '@/components/ui/file-manager/use-file-browser'
import { crumbsFor } from './crumbs'
import { deepLinkHref } from './deep-link'
import { fileSelection } from './selection-items'
import type { SourceSettings } from './types'
import { type FileManagerHost, type FileManagerHostOptions, useFileManagerHost } from './use-file-manager-host'

function placeName(sections: FileManagerHost['sections'], placeId: string): string {
  for (const section of sections) {
    const item = section.items.find((i) => i.id === placeId)
    if (item) {
      return item.name
    }
  }
  return placeId
}

// The full breadcrumb trail for a restored deep link.
function buildInitialCrumbs(
  sections: FileManagerHost['sections'],
  placeId: string,
  path?: string,
): Crumb[] | undefined {
  return placeId ? crumbsFor(placeId, placeName(sections, placeId), path) : undefined
}

/**
 * The browser shell: takes the space's sections + a default place already
 * computed by the caller (every connection configured in the space, plus the
 * terminals of the person's spaces) and wires them through use-file-manager-host into
 * the design-kit FileBrowser. Renders the kit component as-is — no host-added
 * chrome — so loading/empty states are the kit's own (`sourcesLoading` forces
 * the listing into its 'loading' state; an empty `sections` list falls through
 * to the kit's own 'empty' state naturally).
 *
 * It publishes the selected entries, or the open folder, into the selection
 * scope the host mounts around the App page, for a chat in another window of
 * the same space to quote (selection-items.ts says what is sent).
 */
export function FileManagerBrowser({
  onAddConnection,
  sourcesLoading,
  sourceSettings,
  rememberSidebarWidthAs,
  className,
  ...hostOptions
}: FileManagerHostOptions & {
  onAddConnection?: () => void
  sourcesLoading?: boolean
  /** Each source's settings, by ref: a published entry's full path is under its source's root. */
  sourceSettings?: Record<string, SourceSettings>
  /** The browser-storage key the sidebar's dragged width is kept under. */
  rememberSidebarWidthAs?: string
  className?: string
}) {
  const { location, ...host } = useFileManagerHost(hostOptions)
  const { sections, defaultPlaceId, initialPath } = hostOptions
  // Built once, on first mount: useFileBrowser reads its initialPath option only
  // on its own first render, so later place changes have nothing to update here.
  const [initialCrumbs] = useState(() => buildInitialCrumbs(sections, defaultPlaceId, initialPath))
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

  const { selection } = browser
  const shownEntries = browser.listing.entries
  const selected = useMemo(() => {
    const ids = new Set(selection)
    return shownEntries.filter((entry) => ids.has(entry.id))
  }, [selection, shownEntries])
  // A folder that failed to list is not offered: the reference would not resolve.
  // While a listing loads, the entries and the selection on screen can still be
  // the previous location's (a re-rooted source reloads under the new root with
  // the old listing shown), so only the folder being opened is offered.
  usePublishSelection(
    sourcesLoading || host.state === 'error'
      ? null
      : fileSelection({
          source: location.placeId,
          rootPath: sourceSettings?.[location.placeId]?.rootPath,
          folder: location.path,
          selected: host.state === 'loading' ? [] : selected,
          terminalName: placeName(sections, location.placeId),
        }),
  )

  return (
    <FileBrowser {...browser.props} rememberSidebarWidthAs={rememberSidebarWidthAs} className={className ?? 'h-full'} />
  )
}
