import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentProps } from 'react'

import type { ConnectionSidebar, PlaceSection } from './connection-sidebar'
import type { FileEntryList, FileListState } from './file-entry-list'
import type { FileSelectionBar } from './file-selection-bar'
import {
  DEFAULT_FILE_SORT,
  type FileEntry,
  type FileEntryKind,
  type FileSort,
  type FileSortKey,
  type SelectGesture,
} from './file-entry-row'
import { FILE_KIND_LABEL, fileKind } from '@/components/ui/files/file-type-icon'
import type { FileToolbar, Crumb } from './file-toolbar'
import type { TransfersTray } from './transfers-tray'
import type { TransferItemData } from './transfer-item'

export type FileView = 'list' | 'grid'

// Each returned slice is exactly its subcomponent's props, so it can be spread
// straight into a pane (<FileToolbar {...browser.toolbar} />) for a custom
// layout, or all four are bundled into browser.props for <FileBrowser>.
type PlacesSlice = ComponentProps<typeof ConnectionSidebar>
type ToolbarSlice = ComponentProps<typeof FileToolbar>
type ListingSlice = ComponentProps<typeof FileEntryList>
type TransfersSlice = ComponentProps<typeof TransfersTray>
type SelectionBarSlice = ComponentProps<typeof FileSelectionBar>

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
  // Download, Delete and Copy path(s) get the row's entry, or the whole
  // selection when the row is part of it, in listing order -- as Pack does.
  onDownload?: (entries: FileEntry[]) => void
  onRenameEntry?: (id: string, name: string) => void
  onDelete?: (entries: FileEntry[]) => void
  // Create a folder / an empty file named `name` in the current location.
  // Given, New folder / New file put a draft row in the listing in rename
  // mode, and this is called once, when a name is confirmed that no entry
  // already has. Escape, an empty name, or leaving the input calls nothing.
  onCreateFolder?: (name: string) => void
  onCreateFile?: (name: string) => void
  onCopyPath?: (entries: FileEntry[]) => void
  // Given, every row offers Pack into zip: `entries` is that row's entry, or the
  // whole selection when the row is part of it, in listing order. Resolving
  // with the id of the entry it made (the archive) opens that entry in rename
  // mode once the listing holds it -- unless the location changed meanwhile, or
  // a rename or a new entry is in progress then.
  onPack?: (entries: FileEntry[]) => Promise<string | undefined | void> | void
  // Given, a `.zip` file's row offers Unpack here.
  onUnpack?: (entry: FileEntry) => void
  // A directory's Bookmark / Remove bookmark; `bookmarkedIds` says which it is.
  onToggleBookmark?: (entry: FileEntry) => void
  bookmarkedIds?: string[]
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
  initialSort?: FileSort
}

export interface UseFileBrowser {
  // raw state, for hosts that want to read or override a piece
  activePlaceId: string
  path: Crumb[]
  selection: string[]
  view: FileView
  sort: FileSort
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
  // The bar of selection mode (entered by a long press), while it is on.
  selectionBar?: SelectionBarSlice
  // assembled, ready to spread into <FileBrowser {...browser.props} />
  props: {
    places: PlacesSlice
    toolbar: ToolbarSlice
    listing: ListingSlice
    transfers: TransfersSlice
    selectionBar?: SelectionBarSlice
    sidebarOpen: boolean
    onSidebarOpenChange: (open: boolean) => void
  }
}

const byName = (a: FileEntry, b: FileEntry) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

// An entry's value in a Date, Size or Type column; undefined when it has none
// (no timestamp, or a folder's size).
function columnValue(entry: FileEntry, key: Exclude<FileSortKey, 'name'>): number | string | undefined {
  if (key === 'date') return entry.modifiedAt
  if (key === 'size') return entry.kind === 'directory' ? undefined : entry.sizeBytes
  return FILE_KIND_LABEL[fileKind(entry.name, entry.kind === 'directory')]
}

// The listing's order under `sort`: folders before files whichever the column
// and direction, then by the column. Names compare case-insensitively and in
// natural order ("file2" before "file10"). Entries equal in the column fall back
// to name order, and an entry with no value goes after those with one.
export function compareEntries(sort: FileSort): (a: FileEntry, b: FileEntry) => number {
  const sign = sort.direction === 'asc' ? 1 : -1
  const { key } = sort
  return (a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    if (key === 'name') return sign * byName(a, b)
    const va = columnValue(a, key)
    const vb = columnValue(b, key)
    if (va === undefined || vb === undefined) {
      if (va !== vb) return va === undefined ? 1 : -1
      return byName(a, b)
    }
    const order = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
    return order === 0 ? byName(a, b) : sign * order
  }
}

