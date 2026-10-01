import { useCallback, useMemo, useState } from 'react'
import type { ComponentProps } from 'react'

import type { ConnectionSidebar, PlaceSection } from '@/components/ui/file-manager/connection-sidebar'
import type { FileEntryList, FileListState } from '@/components/ui/file-manager/file-entry-list'
import type { FileEntry } from '@/components/ui/file-manager/file-entry-row'
import type { FileToolbar, Crumb } from '@/components/ui/file-manager/file-toolbar'
import type { TransfersTray } from '@/components/ui/file-manager/transfers-tray'
import type { TransferItemData } from '@/components/ui/file-manager/transfer-item'

export type FileView = 'list' | 'grid'

// Each returned slice is exactly its subcomponent's props, so it can be spread
// straight into a pane (<FileToolbar {...browser.toolbar} />) for a custom
// layout, or all four are bundled into browser.props for <FileBrowser>.
type PlacesSlice = ComponentProps<typeof ConnectionSidebar>
type ToolbarSlice = ComponentProps<typeof FileToolbar>
type ListingSlice = ComponentProps<typeof FileEntryList>
type TransfersSlice = ComponentProps<typeof TransfersTray>

export interface UseFileBrowserOptions {
  // --- data for the current location (controlled: the hook emits ---
  // onLocationChange and the host re-feeds entries for the new path) ---
  sections: PlaceSection[]
  entries: FileEntry[]
  state?: FileListState
  errorMessage?: string
  transfers?: TransferItemData[]
  transfersSummary?: string
  // --- I/O (the host owns all data + side effects; the hook does none) ---
  onLocationChange?: (placeId: string, path: Crumb[]) => void
  onRefresh?: () => void
  onDownload?: (entry: FileEntry) => void
  onRenameEntry?: (id: string, name: string) => void
  onDelete?: (entry: FileEntry) => void
  onNewFolder?: () => void
  onUpload?: () => void
  onFilesDrop?: (files: File[]) => void
  onRetry?: () => void
  onCancelTransfer?: (id: string) => void
  onRetryTransfer?: (id: string) => void
  onAddConnection?: () => void
  // Where a location opens as a page of its own -- `path` is a crumb / directory
  // entry id, omitted for a place's root. Given, places, crumbs and directory
  // entries get an `href` and open in a new tab on a middle-click.
  locationHref?: (placeId: string, path?: string) => string | undefined
  // --- optional initial state ---
  initialPlaceId?: string
  initialPath?: Crumb[]
  initialView?: FileView
}

export interface UseFileBrowser {
  // raw state, for hosts that want to read or override a piece
  activePlaceId: string
  path: Crumb[]
  selection: string[]
  view: FileView
  searchValue: string
  canBack: boolean
  canForward: boolean
  canUp: boolean
  // mobile sidebar drawer (shown as a popup when the sidebar collapses on
  // narrow widths)
  sidebarOpen: boolean
  onSidebarOpenChange: (open: boolean) => void
  // subcomponent slices (1:1 with each pane's props)
  places: PlacesSlice
  toolbar: ToolbarSlice
  listing: ListingSlice
  transfers: TransfersSlice
  // assembled, ready to spread into <FileBrowser {...browser.props} />
  props: { places: PlacesSlice; toolbar: ToolbarSlice; listing: ListingSlice; transfers: TransfersSlice; sidebarOpen: boolean; onSidebarOpenChange: (open: boolean) => void }
}

