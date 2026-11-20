import { invoke } from '@opencroft/client/actions'
import { routeUrl } from '@opencroft/client/extension'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { PlaceSection } from '@/components/ui/file-manager/connection-sidebar'
import type { FileListState } from '@/components/ui/file-manager/file-entry-list'
import type { FileEntry as KitFileEntry } from '@/components/ui/file-manager/file-entry-row'
import type { Crumb } from '@/components/ui/file-manager/file-toolbar'
import type { TransferItemData } from '@/components/ui/file-manager/transfer-item'
import { formatModified, formatSize, formatSpeed, fullPath, joinPath, listingPath, parentPath } from '@/lib/format'
import { type PackAnswer, readArchiveRun, type UnpackAnswer } from './archive-run'
import { deleteEntries, deleteFailureNote, deleteQuestion } from './delete-entries'
import { placeOpeningPath, type SettledPlace } from './place-opening'
import type { PlaceRef } from './types'

const MAX_LIST_PAGES = 20

interface ProviderFileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size: number
  modified: string
}

interface ListResult {
  entries: ProviderFileEntry[]
  nextCursor?: string
}

function toKitEntry(entry: ProviderFileEntry): KitFileEntry {
  const modifiedAt = entry.modified ? new Date(entry.modified).getTime() : Number.NaN
  return {
    id: entry.path,
    name: entry.name,
    kind: entry.type,
    size: entry.type === 'file' ? formatSize(entry.size) : undefined,
    sizeBytes: entry.type === 'file' ? entry.size : undefined,
    modified: entry.modified ? formatModified(entry.modified) : undefined,
    modifiedAt: Number.isNaN(modifiedAt) ? undefined : modifiedAt,
  }
}

async function fetchAllEntries(
  space: string,
  source: string,
  path: string,
): Promise<{ entries: KitFileEntry[]; truncated: boolean }> {
  const collected: ProviderFileEntry[] = []
  let cursor: string | undefined
  let truncated = false
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const result = await invoke<ListResult>('list', space, source, path, cursor)
    collected.push(...result.entries)
    if (!result.nextCursor) {
      break
    }
    cursor = result.nextCursor
    if (page === MAX_LIST_PAGES - 1) {
      truncated = true
    }
  }
  return { entries: collected.map(toKitEntry), truncated }
}

interface TransferHandle {
  xhr: XMLHttpRequest
  file: File
  lastLoaded: number
  lastTime: number
}

// A pack or unpack in the transfers tray: Cancel aborts its request (the
// server then cleans up), Retry runs it again.
interface ArchiveHandle {
  controller: AbortController
  retry: () => void
}

// Downloads a zip of `paths` from the download-zip route. The paths go in a
// form POST rather than the URL, which a large selection would overflow; a
// form submission, not a fetch, so the browser streams the zip to disk as a
// download instead of holding it in memory. A new tab, as a single file's
// download opens, so a refusal answered before the zip starts shows there
// rather than replacing this page.
function submitDownloadZip(action: string, paths: string[]): void {
  const form = document.createElement('form')
  form.method = 'post'
  form.action = action
  form.target = '_blank'
  form.hidden = true
  for (const path of paths) {
    const field = document.createElement('input')
    field.type = 'hidden'
    field.name = 'path'
    field.value = path
    form.append(field)
  }
  document.body.append(form)
  form.submit()
  form.remove()
}

function skippedNote({ links, macMetadata }: UnpackAnswer['skipped']): string {
  const parts = [
    links ? `${links} symbolic link${links === 1 ? '' : 's'}` : '',
    macMetadata ? `${macMetadata} macOS metadata entr${macMetadata === 1 ? 'y' : 'ies'}` : '',
  ].filter(Boolean)
  return parts.length ? ` Left out: ${parts.join(', ')}.` : ''
}

