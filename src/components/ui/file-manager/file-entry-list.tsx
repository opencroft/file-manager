import { useState, type DragEvent } from 'react'
import { AlertTriangle, FolderOpen, RefreshCw } from 'lucide-react'

import { FileEntryRow, type FileEntry } from '@/components/ui/file-manager/file-entry-row'
import { Button } from '@/components/ui/button'
import { cn } from 'cn'

export type FileListState = 'list' | 'loading' | 'empty' | 'error'

interface FileEntryListProps {
  entries: FileEntry[]
  state?: FileListState
  errorMessage?: string
  view?: 'list' | 'grid'
  selectedIds?: string[]
  onActivate?: (entry: FileEntry) => void
  onSelect?: (entry: FileEntry, additive: boolean) => void
  onDownload?: (entry: FileEntry) => void
  // Inline rename is controlled by the owner (the use-file-browser hook, or a
  // host wiring the list directly). The list only forwards these to the row
  // whose id === renamingId — it holds no rename state of its own.
  renamingId?: string | null
  renameValue?: string
  onRename?: (entry: FileEntry) => void
  onRenameChange?: (value: string) => void
  onRenameCommit?: () => void
  onRenameCancel?: () => void
  onMenuOpenChange?: (open: boolean) => void
  onDelete?: (entry: FileEntry) => void
  onNewFolder?: () => void
  // Native file/folder drop onto the list (dropzone).
  onFilesDrop?: (files: File[]) => void
  onRetry?: () => void
  className?: string
}

const TH = 'py-1.5 pl-2 pr-2 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground'

// The scrollable body of the file browser. The default `list` view is a native
// table (Name / Date / Type / Size, with the type icon inline in the Name
// cell); `grid` is a tile grid. Plus loading / empty / error states and a file
// dropzone (drag-over highlight). Rename is fully controlled by the owner; row
// menus are uncontrolled and open natively (right-click on desktop, long-press
// on touch -- `ContextMenu` has no imperative way to open), and
// onMenuOpenChange lets the owner cancel an in-flight
// rename the moment a menu opens. There is no row drag in v1, so there is no
// gesture controller here. Visual only: it exposes state + callbacks and holds
// no data logic.
export function FileEntryList({
  entries,
  state = 'list',
  errorMessage,
  view = 'list',
  selectedIds,
  onActivate,
  onSelect,
  onDownload,
  renamingId,
  renameValue,
  onRename,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onMenuOpenChange,
  onDelete,
  onNewFolder,
  onFilesDrop,
  onRetry,
  className,
}: FileEntryListProps) {
  // dropzone drag-over highlight is the only local state (transient pointer
  // state, nothing the owner needs to control).
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length && onFilesDrop) onFilesDrop(files)
  }

  const renderEntry = (entry: FileEntry) => (
    <FileEntryRow
      key={entry.id}
      entry={entry}
      variant={view === 'grid' ? 'card' : 'table'}
      selected={selectedIds?.includes(entry.id)}
      renaming={renamingId === entry.id}
      renameValue={renameValue}
      onRenameChange={onRenameChange}
      onRenameCommit={onRenameCommit}
      onRenameCancel={onRenameCancel}
      onActivate={onActivate}
      onSelect={onSelect}
      onDownload={onDownload}
      onRename={onRename}
      onDelete={onDelete}
      onNewFolder={onNewFolder}
      onMenuOpenChange={onMenuOpenChange}
    />
  )

  const body = (() => {
    if (state === 'loading') {
      return (
        <div className='flex flex-col gap-1 p-2'>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className='flex items-center gap-2 py-1 pl-1 pr-2'>
              <div className='size-4 animate-pulse rounded bg-muted' />
              <div className='h-3 flex-1 animate-pulse rounded bg-muted' />
            </div>
          ))}
        </div>
      )
    }
    if (state === 'empty') {
      return (
        <div className='flex min-h-full flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground'>
          <FolderOpen className='size-6' aria-hidden />
          <span className='text-xs'>This folder is empty</span>
        </div>
      )
    }
    if (state === 'error') {
      return (
        <div className='flex min-h-full flex-col items-center justify-center gap-2 py-10 text-center'>
          <AlertTriangle className='size-6 text-destructive' aria-hidden />
          <span className='max-w-xs text-xs text-muted-foreground'>
            {errorMessage ?? 'Something went wrong loading this folder.'}
          </span>
          {onRetry ? (
            <Button variant='outline' size='sm' onClick={onRetry}>
              <RefreshCw className='size-3' />
              Retry
            </Button>
          ) : null}
        </div>
      )
    }
    return view === 'grid' ? (
      // As many columns as the pane fits: auto-fill with a 6rem minimum tile,
      // the spare width shared out -- not a fixed count per viewport
      // breakpoint, which stretched tiles in a wide pane and cramped them in a
      // narrow one. Unlike a wrapping flex row, the last row stays on the
      // same columns.
      <div className='grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-1 p-1'>
        {entries.map(renderEntry)}
      </div>
    ) : (
      <table className='w-full border-collapse text-sm'>
        <thead>
          <tr className='border-b'>
            <th className={TH}>Name</th>
            <th className={TH}>Date</th>
            <th className={TH}>Type</th>
            <th className={cn(TH, 'text-right')}>Size</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(renderEntry)}
        </tbody>
      </table>
    )
  })()

  return (
    <div
      className={cn('relative min-h-0 min-w-0 flex-1 overflow-auto rounded-md', className)}
      onDragOver={(e) => {
        if (!onFilesDrop) return
        e.preventDefault()
        if (!dragOver) setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false)
      }}
      onDrop={handleDrop}
    >
      {body}
      {dragOver ? (
        <div className='pointer-events-none absolute inset-0 z-10 rounded-md ring-2 ring-primary ring-inset' />
      ) : null}
    </div>
  )
}