// Headless controller for the file browser. It owns every piece of pure-UI
// state (active place, current path + back/forward/up history, selection, view
// mode, inline-rename draft, transfers-tray expansion, search input) and derives
// the can* flags internally, so hosts never compute them. It holds no data and
// does no I/O: strings arrive host-formatted, search filtering stays host-side
// (the hook only owns the input value), and the host is notified of navigation
// through onLocationChange so it can re-feed the entries for the new location.
export function useFileBrowser(options: UseFileBrowserOptions): UseFileBrowser {
  const {
    sections,
    entries,
    state = 'list',
    errorMessage,
    transfers = [],
    transfersSummary,
    onLocationChange,
    onRefresh,
    onDownload,
    onRenameEntry,
    onDelete,
    onNewFolder,
    onUpload,
    onFilesDrop,
    onRetry,
    onCancelTransfer,
    onRetryTransfer,
    onAddConnection,
    locationHref,
    initialPlaceId,
    initialPath,
    initialView = 'list',
  } = options

  const firstPlaceId = sections[0]?.items[0]?.id ?? ''
  const placeName = (id: string) =>
    sections.flatMap((s) => s.items).find((p) => p.id === id)?.name ?? id

  const [activePlaceId, setActivePlaceId] = useState<string>(initialPlaceId ?? firstPlaceId)
  const [path, setPath] = useState<Crumb[]>(() => {
    if (initialPath) return initialPath
    const pid = initialPlaceId ?? firstPlaceId
    return pid ? [{ id: pid, name: placeName(pid) }] : []
  })
  const [past, setPast] = useState<Crumb[][]>([])
  const [future, setFuture] = useState<Crumb[][]>([])

  const [selection, setSelection] = useState<string[]>([])
  const [view, setView] = useState<FileView>(initialView)
  const [searchValue, setSearchValue] = useState('')
  const [trayOpen, setTrayOpen] = useState(false)
  // mobile sidebar drawer (shown as a popup when the sidebar collapses on
  // narrow widths)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // inline-rename draft (single source of truth — no split between list + host)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const canBack = past.length > 0
  const canForward = future.length > 0
  const canUp = path.length > 1

  // move to a new path inside the active place (pushes history, clears future)
  const pushPath = useCallback(
    (next: Crumb[]) => {
      setPast((p) => [...p, path])
      setFuture([])
      setSelection([])
      setRenamingId(null)
      setPath(next)
      onLocationChange?.(activePlaceId, next)
    },
    [path, activePlaceId, onLocationChange],
  )

  const navigateToCrumb = useCallback(
    (crumb: Crumb) => {
      const idx = path.findIndex((c) => c.id === crumb.id)
      if (idx === -1) return
      pushPath(path.slice(0, idx + 1))
    },
    [path, pushPath],
  )

  const back = useCallback(() => {
    if (!past.length) return
    const prev = past[past.length - 1]
    setPast(past.slice(0, -1))
    setFuture((f) => [path, ...f])
    setSelection([])
    setRenamingId(null)
    setPath(prev)
    onLocationChange?.(activePlaceId, prev)
  }, [past, path, activePlaceId, onLocationChange])

  const forward = useCallback(() => {
    if (!future.length) return
    const next = future[0]
    setFuture(future.slice(1))
    setPast((p) => [...p, path])
    setSelection([])
    setRenamingId(null)
    setPath(next)
    onLocationChange?.(activePlaceId, next)
  }, [future, path, activePlaceId, onLocationChange])

  const up = useCallback(() => {
    if (path.length <= 1) return
    pushPath(path.slice(0, -1))
  }, [path, pushPath])

  const activatePlace = useCallback(
    (id: string) => {
      if (id === activePlaceId) return
      setActivePlaceId(id)
      const next = [{ id, name: placeName(id) }]
      setPast([])
      setFuture([])
      setSelection([])
      setRenamingId(null)
      setPath(next)
      onLocationChange?.(id, next)
    },
    [activePlaceId, placeName, onLocationChange],
  )

  const activateEntry = useCallback(
    (entry: FileEntry) => {
      if (entry.kind === 'directory') pushPath([...path, { id: entry.id, name: entry.name }])
    },
    [path, pushPath],
  )

  const select = useCallback((entry: FileEntry, additive: boolean) => {
    setSelection((prev) =>
      additive
        ? prev.includes(entry.id)
          ? prev.filter((id) => id !== entry.id)
          : [...prev, entry.id]
        : [entry.id],
    )
  }, [])

  const startRename = useCallback((entry: FileEntry) => {
    setRenamingId(entry.id)
    setRenameValue(entry.name)
  }, [])
  const commitRename = useCallback(() => {
    const id = renamingId
    const name = renameValue.trim()
    setRenamingId(null)
    if (id && name) onRenameEntry?.(id, name)
  }, [renamingId, renameValue, onRenameEntry])
  const cancelRename = useCallback(() => setRenamingId(null), [])
  // a row menu opening cancels an in-flight rename
  const handleMenuOpenChange = useCallback((open: boolean) => {
    if (open) setRenamingId(null)
  }, [])

  // Each place's root, and each directory in the listing, as a page of its own
  // when the host says where that is (locationHref).
  const linkedSections = useMemo(
    () =>
      locationHref
        ? sections.map((s) => ({ ...s, items: s.items.map((p) => ({ ...p, href: locationHref(p.id) ?? p.href })) }))
        : sections,
    [sections, locationHref],
  )
  const linkedEntries = useMemo(
    () =>
      locationHref
        ? entries.map((e) => (e.kind === 'directory' ? { ...e, href: locationHref(activePlaceId, e.id) ?? e.href } : e))
        : entries,
    [entries, locationHref, activePlaceId],
  )

  const places = useMemo<PlacesSlice>(
    () => ({ sections: linkedSections, activePlaceId, onPlaceActivate: activatePlace, onAddConnection }),
    [linkedSections, activePlaceId, activatePlace, onAddConnection],
  )

  // The root crumb IS the active place, so it shows that place's own `label`
  // when the host gave one -- read from the current sections, not stored in
  // the path, so it follows the place as it changes.
  const shownPath = useMemo(() => {
    const root = path[0]
    const place = root ? sections.flatMap((s) => s.items).find((p) => p.id === root.id) : undefined
    return path.map((crumb, i) =>
      i === 0
        ? { ...crumb, label: place?.label ?? crumb.label, href: locationHref?.(crumb.id) ?? crumb.href }
        : { ...crumb, href: locationHref?.(root.id, crumb.id) ?? crumb.href },
    )
  }, [path, sections, locationHref])

  const toolbar = useMemo<ToolbarSlice>(
    () => ({
      path: shownPath,
      onNavigate: navigateToCrumb,
      onBack: back,
      canBack,
      onForward: forward,
      canForward,
      onUp: up,
      canUp,
      onRefresh,
      searchValue,
      onSearchChange: setSearchValue,
      view,
      onViewChange: setView,
      showViewToggle: true,
      onNewFolder,
      onUpload,
    }),
    [shownPath, navigateToCrumb, back, canBack, forward, canForward, up, canUp, onRefresh, searchValue, view, onNewFolder, onUpload],
  )

  const listing = useMemo<ListingSlice>(
    () => ({
      entries: linkedEntries,
      state,
      errorMessage,
      view,
      selectedIds: selection,
      onActivate: activateEntry,
      onSelect: select,
      onDownload,
      onRename: startRename,
      renamingId,
      renameValue,
      onRenameChange: setRenameValue,
      onRenameCommit: commitRename,
      onRenameCancel: cancelRename,
      onMenuOpenChange: handleMenuOpenChange,
      onDelete,
      onNewFolder,
      onFilesDrop,
      onRetry,
    }),
    [linkedEntries, state, errorMessage, view, selection, activateEntry, select, onDownload, startRename, renamingId, renameValue, commitRename, cancelRename, handleMenuOpenChange, onDelete, onNewFolder, onFilesDrop, onRetry],
  )

  const transfersSlice = useMemo<TransfersSlice>(
    () => ({
      transfers,
      summary: transfersSummary,
      expanded: trayOpen,
      onExpandedChange: setTrayOpen,
      onCancelTransfer,
      onRetryTransfer,
    }),
    [transfers, transfersSummary, trayOpen, onCancelTransfer, onRetryTransfer],
  )

  const props = useMemo(
    () => ({
      places,
      toolbar,
      listing,
      transfers: transfersSlice,
      sidebarOpen,
      onSidebarOpenChange: setSidebarOpen,
    }),
    [places, toolbar, listing, transfersSlice, sidebarOpen],
  )

  return {
    activePlaceId,
    path,
    selection,
    view,
    searchValue,
    canBack,
    canForward,
    canUp,
    sidebarOpen,
    onSidebarOpenChange: setSidebarOpen,
    places,
    toolbar,
    listing,
    transfers: transfersSlice,
    props,
  }
}