// Why `name` can't be given to a new entry beside `entries`, or undefined when
// it can. Names compare exactly, as the listing shows them.
export function newEntryNameError(entries: FileEntry[], name: string): string | undefined {
  return entries.some((e) => e.name === name) ? `"${name}" already exists` : undefined
}

// The listing's selection. `anchor` is where a Shift range starts: the entry
// last clicked without Shift. `touch` is selection mode, entered by a long
// press: while it is on, a plain tap adds or removes an entry, as Ctrl+click
// does. It holds only while something is selected.
export interface Selection {
  ids: string[]
  anchor: string | null
  touch: boolean
}

export const NO_SELECTION: Selection = { ids: [], anchor: null, touch: false }

// `selection` without the entries `order` no longer holds (deleted, filtered
// out); the same object when it holds them all.
export function selectionWithin(selection: Selection, order: readonly string[]): Selection {
  const shown = new Set(order)
  const ids = selection.ids.filter((id) => shown.has(id))
  const anchor = selection.anchor !== null && shown.has(selection.anchor) ? selection.anchor : null
  if (ids.length === selection.ids.length && anchor === selection.anchor) return selection
  return { ids, anchor, touch: selection.touch && ids.length > 0 }
}

// The selection after a click (or Space) on entry `id`, `order` being the
// entries' ids as the listing shows them. A range spans `order` from the
// anchor to `id`, both included, replacing the selection or, with toggle,
// added to it; the anchor stays. Without an anchor in `order` a range click
// acts as a click.
export function selectionAfter(selection: Selection, order: readonly string[], id: string, gesture: SelectGesture): Selection {
  const current = selectionWithin(selection, order)
  const toggle = gesture.toggle || current.touch
  const from = gesture.range && current.anchor !== null ? order.indexOf(current.anchor) : -1
  const to = order.indexOf(id)
  if (to === -1) return current
  if (from !== -1) {
    const span = order.slice(Math.min(from, to), Math.max(from, to) + 1)
    const held = new Set(current.ids)
    const ids = toggle ? [...current.ids, ...span.filter((s) => !held.has(s))] : span
    return { ids, anchor: current.anchor, touch: current.touch }
  }
  if (!toggle) return { ids: [id], anchor: id, touch: false }
  const ids = current.ids.includes(id) ? current.ids.filter((s) => s !== id) : [...current.ids, id]
  return { ids, anchor: id, touch: current.touch && ids.length > 0 }
}

// The selection as a row's menu opens on entry `id` (right-click, long press).
// An entry outside the selection becomes the selection alone, as file
// managers do -- except in selection mode, where a long press adds it. A long
// press turns selection mode on.
export function selectionForMenu(selection: Selection, order: readonly string[], id: string, touch: boolean): Selection {
  const current = selectionWithin(selection, order)
  if (current.ids.includes(id)) return touch && !current.touch ? { ...current, touch } : current
  if (current.touch && touch) return { ids: [...current.ids, id], anchor: id, touch }
  return { ids: [id], anchor: id, touch }
}

// What a finger's tap on an entry does: outside selection mode it opens the
// entry, as Enter does; in selection mode it adds or removes it.
export function tapAction(selection: Selection, order: readonly string[]): 'open' | 'toggle' {
  return selectionWithin(selection, order).touch ? 'toggle' : 'open'
}

