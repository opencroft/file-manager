import { useState, type DragEvent, type ReactElement } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, FilePlus, FolderOpen, FolderPlus, RefreshCw, Upload } from 'lucide-react'

import {
  FILE_SORT_LABEL,
  FileEntryRow,
  MENU_TRIGGER_TOUCH_STYLE,
  type FileEntry,
  type FileEntryKind,
  type FileSort,
  type FileSortKey,
} from './file-entry-row'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { cn } from 'cn'

export type FileListState = 'list' | 'loading' | 'empty' | 'error'

interface FileEntryListProps {
  entries: FileEntry[]
  state?: FileListState
  errorMessage?: string
  view?: 'list' | 'grid'
  selectedIds?: string[]
  // The order `entries` arrive in, shown on the list view's column headers.
  // With onSortChange the headers are buttons: pressing the sorted column flips
  // its direction, another column starts ascending. The list does not reorder
  // entries itself.
  sort?: FileSort
  onSortChange?: (sort: FileSort) => void
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
  onCopyPath?: (entry: FileEntry) => void
  // Directories whose id is in `bookmarkedIds` offer Remove bookmark, the rest Bookmark.
  onToggleBookmark?: (entry: FileEntry) => void
  bookmarkedIds?: string[]
  onNewFolder?: () => void
  onNewFile?: () => void
  // A new entry being named: while set, a draft row of that kind sits first
  // among its kind (folders, or files), named through the same rename* draft
  // as Rename. It has no menu, and leaving its input cancels it.
  creating?: FileEntryKind | null
  // Why the name typed into the rename or draft row can't be used.
  renameError?: string
  // The list's own menu, on the empty space below the entries and in an
  // empty folder (right-click / long-press): New folder, New file, Upload
  // file, Refresh -- each shown when its callback is wired.
  onUpload?: () => void
  onRefresh?: () => void
  // Native file/folder drop onto the list (dropzone).
  onFilesDrop?: (files: File[]) => void
  onRetry?: () => void
  className?: string
}

// The draft row's id and React key. Only its key meets the entries' ids, so it
// is spelled to stay clear of a host's path-like ones.
const DRAFT_ID = 'file-entry-list:draft'

const TH = 'py-1.5 pl-2 pr-2 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground'