export interface FileManagerHost {
  /**
   * Where browsing is: the source and the folder, in the listing's form. While
   * `state` is 'loading' it is the folder being opened and `entries` may still
   * be the previous folder's.
   */
  location: { placeId: string; path: string }
  sections: PlaceSection[]
  entries: KitFileEntry[]
  state: FileListState
  errorMessage?: string
  transfers: TransferItemData[]
  transfersSummary?: string
  onLocationChange: (placeId: string, path: Crumb[]) => void
  onRefresh: () => void
  onRetry: () => void
  /** One file downloads as itself; anything else (several entries, a folder) as one zip. */
  onDownload: (entries: KitFileEntry[]) => void
  onRenameEntry: (id: string, name: string) => void
  /** Asks once for all of them, then deletes them one by one. */
  onDelete: (entries: KitFileEntry[]) => void
  onCreateFolder: (name: string) => void
  onCreateFile: (name: string) => void
  /** Copies the full paths, one per line. */
  onCopyPath: (entries: KitFileEntry[]) => void
  /** Packs the entries into a new zip in the current folder; resolves with its id, or undefined when it failed. */
  onPack: (entries: KitFileEntry[]) => Promise<string | undefined>
  onUnpack: (entry: KitFileEntry) => void
  onToggleBookmark?: (entry: KitFileEntry) => void
  bookmarkedIds: string[]
  onUpload: () => void
  onFilesDrop: (files: File[]) => void
  onCancelTransfer: (id: string) => void
  onRetryTransfer: (id: string) => void
}

export interface FileManagerHostOptions {
  space: string
  sections: PlaceSection[]
  defaultPlaceId: string
  initialPath?: string
  onLocationSettled?: (source: string, path: string) => void
  /** The root path configured for `defaultPlaceId`. Changing it re-roots browsing,
   *  so the host reloads from "/" rather than leaving the previous listing on
   *  screen. Undefined when that source has no root configured. */
  activeRootPath?: string
  /** The person's bookmarked folders: those in the listing offer Remove bookmark. */
  bookmarks?: PlaceRef[]
  /** Bookmark a folder, or remove its bookmark. Given, terminal folders offer it. */
  onToggleBookmark?: (place: PlaceRef) => void
  /** A folder files were just uploaded into or downloaded from. */
  onFolderUsed?: (place: PlaceRef) => void
}

// Bookmarks and Recent hold terminal folders only.
const isTerminalSource = (source: string) => source.startsWith('term:')

/**
 * Wires the headless use-file-browser hook to the extension's list/mkdir/
 * createFile/rename/delete actions and streaming upload/download/pack/unpack routes.
 * `sections`' item ids ARE source refs (`term:<nodeId>/<handleId>` or
 * `conn:<id>`) — the active place id is used directly as the `source` param
 * everywhere, no per-node lookup involved.
 *
 * `space` accompanies every call because connections and root paths are stored
 * per space, so a ref alone does not say which ones to resolve it against.
 *
 * `activeRootPath` is whatever root the caller has configured for
 * `defaultPlaceId`, and it is here because changing it re-roots browsing: see
 * the effect below.
 */
