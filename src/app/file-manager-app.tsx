import { invoke } from '@opencroft/client/actions'
import type { AppComponentProps } from '@opencroft/client/app'
import { routeUrl } from '@opencroft/client/extension'
import { NodeRef } from '@opencroft/client/graph'
import { TerminalRef } from '@opencroft/client/terminal'
import { AppWindow, Cloud, FolderTree, LayoutGrid, Pencil, Server, Trash2, Workflow } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { ContextMenuItem } from '@/components/ui/context-menu'
import type { PlaceGroup, PlaceItem } from '@/components/ui/file-manager/connection-sidebar'
import { folderName, listingPath } from '@/lib/format'
import { ConnectionDialog, type ConnectionDraft } from './connection-dialog'
import { crumbsFor } from './crumbs'
import { readDeepLink, writeDeepLink } from './deep-link'
import { FileManagerBrowser } from './file-manager-browser'
import { RootPathDialog } from './root-path-dialog'
import { type TerminalGroupStep, terminalGroups } from './terminal-tree'
import type { ContainerState, ListSourcesResult, PlaceRef, ProtocolConnection, TerminalSourceInfo } from './types'
import type { FileManagerHost } from './use-file-manager-host'
import { usePlaces } from './use-places'

const CONNECTION_ICON: Record<ProtocolConnection['type'], ReactNode> = {
  s3: <Cloud className='size-4' />,
  ftp: <Server className='size-4' />,
}

const EMPTY_SOURCES: ListSourcesResult = { connections: [], terminalSources: [], sourceSettings: {}, spaces: [] }

// The filter field over the terminals shows from this many on: about as many
// rows as the sidebar shows at once on a phone, below which scanning the
// tree is quicker than typing.
const FILTER_FROM = 10

// Why a container terminal can't be opened, by what its Docker host answered.
const CONTAINER_UNREACHABLE: Record<Exclude<ContainerState, 'running'>, string> = {
  stopped: 'Not running',
  unreachable: 'Docker host not reachable',
}

// The icon of a group row, by its level; a node's row draws the node itself.
function placeGroup(step: TerminalGroupStep, appKind: TerminalSourceInfo['app']['kind']): PlaceGroup {
  if (step.level === 'owner' && step.ownerId) {
    return {
      id: step.id,
      name: step.name,
      defaultOpen: step.defaultOpen,
      label: <NodeRef nodeId={step.ownerId} className='gap-2 [&>svg]:size-3.5' />,
    }
  }
  const icon =
    step.level === 'space' ? (
      <LayoutGrid className='size-3.5' />
    ) : appKind === 'app' ? (
      <AppWindow className='size-3.5' />
    ) : (
      <Workflow className='size-3.5' />
    )
  return { id: step.id, name: step.name, defaultOpen: step.defaultOpen, icon }
}

// One of the App's session routes (server/routes.ts), for the App in
// `spaceSlug`. The listings are routes rather than actions because a route is
// told who calls it, and the terminals listed are those of the caller's spaces.
async function fetchRoute<T>(name: string, spaceSlug: string): Promise<T> {
  const response = await fetch(`${routeUrl(name)}?space=${encodeURIComponent(spaceSlug)}`)
  const body = await response.json().catch(() => undefined)
  if (!response.ok) {
    throw new Error((body as { error?: string } | undefined)?.error ?? `${name} answered ${response.status}`)
  }
  return body as T
}

function rootPathMenuItem(onSetRootPath: () => void): ReactNode {
  return (
    <ContextMenuItem onClick={onSetRootPath}>
      <FolderTree className='size-3' />
      Set root path…
    </ContextMenuItem>
  )
}

// The sidebar wraps the whole row in a context menu (right-click / long-press)
// whenever a PlaceItem carries `menu` — this is just its content (ContextMenuItem
// children), not another ContextMenu/ContextMenuContent wrapper.
function connectionMenu(onEdit: () => void, onRemove: () => void, onSetRootPath: () => void): ReactNode {
  return (
    <>
      <ContextMenuItem onClick={onEdit}>
        <Pencil className='size-3' />
        Edit connection
      </ContextMenuItem>
      {rootPathMenuItem(onSetRootPath)}
      <ContextMenuItem className='text-destructive focus:text-destructive' onClick={onRemove}>
        <Trash2 className='size-3' />
        Remove connection
      </ContextMenuItem>
    </>
  )
}