// The scrollable body of the file browser. The default `list` view is a native
// table (Name / Date / Type / Size, with the type icon inline in the Name
// cell); `grid` is a tile grid. Plus loading / empty / error states and a file
// dropzone (drag-over highlight). Rename is fully controlled by the owner; row
// menus are uncontrolled and open natively (right-click on desktop, long-press
// on touch -- `ContextMenu` has no imperative way to open), and
// onMenuOpenChange lets the owner cancel an in-flight
// rename the moment a menu opens. The space below the entries, and an empty
// folder, open the list's own menu the same ways. There is no row drag in v1,
// so there is no gesture controller here. Visual only: it exposes state +
// callbacks and holds no data logic.
export function FileEntryList({
  entries,
  state = 'list',
  errorMessage,
  view = 'list',
  selectedIds,
  sort,
  onSortChange,
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
  onCopyPath,
  onToggleBookmark,
  bookmarkedIds,
  onNewFolder,
  onNewFile,
  creating,
  renameError,
  onUpload,
  onRefresh,
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

  const header = (key: FileSortKey, className?: string) => {
    const direction = sort?.key === key ? sort.direction : undefined
    const label = FILE_SORT_LABEL[key]
    return (
      <th
        className={cn(TH, className)}
        aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : undefined}
      >
        {onSortChange ? (
          <button
            type='button'
            className={cn(
              'inline-flex items-center gap-1 uppercase tracking-wide outline-none hover:text-foreground focus-visible:text-foreground',
              direction && 'text-foreground',
            )}
            onClick={() => onSortChange({ key, direction: direction === 'asc' ? 'desc' : 'asc' })}
          >
            {label}
            {direction === 'asc' ? <ArrowUp className='size-3' aria-hidden /> : null}
            {direction === 'desc' ? <ArrowDown className='size-3' aria-hidden /> : null}
          </button>
        ) : (
          label
        )}
      </th>
    )
  }

  const variant = view === 'grid' ? 'card' : 'table'

  const renderEntry = (entry: FileEntry) => (
    <FileEntryRow
      key={entry.id}
      entry={entry}
      variant={variant}
      selected={selectedIds?.includes(entry.id)}
      renaming={renamingId === entry.id}
      renameValue={renameValue}
      onRenameChange={onRenameChange}
      onRenameCommit={onRenameCommit}
      onRenameCancel={onRenameCancel}
      renameError={renamingId === entry.id ? renameError : undefined}
      onActivate={onActivate}
      onSelect={onSelect}
      onDownload={onDownload}
      onRename={onRename}
      onDelete={onDelete}
      onNewFolder={onNewFolder}
      onNewFile={onNewFile}
      onCopyPath={onCopyPath}
      onToggleBookmark={onToggleBookmark}
      bookmarked={bookmarkedIds?.includes(entry.id)}
      onMenuOpenChange={onMenuOpenChange}
    />
  )

  // The entries, with the draft row first among its kind while one is being named.
  const rows = (() => {
    const rendered = entries.map(renderEntry)
    if (!creating) return rendered
    const draft = (
      <FileEntryRow
        key={DRAFT_ID}
        entry={{ id: DRAFT_ID, name: '', kind: creating }}
        variant={variant}
        renaming
        renameValue={renameValue}
        onRenameChange={onRenameChange}
        onRenameCommit={onRenameCommit}
        onRenameCancel={onRenameCancel}
        renameError={renameError}
        renameBlur='cancel'
      />
    )
    const firstFile = entries.findIndex((e) => e.kind !== 'directory')
    const at = creating === 'directory' ? 0 : firstFile === -1 ? entries.length : firstFile
    return [...rendered.slice(0, at), draft, ...rendered.slice(at)]
  })()

  const hasListMenu = Boolean(onNewFolder || onNewFile || onUpload || onRefresh)
  // Wraps a surface with nothing on it (the space below the entries, an empty
  // folder) in the list's menu.
  const withListMenu = (surface: ReactElement) =>
    hasListMenu ? (
      <ContextMenu onOpenChange={onMenuOpenChange}>
        <ContextMenuTrigger render={surface} />
        <ContextMenuContent className='min-w-[10rem]'>
          {onNewFolder ? (
            <ContextMenuItem onClick={() => onNewFolder()}>
              <FolderPlus className='size-3' />
              New folder
            </ContextMenuItem>
          ) : null}
          {onNewFile ? (
            <ContextMenuItem onClick={() => onNewFile()}>
              <FilePlus className='size-3' />
              New file
            </ContextMenuItem>
          ) : null}
          {onUpload ? (
            <ContextMenuItem onClick={() => onUpload()}>
              <Upload className='size-3' />
              Upload file
            </ContextMenuItem>
          ) : null}
          {onRefresh ? (
            <ContextMenuItem onClick={() => onRefresh()}>
              <RefreshCw className='size-3' />
              Refresh
            </ContextMenuItem>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
    ) : (
      surface
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
    if (state === 'empty' && !creating) {
      return withListMenu(
        <div
          style={MENU_TRIGGER_TOUCH_STYLE}
          className='flex min-h-full flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground'
        >
          <FolderOpen className='size-6' aria-hidden />
          <span className='text-xs'>This folder is empty</span>
        </div>,
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
    const listing =
      view === 'grid' ? (
        // As many columns as the pane fits: auto-fill with a 6rem minimum tile,
        // the spare width shared out -- not a fixed count per viewport
        // breakpoint, which stretched tiles in a wide pane and cramped them in a
        // narrow one. Unlike a wrapping flex row, the last row stays on the
        // same columns.
        <div className='grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-1 p-1'>{rows}</div>
      ) : (
        <table className='w-full border-collapse text-sm'>
          <thead>
            <tr className='border-b'>
              {header('name')}
              {header('date')}
              {header('type')}
              {header('size', 'text-right')}
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      )
    // The space below the last entry fills the rest of the pane and opens the
    // list's menu. It is never shorter than 2rem, a little over one table
    // row, so a folder long enough to scroll still has some at its end.
    return (
      <div className='flex min-h-full flex-col'>
        {listing}
        {withListMenu(<div data-slot='file-list-space' style={MENU_TRIGGER_TOUCH_STYLE} className='min-h-8 flex-1' />)}
      </div>
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
