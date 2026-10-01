import { invoke, routeUrl, toast, React } from '@ext/host'

import type { Crumb, FileEntry as KitFileEntry } from '@/components/ui/file-manager/file-toolbar'
import type { TransferItemData } from '@/components/ui/file-manager/transfer-item'
import type { FileListState } from '@/components/ui/file-manager/file-entry-list'
import { formatModified, formatSize, formatSpeed, joinPath, parentPath } from '@/lib/format'

const { useCallback, useEffect, useRef, useState } = React

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
  return {
    id: entry.path,
    name: entry.name,
    kind: entry.type,
    size: entry.type === 'file' ? formatSize(entry.size) : undefined,
    modified: entry.modified ? formatModified(entry.modified) : undefined,
  }
}

async function fetchAllEntries(space: string, source: string, path: string): Promise<{ entries: KitFileEntry[]; truncated: boolean }> {
  const collected: ProviderFileEntry[] = []
  let cursor: string | undefined
  let truncated = false
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const result = (await invoke('list', space, source, path, cursor)) as ListResult
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

export interface FileManagerHost {
  sections: { id: string; label?: string; items: { id: string; name: string; icon?: React.ReactNode; menu?: React.ReactNode }[] }[]
  entries: KitFileEntry[]
  state: FileListState
  errorMessage?: string
  transfers: TransferItemData[]
  transfersSummary?: string
  onLocationChange: (placeId: string, path: Crumb[]) => void
  onRefresh: () => void
  onRetry: () => void
  onDownload: (entry: KitFileEntry) => void
  onRenameEntry: (id: string, name: string) => void
  onDelete: (entry: KitFileEntry) => void
  onNewFolder: () => void
  onUpload: () => void
  onFilesDrop: (files: File[]) => void
  onCancelTransfer: (id: string) => void
  onRetryTransfer: (id: string) => void
}

/**
 * Wires the headless use-file-browser hook to the extension's list/mkdir/rename/
 * delete actions and streaming upload/download routes. `sections`' item ids ARE
 * source refs (`term:<nodeId>/<handleId>` or `conn:<id>`) — the active place id is
 * used directly as the `source` param everywhere, no per-node lookup involved.
 *
 * `space` accompanies every call because connections and root paths are stored
 * per space, so a ref alone does not say which ones to resolve it against.
 *
 * `activeRootPath` is whatever root the caller has configured for
 * `defaultPlaceId`, and it is here because changing it re-roots browsing: see
 * the effect below.
 */
export function useFileManagerHost(
  space: string,
  sections: FileManagerHost['sections'],
  defaultPlaceId: string,
  initialPath?: string,
  onLocationSettled?: (source: string, path: string) => void,
  activeRootPath?: string,
): FileManagerHost {
  const [activePlaceId, setActivePlaceId] = useState(defaultPlaceId)
  const [currentPath, setCurrentPath] = useState(initialPath || '/')
  const [entries, setEntries] = useState<KitFileEntry[]>([])
  const [state, setState] = useState<FileListState>('loading')
  const [errorMessage, setErrorMessage] = useState<string | undefined>()
  const [transfers, setTransfers] = useState<TransferItemData[]>([])
  const transferHandles = useRef(new Map<string, TransferHandle>())
  // Bumped on every load() call; a response is only applied if its captured
  // sequence is still current, so a slow/older request can't clobber a newer
  // one's results (rapid navigation, or a slow backend like FTP).
  const loadSeq = useRef(0)

  useEffect(() => {
    onLocationSettled?.(activePlaceId, currentPath)
    // Fire only on the (source, path) pair itself changing, not on every
    // render — onLocationSettled's own identity is the caller's concern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlaceId, currentPath])

  const load = useCallback(async (source: string, path: string) => {
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
  }, [space])

  // True once we've settled on a real (non-empty) default place at least once —
  // distinguishes "the very first source becoming available" (use initialPath,
  // the deep-link restore) from "the place changed later" (e.g. the active
  // source disappeared after a sources refresh and a different default took
  // over — that's a new location, not a continuation, so it resets to "/"
  // rather than reusing whatever path the OLD source happened to be on).
  const hasSettledOnce = useRef(false)

  useEffect(() => {
    if (!defaultPlaceId) {
      setState('empty')
      setEntries([])
      return
    }
    const path = hasSettledOnce.current ? '/' : initialPath || '/'
    hasSettledOnce.current = true
    setActivePlaceId(defaultPlaceId)
    setCurrentPath(path)
    load(defaultPlaceId, path)
    // Re-runs on the two events that invalidate the path being held: the default
    // place changing, and the active place's root path changing. The second is
    // not a refresh — every path here is expressed relative to the old root, so
    // it resets to "/" exactly as a place change does, and without it a re-rooted
    // source keeps showing the listing it had before, with nothing on screen
    // saying so. Ordinary navigation between these goes through onLocationChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultPlaceId, activeRootPath])

  const onLocationChange = useCallback(
    (placeId: string, path: Crumb[]) => {
      // The kit hook seeds the root crumb as { id: placeId, name: ... } — its id
      // is the place id, not a filesystem path (the hook never accepts an
      // initialPath from us). Only crumbs beyond the root carry a real path,
      // since those come from entry.id in activateEntry. So root always means "/".
      const target = path.length <= 1 ? '/' : path[path.length - 1].id
      setActivePlaceId(placeId)
      setCurrentPath(target)
      load(placeId, target)
    },
    [load],
  )

  const refresh = useCallback(() => load(activePlaceId, currentPath), [load, activePlaceId, currentPath])

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

  const onNewFolder = useCallback(() => {
    const name = window.prompt('New folder name:')?.trim()
    if (!name) {
      return
    }
    runAction('mkdir', [joinPath(currentPath, name)])
  }, [runAction, currentPath])

  const onRenameEntry = useCallback(
    (id: string, name: string) => {
      // Preserve the trailing slash for a directory — providers key rename's
      // file-vs-directory handling off it (e.g. S3 rejects a mismatch).
      const newPath = joinPath(parentPath(id), name) + (id.endsWith('/') ? '/' : '')
      runAction('rename', [id, newPath])
    },
    [runAction],
  )

  const onDelete = useCallback(
    (entry: KitFileEntry) => {
      // Directory delete is recursive server-side — confirm before a slip
      // on a folder becomes data loss. A proper dialog can replace this
      // window.confirm once the design kit has one (matches the New-folder
      // window.prompt already used here).
      const kind = entry.kind === 'directory' ? 'folder (and everything in it)' : 'file'
      if (!window.confirm(`Delete ${kind} "${entry.name}"?`)) {
        return
      }
      runAction('delete', [entry.id])
    },
    [runAction],
  )

  const onDownload = useCallback(
    (entry: KitFileEntry) => {
      const url = `${routeUrl('download')}?space=${encodeURIComponent(space)}&source=${encodeURIComponent(activePlaceId)}&path=${encodeURIComponent(entry.id)}`
      window.open(url, '_blank')
    },
    [space, activePlaceId],
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
        } else {
          // Keep the handle (and its file) around — a failed transfer can be retried.
          setTransfers((prev) => prev.map((t) => (t.id === id ? { ...t, state: 'error', error: `Upload failed (${xhr.status})` } : t)))
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
    [space, activePlaceId, currentPath, refresh],
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

  const onCancelTransfer = useCallback((id: string) => {
    transferHandles.current.get(id)?.xhr.abort()
  }, [])

  const onRetryTransfer = useCallback(
    (id: string) => {
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
    onNewFolder,
    onUpload,
    onFilesDrop,
    onCancelTransfer,
    onRetryTransfer,
  }
}