// A bookmarked or recent folder as a sidebar row: the folder's name (the
// terminal's own for its root), its terminal under it, a pin, and the folder
// as the place it opens. Places hold the folder's full path, so the listing
// path is worked out against the terminal's root path as it is now; a folder
// outside that root is shown as unreachable rather than opened somewhere
// else. Undefined for a folder whose terminal none of the person's spaces
// lists, so a removed terminal's folders drop out of the sidebar.
function folderItem(
  kind: 'bookmark' | 'recent',
  place: PlaceRef,
  terminals: TerminalSourceInfo[],
  rootPath: string | undefined,
  pin: PlaceItem['pin'],
): PlaceItem | undefined {
  const terminal = terminals.find((t) => t.ref === place.source)
  if (!terminal) {
    return undefined
  }
  const path = listingPath(rootPath, place.path)
  return {
    id: `${kind}:${place.source}:${place.path}`,
    name: folderName(place.path) || terminal.title,
    detail: <TerminalRef target={place.source.slice('term:'.length)} className='gap-1 [&>svg]:size-3' />,
    pin,
    ...(path === undefined
      ? { unreachable: `Outside the root path ${rootPath}` }
      : { location: { placeId: place.source, path: crumbsFor(place.source, terminal.title, path) } }),
  }
}

const isPlaceItem = (item: PlaceItem | undefined): item is PlaceItem => item !== undefined

/**
 * The File Manager App's view (see `provides.apps` in extension.json).
 *
 * Connections and root paths belong to the space this instance was added to,
 * so `spaceSlug` accompanies every call that reads or writes them.
 */