export function useFileManagerHost({
  space,
  sections,
  defaultPlaceId,
  initialPath,
  onLocationSettled,
  activeRootPath,
  bookmarks,
  onToggleBookmark,
  onFolderUsed,
}: FileManagerHostOptions): FileManagerHost {
  const [activePlaceId, setActivePlaceId] = useState(defaultPlaceId)
  const [currentPath, setCurrentPath] = useState(initialPath || '/')
  const [entries, setEntries] = useState<KitFileEntry[]>([])
  const [state, setState] = useState<FileListState>('loading')
  const [errorMessage, setErrorMessage] = useState<string | undefined>()
  const [transfers, setTransfers] = useState<TransferItemData[]>([])
  const transferHandles = useRef(new Map<string, TransferHandle>())
  const archiveRuns = useRef(new Map<string, ArchiveHandle>())
  // Bumped on every load() call; a response is only applied if its captured
  // sequence is still current, so a slow/older request can't clobber a newer
  // one's results (rapid navigation, or a slow backend like FTP).
  const loadSeq = useRef(0)

  // Fire only on the (source, path) pair itself changing, not on every render:
  // the callback is read through a ref, so its identity is the caller's concern.
  // With no place there is no location to report: while sources are still
  // loading, reporting ('', path) would overwrite the source the caller is
  // about to restore.
  const onLocationSettledRef = useRef(onLocationSettled)
  useEffect(() => {
    onLocationSettledRef.current = onLocationSettled
  })
  useEffect(() => {
    if (activePlaceId) {
      onLocationSettledRef.current?.(activePlaceId, currentPath)
    }
  }, [activePlaceId, currentPath])

  const load = useCallback(
    async (source: string, path: string) => {
      const seq = ++loadSeq.current
      if (!source) {
        setState('empty')
        setEntries([])
        return
      }
      setState('loading')
      try {
        const { entries: kitEntries, truncated } = await fetchAllEntries(space, source, path)
        if (loadSeq.current !== seq) {
          return
        }
        setEntries(kitEntries)
        setState(kitEntries.length ? 'list' : 'empty')
        setErrorMessage(undefined)
        if (truncated) {
          toast.info(`Showing the first ${MAX_LIST_PAGES} pages — this location has more entries than fit.`)
        }
      } catch (err) {
        if (loadSeq.current !== seq) {
          return
        }
        setState('error')
        setErrorMessage(err instanceof Error ? err.message : String(err))
      }
    },
    [space],
  )

  // The place browsing last opened, compared against rather than acted on
  // blindly: this effect also re-runs with nothing changed (React StrictMode
  // runs mount effects twice), and a re-run must not reopen the place at "/"
  // over the deep-link path its first run is loading.
  const settledPlace = useRef<SettledPlace | undefined>(undefined)
  // The place onLocationChange last moved to, until the effect below has seen
  // the caller report it back as the default place.
  const navigatedTo = useRef<string | undefined>(undefined)

  // Opens the default place when it, or its root path, changes. A re-rooted
  // source is a new location rather than a refresh, since every path held is
  // relative to the old root, and without the reload it keeps showing its old
  // listing with nothing on screen saying so. Which path it opens at is
  // placeOpeningPath's. Ordinary navigation goes through onLocationChange.
  useEffect(() => {
    if (!defaultPlaceId) {
      // A place lost and found again is reopened, at "/", not left empty.
      if (settledPlace.current) {
        settledPlace.current = { ...settledPlace.current, placeId: '' }
      }
      navigatedTo.current = undefined
      setState('empty')
      setEntries([])
      return
    }
    const next: SettledPlace = { space, placeId: defaultPlaceId, rootPath: activeRootPath }
    const path = placeOpeningPath(settledPlace.current, next, initialPath, navigatedTo.current)
    settledPlace.current = next
    navigatedTo.current = undefined
    if (path === undefined) {
      return
    }
    setActivePlaceId(defaultPlaceId)
    setCurrentPath(path)
    load(defaultPlaceId, path)
  }, [space, defaultPlaceId, activeRootPath, initialPath, load])

  const onLocationChange = useCallback(
    (placeId: string, path: Crumb[]) => {
      // The kit hook seeds the root crumb as { id: placeId, name: ... } — its id
      // is the place id, not a filesystem path (the hook never accepts an
      // initialPath from us). Only crumbs beyond the root carry a real path,
      // since those come from entry.id in activateEntry. So root always means "/".
      const target = path.length <= 1 ? '/' : path[path.length - 1].id
      if (placeId !== activePlaceId) {
        navigatedTo.current = placeId
      }
      setActivePlaceId(placeId)
      setCurrentPath(target)
      load(placeId, target)
    },
    [load, activePlaceId],
  )

  const refresh = useCallback(() => load(activePlaceId, currentPath), [load, activePlaceId, currentPath])

  // Where browsing is now, for work that ends after the person may have moved on.
  const shown = useRef({ placeId: activePlaceId, path: currentPath })
  useEffect(() => {
    shown.current = { placeId: activePlaceId, path: currentPath }
  }, [activePlaceId, currentPath])
  // Reloads the listing if it still shows `placeId` at `path`.
  const refreshIfShowing = useCallback(
    (placeId: string, path: string) => {
      if (shown.current.placeId === placeId && shown.current.path === path) {
        load(placeId, path)
      }
    },
    [load],
  )

  const runAction = useCallback(
    async (actionId: string, args: unknown[], successMessage?: string) => {
      try {
        await invoke(actionId, space, activePlaceId, ...args)
        if (successMessage) {
          toast.success(successMessage)
        }
        refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    },
    [space, activePlaceId, refresh],
  )

  // One request each, with the confirmed name: the kit hook calls these only
  // once a name is confirmed, and the server refuses a name already taken.
  const onCreateFolder = useCallback(
    (name: string) => runAction('mkdir', [joinPath(currentPath, name)]),
    [runAction, currentPath],
  )
  const onCreateFile = useCallback(
    (name: string) => runAction('createFile', [joinPath(currentPath, name)]),
    [runAction, currentPath],
  )

  const onCopyPath = useCallback(
    async (chosen: KitFileEntry[]) => {
      const paths = chosen.map((entry) => fullPath(activeRootPath, entry.id))
      try {
        await navigator.clipboard.writeText(paths.join('\n'))
        toast.success(paths.length === 1 ? `Copied ${paths[0]}` : `Copied ${paths.length} paths`)
      } catch (err) {
        toast.error(`Could not copy the path: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [activeRootPath],
  )

  // Places hold full paths (what Copy path gives), so a root path change
  // cannot point them at another folder; entries are matched through the
  // active root, and a bookmark outside it marks no entry.
  const bookmarkedIds = useMemo(
    () =>
      (bookmarks ?? [])
        .filter((b) => b.source === activePlaceId)
        .map((b) => listingPath(activeRootPath, b.path))
        .filter((id): id is string => id !== undefined),
    [bookmarks, activePlaceId, activeRootPath],
  )
  const toggleEntryBookmark = useCallback(
    (entry: KitFileEntry) => onToggleBookmark?.({ source: activePlaceId, path: fullPath(activeRootPath, entry.id) }),
    [onToggleBookmark, activePlaceId, activeRootPath],
  )

  // Reported for terminal folders only, through a ref so the transfer
  // callbacks below need not change identity with the caller's.
  const onFolderUsedRef = useRef(onFolderUsed)
  useEffect(() => {
    onFolderUsedRef.current = onFolderUsed
  })
  const folderUsed = useCallback((source: string, rootPath: string | undefined, path: string) => {
    if (isTerminalSource(source)) {
      onFolderUsedRef.current?.({ source, path: fullPath(rootPath, path) })
    }
  }, [])

  const onRenameEntry = useCallback(
    (id: string, name: string) => {
      // Preserve the trailing slash for a directory — providers key rename's
      // file-vs-directory handling off it (e.g. S3 rejects a mismatch).
      const newPath = joinPath(parentPath(id), name) + (id.endsWith('/') ? '/' : '')
      // Confirming the name it has (a new archive's rename, left as it is)
      // changes nothing, and not every source's rename takes the same path twice.
      if (newPath === id) {
        return
      }
      runAction('rename', [id, newPath])
    },
    [runAction],
  )

  const onDelete = useCallback(
    async (chosen: KitFileEntry[]) => {
      // Directory delete is recursive server-side — confirm before a slip
      // on a folder becomes data loss. A proper dialog can replace this
      // window.confirm once the design kit has one.
      if (!chosen.length || !window.confirm(deleteQuestion(chosen))) {
        return
      }
      // The deletes can outlast the person staying in this folder: reload it
      // only if the listing still shows it.
      const placeId = activePlaceId
      const path = currentPath
      const failures = await deleteEntries(chosen, (id) => invoke('delete', space, placeId, id))
      if (failures.length) {
        toast.error(deleteFailureNote(failures, chosen.length))
      }
      refreshIfShowing(placeId, path)
    },
    [space, activePlaceId, currentPath, refreshIfShowing],
  )

  const onDownload = useCallback(
    (chosen: KitFileEntry[]) => {
      const query = `space=${encodeURIComponent(space)}&source=${encodeURIComponent(activePlaceId)}`
      if (chosen.length === 1 && chosen[0].kind === 'file') {
        window.open(`${routeUrl('download')}?${query}&path=${encodeURIComponent(chosen[0].id)}`, '_blank')
      } else if (chosen.length) {
        submitDownloadZip(
          `${routeUrl('download-zip')}?${query}`,
          chosen.map((entry) => entry.id),
        )
      }
      folderUsed(activePlaceId, activeRootPath, currentPath)
    },
    [space, activePlaceId, activeRootPath, currentPath, folderUsed],
  )

  const startUpload = useCallback(
    (file: File) => {
      const id = crypto.randomUUID()
      const url = `${routeUrl('upload')}?space=${encodeURIComponent(space)}&source=${encodeURIComponent(activePlaceId)}&path=${encodeURIComponent(currentPath)}&filename=${encodeURIComponent(file.name)}`
      const xhr = new XMLHttpRequest()
      transferHandles.current.set(id, { xhr, file, lastLoaded: 0, lastTime: Date.now() })

      setTransfers((prev) => [
        ...prev,
        { id, name: file.name, direction: 'upload', progress: 0, size: formatSize(file.size), state: 'active' },
      ])

      xhr.upload.addEventListener('progress', (e) => {
        if (!e.lengthComputable) {
          return
        }
        const handle = transferHandles.current.get(id)
        const now = Date.now()
        const elapsedSeconds = handle ? Math.max((now - handle.lastTime) / 1000, 0.001) : 1
        const deltaBytes = handle ? e.loaded - handle.lastLoaded : 0
        const speed = formatSpeed(deltaBytes / elapsedSeconds)
        if (handle) {
          handle.lastLoaded = e.loaded
          handle.lastTime = now
        }
        setTransfers((prev) =>
          prev.map((t) => (t.id === id ? { ...t, progress: Math.round((e.loaded / e.total) * 100), speed } : t)),
        )
      })

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          transferHandles.current.delete(id)
          setTransfers((prev) => prev.map((t) => (t.id === id ? { ...t, progress: 100, state: 'complete' } : t)))
          refresh()
          folderUsed(activePlaceId, activeRootPath, currentPath)
        } else {
          // Keep the handle (and its file) around — a failed transfer can be retried.
          setTransfers((prev) =>
            prev.map((t) => (t.id === id ? { ...t, state: 'error', error: `Upload failed (${xhr.status})` } : t)),
          )
        }
      })

      xhr.addEventListener('error', () => {
        setTransfers((prev) => prev.map((t) => (t.id === id ? { ...t, state: 'error', error: 'Upload failed' } : t)))
      })

      xhr.addEventListener('abort', () => {
        transferHandles.current.delete(id)
        setTransfers((prev) => prev.filter((t) => t.id !== id))
      })

      xhr.open('POST', url)
      xhr.send(file)
    },
    [space, activePlaceId, activeRootPath, currentPath, refresh, folderUsed],
  )

  const onFilesDrop = useCallback(
    (files: File[]) => {
      files.forEach(startUpload)
    },
    [startUpload],
  )

  const onUpload = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.onchange = () => {
      if (input.files) {
        onFilesDrop(Array.from(input.files))
      }
    }
    input.click()
  }, [onFilesDrop])

  // Runs a pack or unpack on the active source as one item of the transfers
  // tray, its bar following the route's progress. Answers the result, or
  // undefined when it failed (the item shows why) or was cancelled (the item
  // goes). The listing is refreshed once it is done.
  const runArchive = useCallback(
    <T>(kind: 'pack' | 'unpack', label: string, body: Record<string, unknown>): Promise<T | undefined> => {
      const id = crypto.randomUUID()
      const controller = new AbortController()
      const placeId = activePlaceId
      const path = currentPath
      archiveRuns.current.set(id, { controller, retry: () => void runArchive<T>(kind, label, body) })
      const update = (patch: Partial<TransferItemData>) =>
        setTransfers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
      setTransfers((prev) => [...prev, { id, name: label, direction: kind, progress: 0, state: 'active' }])

      const url = `${routeUrl(kind)}?space=${encodeURIComponent(space)}&source=${encodeURIComponent(activePlaceId)}`
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
        .then((response) =>
          readArchiveRun<T>(response, ({ done, total }) =>
            update({ progress: total ? Math.round((done / total) * 100) : undefined, size: formatSize(total) }),
          ),
        )
        .then(
          (result) => {
            archiveRuns.current.delete(id)
            update({ progress: 100, state: 'complete' })
            refreshIfShowing(placeId, path)
            return result
          },
          (err) => {
            if (controller.signal.aborted) {
              archiveRuns.current.delete(id)
              setTransfers((prev) => prev.filter((t) => t.id !== id))
            } else {
              update({ state: 'error', error: err instanceof Error ? err.message : String(err) })
            }
            return undefined
          },
        )
    },
    [space, activePlaceId, currentPath, refreshIfShowing],
  )

  const onPack = useCallback(
    async (chosen: KitFileEntry[]) => {
      const label = chosen.length === 1 ? chosen[0].name : `${chosen.length} items`
      const result = await runArchive<PackAnswer>('pack', label, {
        paths: chosen.map((entry) => entry.id),
        target: currentPath,
      })
      return result?.path
    },
    [runArchive, currentPath],
  )

  const onUnpack = useCallback(
    async (entry: KitFileEntry) => {
      const result = await runArchive<UnpackAnswer>('unpack', entry.name, { archive: entry.id, target: currentPath })
      if (result) {
        toast.success(`Unpacked into "${result.name}".${skippedNote(result.skipped)}`)
      }
    },
    [runArchive, currentPath],
  )

  const onCancelTransfer = useCallback((id: string) => {
    transferHandles.current.get(id)?.xhr.abort()
    archiveRuns.current.get(id)?.controller.abort()
  }, [])

  const onRetryTransfer = useCallback(
    (id: string) => {
      const archive = archiveRuns.current.get(id)
      if (archive) {
        archiveRuns.current.delete(id)
        setTransfers((prev) => prev.filter((t) => t.id !== id))
        archive.retry()
        return
      }
      const handle = transferHandles.current.get(id)
      transferHandles.current.delete(id)
      setTransfers((prev) => prev.filter((t) => t.id !== id))
      if (handle) {
        startUpload(handle.file)
      }
    },
    [startUpload],
  )

  const activeTransfers = transfers.filter((t) => t.state !== 'complete' && t.state !== 'error')
  const transfersSummary = activeTransfers.length ? `${activeTransfers.length} active` : undefined

  return {
    location: { placeId: activePlaceId, path: currentPath },
    sections,
    entries,
    state,
    errorMessage,
    transfers,
    transfersSummary,
    onLocationChange,
    onRefresh: refresh,
    onRetry: refresh,
    onDownload,
    onRenameEntry,
    onDelete,
    onCreateFolder,
    onCreateFile,
    onCopyPath,
    onPack,
    onUnpack,
    onToggleBookmark: onToggleBookmark && isTerminalSource(activePlaceId) ? toggleEntryBookmark : undefined,
    bookmarkedIds,
    onUpload,
    onFilesDrop,
    onCancelTransfer,
    onRetryTransfer,
  }
}
