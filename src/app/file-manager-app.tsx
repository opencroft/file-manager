import { invoke, React, toast } from '@ext/host'
import { type AppComponentProps, TerminalRef } from '@opencroft/client'
import { Cloud, FolderTree, HardDrive, Pencil, Server, Trash2 } from 'lucide-react'

import { ContextMenuItem } from '@/components/ui/context-menu'
import { FileManagerBrowser } from './file-manager-browser'
import type { FileManagerHost } from './use-file-manager-host'
import { ConnectionDialog, type ConnectionDraft } from './connection-dialog'
import { readDeepLink, writeDeepLink } from './deep-link'
import { RootPathDialog } from './root-path-dialog'
import type { ListSourcesResult, ProtocolConnection } from './types'

const { useCallback, useEffect, useMemo, useState } = React

const CONNECTION_ICON: Record<ProtocolConnection['type'], React.ReactNode> = {
  s3: <Cloud className='size-4' />,
  ftp: <Server className='size-4' />,
}

const EMPTY_SOURCES: ListSourcesResult = { connections: [], terminalSources: [], sourceSettings: {} }

function rootPathMenuItem(onSetRootPath: () => void): React.ReactNode {
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
function connectionMenu(onEdit: () => void, onRemove: () => void, onSetRootPath: () => void): React.ReactNode {
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

/**
 * The File Manager App's view (see `provides.apps` in extension.json).
 *
 * Connections and root paths belong to the space this instance was added to,
 * so `spaceSlug` accompanies every call that reads or writes them.
 */
export function FileManagerApp({ spaceSlug }: AppComponentProps) {
  const [initialLink] = useState(readDeepLink)
  const [sources, setSources] = useState<ListSourcesResult>(EMPTY_SOURCES)
  // Flips false -> true exactly once, the first time listSources resolves — keys
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
      const result = (await invoke('listSources', spaceSlug)) as ListSourcesResult
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
      result.push({
        id: 'terminals',
        label: 'Terminals',
        items: sources.terminalSources.map((s) => ({
          id: s.ref,
          name: s.title,
          icon: <HardDrive className='size-4' />,
          // The host's own terminal reference: the node's type icon and its
          // current name, the same as everywhere else a terminal is shown.
          label: <TerminalRef target={s.ref.slice('term:'.length)} className='gap-2 [&>svg]:size-4' />,
          menu: rootPathMenuItem(() => setRootPathTarget({ ref: s.ref, name: s.title })),
        })),
      })
    }
    return result
  }, [sources, editConnection, removeConnection])

  const defaultPlaceId = useMemo(() => {
    const allIds = sections.flatMap((s) => s.items.map((i) => i.id))
    if (activeSource && allIds.includes(activeSource)) {
      return activeSource
    }
    return allIds[0] ?? ''
  }, [sections, activeSource])

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
        initialPath={initialLink.path || undefined}
        onLocationSettled={handleLocationSettled}
        onAddConnection={openAddDialog}
      />
      <ConnectionDialog open={dialogOpen} onOpenChange={setDialogOpen} connection={editing} onSave={saveConnection} />
      <RootPathDialog
        open={rootPathTarget !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setRootPathTarget(undefined)
          }
        }}
        sourceName={rootPathTarget?.name ?? ''}
        initialRootPath={rootPathTarget ? sources.sourceSettings[rootPathTarget.ref]?.rootPath : undefined}
        onSave={(rootPath) => saveRootPath(rootPathTarget!.ref, rootPath)}
      />
    </div>
  )
}