export function FileManagerApp({ instanceId, spaceSlug }: AppComponentProps) {
  const { places, recordRecent, addBookmark, removeBookmark, toggleBookmark } = usePlaces(instanceId)
  const [initialLink] = useState(readDeepLink)
  const [sources, setSources] = useState<ListSourcesResult>(EMPTY_SOURCES)
  // Flips false -> true exactly once, the first time loadSources resolves — keys
  // FileManagerBrowser's remount (see below) rather than gating whether it renders
  // at all, so the loading state is the kit listing's own 'loading', not a
  // separate screen.
  const [hasResolvedOnce, setHasResolvedOnce] = useState(false)
  const [activeSource, setActiveSource] = useState(initialLink.source)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ProtocolConnection | undefined>(undefined)
  const [rootPathTarget, setRootPathTarget] = useState<{ ref: string; name: string } | undefined>(undefined)

  // Hands back what it fetched as well as storing it: saveRootPath has to report
  // the value the server settled on, and reading that out of `sources` instead
  // would race the state update this same call queues.
  const loadSources = useCallback(async () => {
    try {
      const result = await fetchRoute<ListSourcesResult>('sources', spaceSlug)
      setSources(result)
      return result
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      return undefined
    } finally {
      setHasResolvedOnce(true)
    }
  }, [spaceSlug])

  useEffect(() => {
    loadSources()
  }, [loadSources])

  // Which containers run is asked of each Docker host, so it comes after the
  // list rather than holding it up; until it answers, containers show as
  // listed. A failure leaves them so: the reason goes to the console, since
  // nothing the person did failed.
  const [containerStates, setContainerStates] = useState<Record<string, ContainerState>>({})
  useEffect(() => {
    let cancelled = false
    fetchRoute<Record<string, ContainerState>>('container-states', spaceSlug)
      .then((states) => {
        if (!cancelled) setContainerStates(states)
      })
      .catch((err) => console.error('[file-manager] container states', err))
    return () => {
      cancelled = true
    }
  }, [spaceSlug])

  const openAddDialog = useCallback(() => {
    setEditing(undefined)
    setDialogOpen(true)
  }, [])

  const editConnection = useCallback((connection: ProtocolConnection) => {
    setEditing(connection)
    setDialogOpen(true)
  }, [])

  const removeConnection = useCallback(
    async (connection: ProtocolConnection) => {
      if (!window.confirm(`Remove connection "${connection.name}"? Its files are not affected.`)) {
        return
      }
      try {
        await invoke('removeConnection', spaceSlug, connection.id)
        if (activeSource === `conn:${connection.id}`) {
          setActiveSource('')
        }
        await loadSources()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    },
    [spaceSlug, activeSource, loadSources],
  )

  const saveRootPath = useCallback(
    async (ref: string, rootPath: string) => {
      try {
        const trimmed = rootPath.trim()
        await invoke('setSourceSettings', spaceSlug, ref, trimmed ? { rootPath: trimmed } : undefined)
        const refreshed = await loadSources()
        if (!refreshed) {
          return
        }
        // Report the value the server stored, not the one that was typed: it
        // drops a path that scopes nothing ("" and "/"), so echoing the input
        // would announce a scoping that does not exist. Saying anything at all
        // is the point — re-rooting the source being browsed reloads the listing
        // below, but re-rooting any OTHER source changes nothing on screen, and
        // silence there cannot be told apart from the save having failed.
        const saved = refreshed.sourceSettings[ref]?.rootPath
        toast.success(saved ? `Root path set to ${saved}` : 'Root path cleared')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    },
    [spaceSlug, loadSources],
  )

  const sections = useMemo<FileManagerHost['sections']>(() => {
    const result: FileManagerHost['sections'] = []
    const bookmarks = places.bookmarks
      .map((b) =>
        folderItem('bookmark', b, sources.terminalSources, sources.sourceSettings[b.source]?.rootPath, {
          pinned: true,
          label: 'Remove bookmark',
          onToggle: () => removeBookmark(b),
        }),
      )
      .filter(isPlaceItem)
    if (bookmarks.length) {
      result.push({ id: 'bookmarks', label: 'Bookmarks', items: bookmarks })
    }
    // The server keeps a bookmarked folder out of Recent, so every Recent pin bookmarks.
    const recent = places.recent
      .map((r) =>
        folderItem('recent', r, sources.terminalSources, sources.sourceSettings[r.source]?.rootPath, {
          pinned: false,
          label: 'Bookmark',
          onToggle: () => addBookmark(r),
        }),
      )
      .filter(isPlaceItem)
    if (recent.length) {
      result.push({ id: 'recent', label: 'Recent', items: recent })
    }
    if (sources.connections.length) {
      result.push({
        id: 'connections',
        label: 'Connections',
        items: sources.connections.map((c) => {
          const ref = `conn:${c.id}`
          return {
            id: ref,
            name: c.name,
            icon: CONNECTION_ICON[c.type],
            menu: connectionMenu(
              () => editConnection(c),
              () => removeConnection(c),
              () => setRootPathTarget({ ref, name: c.name }),
            ),
          }
        }),
      })
    }
    if (sources.terminalSources.length) {
      const groups = terminalGroups(sources.terminalSources, sources.spaces, spaceSlug)
      result.push({
        id: 'terminals',
        label: 'Terminals',
        rememberOpenAs: `file-manager:${instanceId}:terminal-groups`,
        ...(sources.terminalSources.length >= FILTER_FROM ? { filterPlaceholder: 'Filter terminals' } : {}),
        items: sources.terminalSources.map((s) => {
          const state = containerStates[s.ref]
          return {
            id: s.ref,
            name: s.title,
            // The host's own terminal reference: the node's type icon and its
            // current name, the same as everywhere else a terminal is shown.
            label: <TerminalRef target={s.ref.slice('term:'.length)} className='gap-2 [&>svg]:size-4' />,
            menu: rootPathMenuItem(() => setRootPathTarget({ ref: s.ref, name: s.title })),
            groups: (groups.get(s.ref) ?? []).map((step) => placeGroup(step, s.app.kind)),
            ...(state && state !== 'running' ? { unreachable: CONTAINER_UNREACHABLE[state] } : {}),
          }
        }),
      })
    }
    return result
  }, [
    sources,
    containerStates,
    spaceSlug,
    instanceId,
    editConnection,
    removeConnection,
    places,
    addBookmark,
    removeBookmark,
  ])

  // A connection or a terminal, never a Bookmarks or Recent row: those sit first
  // in the sidebar but are folders on a source, not a source to open at its root.
  const defaultPlaceId = useMemo(() => {
    const sourceIds = [...sources.connections.map((c) => `conn:${c.id}`), ...sources.terminalSources.map((s) => s.ref)]
    if (activeSource && sourceIds.includes(activeSource)) {
      return activeSource
    }
    return sourceIds[0] ?? ''
  }, [sources, activeSource])

  const handleLocationSettled = useCallback((source: string, path: string) => {
    setActiveSource(source)
    writeDeepLink(source, path)
  }, [])

  const saveConnection = useCallback(
    async (draft: ConnectionDraft) => {
      if (editing) {
        await invoke('updateConnection', spaceSlug, editing.id, draft)
      } else {
        await invoke('addConnection', spaceSlug, draft)
      }
      await loadSources()
    },
    [spaceSlug, editing, loadSources],
  )

  return (
    <div className='flex h-full min-h-[600px] w-full flex-col'>
      <FileManagerBrowser
        key={hasResolvedOnce ? 'ready' : 'loading'}
        space={spaceSlug}
        sections={sections}
        defaultPlaceId={defaultPlaceId}
        activeRootPath={sources.sourceSettings[defaultPlaceId]?.rootPath}
        sourcesLoading={!hasResolvedOnce}
        sourceSettings={sources.sourceSettings}
        initialPath={initialLink.path || undefined}
        onLocationSettled={handleLocationSettled}
        onAddConnection={openAddDialog}
        bookmarks={places.bookmarks}
        onToggleBookmark={toggleBookmark}
        onFolderUsed={recordRecent}
        rememberSidebarWidthAs={`file-manager:${instanceId}:sidebar-width`}
      />
      <ConnectionDialog
        spaceSlug={spaceSlug}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        connection={editing}
        onSave={saveConnection}
      />
      <RootPathDialog
        open={rootPathTarget !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setRootPathTarget(undefined)
          }
        }}
        sourceName={rootPathTarget?.name ?? ''}
        initialRootPath={rootPathTarget ? sources.sourceSettings[rootPathTarget.ref]?.rootPath : undefined}
        onSave={async (rootPath) => {
          if (rootPathTarget) {
            await saveRootPath(rootPathTarget.ref, rootPath)
          }
        }}
      />
    </div>
  )
}