// Headless controller for the file browser. It owns every piece of pure-UI
// state (active place, current path + back/forward/up history, selection, view
// mode, sort, inline-rename and new-entry drafts, transfers-tray expansion,
// search input), orders the entries by the sort (compareEntries) and derives
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
    onCreateFolder,
    onCreateFile,
    onCopyPath,
    onPack,
    onUnpack,
    onToggleBookmark,
    bookmarkedIds,
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
    initialSort = DEFAULT_FILE_SORT,
  } = options

  const firstPlaceId = sections[0]?.items[0]?.id ?? ''
  const findPlace = (id: string) => sections.flatMap((s) => s.items).find((p) => p.id === id)
  const placeName = (id: string) => findPlace(id)?.name ?? id

  const [activePlaceId, setActivePlaceId] = useState<string>(initialPlaceId ?? firstPlaceId)
  const [path, setPath] = useState<Crumb[]>(() => {
    if (initialPath) return initialPath
    const pid = initialPlaceId ?? firstPlaceId
    return pid ? [{ id: pid, name: placeName(pid) }] : []
  })
  const [past, setPast] = useState<Crumb[][]>([])
  const [future, setFuture] = useState<Crumb[][]>([])

  const [selected, setSelected] = useState<Selection>(NO_SELECTION)
  const clearSelection = useCallback(() => setSelected(NO_SELECTION), [])
  const [view, setView] = useState<FileView>(initialView)
  const [sort, setSort] = useState<FileSort>(initialSort)
  const [searchValue, setSearchValue] = useState('')
  const [trayOpen, setTrayOpen] = useState(false)
  // mobile sidebar drawer (shown as a popup when the sidebar collapses on
  // narrow widths)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // inline-rename draft (single source of truth — no split between list + host).
  // A new entry being named shares the draft value: `creating` says which kind.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [creating, setCreatingState] = useState<FileEntryKind | null>(null)
  const [renameError, setRenameError] = useState<string | undefined>()
  // `creating` as of the last change, read by the commit: two Enters can land
  // before the re-render that ends the draft, and only the first may create.
  const creatingRef = useRef<FileEntryKind | null>(null)
  const setCreating = useCallback((kind: FileEntryKind | null) => {
    creatingRef.current = kind
    setCreatingState(kind)
  }, [])

  // Drops any rename or new entry in progress (navigation, a menu opening).
  const endDrafts = useCallback(() => {
    setRenamingId(null)
    setCreating(null)
    setRenameError(undefined)
  }, [setCreating])

  const canBack = past.length > 0
  const canForward = future.length > 0
  const canUp = path.length > 1

  // move to a new path inside the active place (pushes history, clears future)
  const pushPath = useCallback(
    (next: Crumb[]) => {
      setPast((p) => [...p, path])
      setFuture([])
      setSelected(NO_SELECTION)
      endDrafts()
      setPath(next)
      onLocationChange?.(activePlaceId, next)
    },
    [path, activePlaceId, onLocationChange, endDrafts],
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
    setSelected(NO_SELECTION)
    endDrafts()
    setPath(prev)
    onLocationChange?.(activePlaceId, prev)
  }, [past, path, activePlaceId, onLocationChange, endDrafts])

  const forward = useCallback(() => {
    if (!future.length) return
    const next = future[0]
    setFuture(future.slice(1))
    setPast((p) => [...p, path])
    setSelected(NO_SELECTION)
    endDrafts()
    setPath(next)
    onLocationChange?.(activePlaceId, next)
  }, [future, path, activePlaceId, onLocationChange, endDrafts])

  const up = useCallback(() => {
    if (path.length <= 1) return
    pushPath(path.slice(0, -1))
  }, [path, pushPath])

  // A place opens at its root; one carrying a `location` (a bookmark, a recent
  // folder) opens that folder of its place instead -- inside the active place
  // as an ordinary move with history, elsewhere as a fresh start there.
  const activatePlace = useCallback(
    (id: string) => {
      const location = findPlace(id)?.location
      if (location && location.placeId === activePlaceId) {
        pushPath(location.path)
        return
      }
      if (!location && id === activePlaceId) return
      const placeId = location?.placeId ?? id
      const next = location?.path ?? [{ id, name: placeName(id) }]
      setActivePlaceId(placeId)
      setPast([])
      setFuture([])
      setSelected(NO_SELECTION)
      endDrafts()
      setPath(next)
      onLocationChange?.(placeId, next)
    },
    [activePlaceId, findPlace, placeName, pushPath, onLocationChange, endDrafts],
  )

  const activateEntry = useCallback(
    (entry: FileEntry) => {
      if (entry.kind === 'directory') pushPath([...path, { id: entry.id, name: entry.name }])
    },
    [path, pushPath],
  )

  // The entries in the listing's order, and their ids: what a Shift range
  // spans, what Select all takes, and the order a selection is acted on in.
  const ordered = useMemo(() => [...entries].sort(compareEntries(sort)), [entries, sort])
  const order = useMemo(() => ordered.map((e) => e.id), [ordered])
  // Only entries the listing still holds are selected: one deleted, or gone
  // from a refreshed or filtered listing, drops out.
  const current = useMemo(() => selectionWithin(selected, order), [selected, order])
  const selection = current.ids
  // Selection mode: on from a long press until nothing is selected.
  const selectionMode = current.touch
  // ...and stays out, so an entry made again under the same id is not selected.
  useEffect(() => setSelected((prev) => selectionWithin(prev, order)), [order])
  const selectionSet = useMemo(() => new Set(selection), [selection])
  const selectedEntries = useMemo(() => ordered.filter((e) => selectionSet.has(e.id)), [ordered, selectionSet])

  const select = useCallback(
    (entry: FileEntry, gesture: SelectGesture) => setSelected((prev) => selectionAfter(prev, order, entry.id, gesture)),
    [order],
  )
  const selectAll = useCallback(
    () => setSelected((prev) => ({ ids: order, anchor: selectionWithin(prev, order).anchor, touch: prev.touch && order.length > 0 })),
    [order],
  )
  const contextSelect = useCallback(
    (entry: FileEntry, touch: boolean) => setSelected((prev) => selectionForMenu(prev, order, entry.id, touch)),
    [order],
  )
  // A long press enters selection mode with the entry selected (or adds it,
  // when the mode is on); a tap opens, or toggles in selection mode.
  const longPress = useCallback((entry: FileEntry) => contextSelect(entry, true), [contextSelect])
  const tap = useCallback(
    (entry: FileEntry) => {
      if (tapAction(selected, order) === 'toggle') select(entry, { toggle: true, range: false })
      else activateEntry(entry)
    },
    [selected, order, select, activateEntry],
  )
  // What a row's action acts on: the selection when the row is part of it,
  // else the row alone.
  const targetsOf = useCallback(
    (entry: FileEntry) => (selectionSet.has(entry.id) ? ordered.filter((e) => selectionSet.has(e.id)) : [entry]),
    [selectionSet, ordered],
  )

  const startRename = useCallback(
    (entry: FileEntry) => {
      endDrafts()
      setRenamingId(entry.id)
      setRenameValue(entry.name)
    },
    [endDrafts],
  )
  const startCreate = useCallback(
    (kind: FileEntryKind) => {
      endDrafts()
      setCreating(kind)
      setRenameValue('')
    },
    [endDrafts, setCreating],
  )
  const changeRenameValue = useCallback((value: string) => {
    setRenameValue(value)
    setRenameError(undefined)
  }, [])
  const commitRename = useCallback(() => {
    const name = renameValue.trim()
    const kind = creatingRef.current
    if (kind) {
      if (!name) {
        endDrafts()
        return
      }
      const error = newEntryNameError(entries, name)
      if (error) {
        setRenameError(error)
        return
      }
      endDrafts()
      if (kind === 'directory') onCreateFolder?.(name)
      else onCreateFile?.(name)
      return
    }
    const id = renamingId
    setRenamingId(null)
    if (id && name) onRenameEntry?.(id, name)
  }, [renamingId, renameValue, entries, onRenameEntry, onCreateFolder, onCreateFile, endDrafts])
  // a row or list menu opening cancels an in-flight rename or new entry
  const handleMenuOpenChange = useCallback(
    (open: boolean) => {
      if (open) endDrafts()
    },
    [endDrafts],
  )

  // An entry the host has just made (a packed archive), renamed as soon as the
  // listing holds it. Any change of location drops it: the listing it was
  // made in is gone.
  const [pendingRenameId, setPendingRenameId] = useState<string | null>(null)
  const locationVersion = useRef(0)
  useEffect(() => {
    locationVersion.current += 1
    setPendingRenameId(null)
  }, [activePlaceId, path])
  useEffect(() => {
    if (!pendingRenameId) return
    const entry = entries.find((e) => e.id === pendingRenameId)
    if (!entry) return
    setPendingRenameId(null)
    // a rename or new entry the person started meanwhile is theirs to finish
    if (renamingId === null && !creating) startRename(entry)
  }, [pendingRenameId, entries, renamingId, creating, startRename])

  const packEntries = useMemo(() => {
    if (!onPack) return undefined
    return (chosen: FileEntry[]) => {
      const at = locationVersion.current
      // A failure is the host's to report; here it only means nothing to rename.
      Promise.resolve(onPack(chosen)).then(
        (id) => {
          if (id && locationVersion.current === at) setPendingRenameId(id)
        },
        () => {},
      )
    }
  }, [onPack])
  const pack = useMemo(() => (packEntries ? (entry: FileEntry) => packEntries(targetsOf(entry)) : undefined), [packEntries, targetsOf])

  const download = useMemo(() => (onDownload ? (entry: FileEntry) => onDownload(targetsOf(entry)) : undefined), [onDownload, targetsOf])
  const remove = useMemo(() => (onDelete ? (entry: FileEntry) => onDelete(targetsOf(entry)) : undefined), [onDelete, targetsOf])
  const copyPath = useMemo(() => (onCopyPath ? (entry: FileEntry) => onCopyPath(targetsOf(entry)) : undefined), [onCopyPath, targetsOf])

  const newFolder = useMemo(() => (onCreateFolder ? () => startCreate('directory') : undefined), [onCreateFolder, startCreate])
  const newFile = useMemo(() => (onCreateFile ? () => startCreate('file') : undefined), [onCreateFile, startCreate])

  // Each place's root, and each directory in the listing, as a page of its own
  // when the host says where that is (locationHref).
  const linkedSections = useMemo(
    () =>
      locationHref
        ? sections.map((s) => ({
            ...s,
            items: s.items.map((p) => {
              const target = p.location
                ? locationHref(p.location.placeId, p.location.path[p.location.path.length - 1]?.id)
                : locationHref(p.id)
              return { ...p, href: target ?? p.href }
            }),
          }))
        : sections,
    [sections, locationHref],
  )
  const linkedEntries = useMemo(
    () =>
      locationHref
        ? ordered.map((e) => (e.kind === 'directory' ? { ...e, href: locationHref(activePlaceId, e.id) ?? e.href } : e))
        : ordered,
    [ordered, locationHref, activePlaceId],
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
      // In selection mode Back leaves the mode, as a phone's file manager
      // does, rather than leaving the folder.
      onBack: selectionMode ? clearSelection : back,
      canBack: canBack || selectionMode,
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
      sort,
      onSortChange: setSort,
      onNewFolder: newFolder,
      onNewFile: newFile,
      onUpload,
    }),
    [shownPath, navigateToCrumb, back, clearSelection, canBack, selectionMode, forward, canForward, up, canUp, onRefresh, searchValue, view, sort, newFolder, newFile, onUpload],
  )

  const listing = useMemo<ListingSlice>(
    () => ({
      entries: linkedEntries,
      state,
      errorMessage,
      view,
      sort,
      onSortChange: setSort,
      selectedIds: selection,
      onActivate: activateEntry,
      onTap: tap,
      onLongPress: longPress,
      onSelect: select,
      onSelectAll: selectAll,
      onClearSelection: clearSelection,
      onContextSelect: contextSelect,
      onDownload: download,
      onRename: startRename,
      renamingId,
      renameValue,
      onRenameChange: changeRenameValue,
      onRenameCommit: commitRename,
      onRenameCancel: endDrafts,
      renameError,
      creating,
      onMenuOpenChange: handleMenuOpenChange,
      onDelete: remove,
      onCopyPath: copyPath,
      onPack: pack,
      onUnpack,
      onToggleBookmark,
      bookmarkedIds,
      onNewFolder: newFolder,
      onNewFile: newFile,
      onUpload,
      onRefresh,
      onFilesDrop,
      onRetry,
    }),
    [linkedEntries, state, errorMessage, view, sort, selection, activateEntry, tap, longPress, select, selectAll, clearSelection, contextSelect, download, startRename, renamingId, renameValue, changeRenameValue, commitRename, endDrafts, renameError, creating, handleMenuOpenChange, remove, copyPath, pack, onUnpack, onToggleBookmark, bookmarkedIds, newFolder, newFile, onUpload, onRefresh, onFilesDrop, onRetry],
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

  const only = selectedEntries.length === 1 ? selectedEntries[0] : undefined
  const selectionBar = useMemo<SelectionBarSlice | undefined>(
    () =>
      selectionMode
        ? {
            entries: selectedEntries,
            onClear: clearSelection,
            onSelectAll: selectedEntries.length < order.length ? selectAll : undefined,
            onDownload,
            onPack: packEntries,
            onCopyPath,
            onDelete,
            onRename: startRename,
            onUnpack,
            onToggleBookmark,
            bookmarked: Boolean(only && bookmarkedIds?.includes(only.id)),
          }
        : undefined,
    [selectionMode, selectedEntries, clearSelection, order.length, selectAll, onDownload, packEntries, onCopyPath, onDelete, startRename, onUnpack, onToggleBookmark, only, bookmarkedIds],
  )

  const props = useMemo(
    () => ({
      places,
      toolbar,
      listing,
      transfers: transfersSlice,
      selectionBar,
      sidebarOpen,
      onSidebarOpenChange: setSidebarOpen,
    }),
    [places, toolbar, listing, transfersSlice, selectionBar, sidebarOpen],
  )

  return {
    activePlaceId,
    path,
    selection,
    view,
    sort,
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
    selectionBar,
    props,
  }
}
