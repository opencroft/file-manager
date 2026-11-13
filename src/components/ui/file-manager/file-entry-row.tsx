import { type ChangeEvent, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { Copy, Download, FilePlus, FolderPlus, Pencil, Pin, PinOff, Trash2 } from 'lucide-react'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { FILE_KIND_LABEL, FileTypeIcon, fileKind } from '@/components/ui/files/file-type-icon'
import { cn } from 'cn'

export type FileEntryKind = 'file' | 'directory'

// One filesystem entry. `size` and `modified` arrive host-formatted (human
// units, relative-friendly dates) -- the component does no formatting itself.
export interface FileEntry {
  id: string
  name: string
  kind: FileEntryKind
  size?: string
  modified?: string
  // The raw values a Size or Date sort orders by (bytes, epoch milliseconds);
  // `size` and `modified` are only what is shown.
  sizeBytes?: number
  modifiedAt?: number
  // A page of its own for this entry (a directory's location), opened in a new tab on a middle-click.
  // Host-built; none means no new-tab gesture.
  href?: string
}

// The order of a listing: by which column, which way. Folders come before
// files under every sort.
export type FileSortKey = 'name' | 'date' | 'type' | 'size'
export interface FileSort {
  key: FileSortKey
  direction: 'asc' | 'desc'
}

export const DEFAULT_FILE_SORT: FileSort = { key: 'name', direction: 'asc' }

export const FILE_SORT_LABEL: Record<FileSortKey, string> = {
  name: 'Name',
  date: 'Date',
  type: 'Type',
  size: 'Size',
}

// What a surface that opens a context menu on long press sets on itself: the
// browser's own long-press behaviour (iOS callout, text selection) is off, and
// vertical scrolling still pans the list.
export const MENU_TRIGGER_TOUCH_STYLE: CSSProperties = {
  touchAction: 'pan-y',
  WebkitTouchCallout: 'none',
  userSelect: 'none',
}

// Extra row-menu actions beyond the built-in New folder / New file / Download /
// Copy path / Bookmark / Rename / Delete.
export interface FileEntryRowAction {
  label: string
  onSelect: (id: string) => void
  icon?: ReactNode
  destructive?: boolean
}

// A middle-click (the wheel) opens `href` in a new tab -- what it does on a
// link, for a row that is not one. The mousedown half keeps the browser from
// starting its autoscroll instead.
function middleClickOpens(href: string | undefined) {
  if (!href) return {}
  return {
    onMouseDown: (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault()
    },
    onAuxClick: (e: MouseEvent) => {
      if (e.button !== 1) return
      e.preventDefault()
      window.open(href, '_blank', 'noopener')
    },
  }
}

interface FileEntryRowProps {
  entry: FileEntry
  // 'table' (native table row, columns) by default, 'card' for a grid tile,
  // 'row' for a plain one-line list row.
  variant?: 'table' | 'card' | 'row'
  selected?: boolean
  // Controlled inline rename. While true the name is an input; the host owns
  // the draft through the rename* callbacks.
  renaming?: boolean
  renameValue?: string
  onRenameChange?: (value: string) => void
  onRenameCommit?: () => void
  onRenameCancel?: () => void
  // Why the typed name can't be used ("already exists"): the input is marked
  // invalid and the reason shows beside it. The input stays open.
  renameError?: string
  // What leaving the input does: 'commit' (the default) confirms the typed
  // name, as Rename does; 'cancel' drops it, for a row that only exists once a
  // name is confirmed.
  renameBlur?: 'commit' | 'cancel'
  // Open a directory / open a file (double-click or Enter).
  onActivate?: (entry: FileEntry) => void
  // `additive` is true for shift/meta/ctrl range/selection extension.
  onSelect?: (entry: FileEntry, additive: boolean) => void
  onDownload?: (entry: FileEntry) => void
  onRename?: (entry: FileEntry) => void
  onDelete?: (entry: FileEntry) => void
  onNewFolder?: () => void
  onNewFile?: () => void
  onCopyPath?: (entry: FileEntry) => void
  // A directory's Bookmark / Remove bookmark item; `bookmarked` says which.
  // Files never show it.
  onToggleBookmark?: (entry: FileEntry) => void
  bookmarked?: boolean
  actions?: FileEntryRowAction[]
  // Notified when the context menu opens/closes. The row leaves `ContextMenu`
  // uncontrolled -- it opens natively on right-click (desktop) or long-press
  // (touch), and there is no imperative way to open it -- so this is a
  // notification, not control: the host/list can react here (e.g. cancel an
  // in-flight interaction) when it does.
  onMenuOpenChange?: (open: boolean) => void
  className?: string
}

// A single file/directory entry. Selectable, and -- when any of the menu
// callbacks are wired -- wrapped in a context menu that opens on right-click
// (desktop) or long-press (touch), both handled by `ContextMenu` itself.
// The default `table` variant is a native table row (Name with the
// type icon inline, Date, Type, Size); `card` is a grid tile; `row` is a plain
// one-line row. The row suppresses the browser's native long-press behavior
// (iOS callout + text selection) and sets `touch-action: pan-y` so list
// scrolling keeps working. Visual only: it exposes state + callbacks and holds
// no logic.
export function FileEntryRow({
  entry,
  variant = 'table',
  selected = false,
  renaming = false,
  renameValue,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  renameError,
  renameBlur = 'commit',
  onActivate,
  onSelect,
  onDownload,
  onRename,
  onDelete,
  onNewFolder,
  onNewFile,
  onCopyPath,
  onToggleBookmark,
  bookmarked = false,
  actions,
  onMenuOpenChange,
  className,
}: FileEntryRowProps) {
  const directory = entry.kind === 'directory'
  const bookmarkItem = directory ? onToggleBookmark : undefined
  const hasMenu = Boolean(
    onDownload || onRename || onDelete || onNewFolder || onNewFile || onCopyPath || bookmarkItem || actions?.length,
  )

  // The row stays non-selectable / scroll-friendly, except while renaming the
  // name needs text selection and a caret.
  const touchStyle: CSSProperties = renaming ? { touchAction: 'auto', userSelect: 'text' } : MENU_TRIGGER_TOUCH_STYLE

  const nameInput = renaming ? (
    <span className='flex min-w-0 flex-1 items-center gap-2'>
      <input
        autoFocus
        aria-label='Name'
        aria-invalid={renameError ? true : undefined}
        onFocus={(e) => e.currentTarget.select()}
        {...(onRenameChange
          ? { value: renameValue ?? entry.name, onChange: (e: ChangeEvent<HTMLInputElement>) => onRenameChange(e.target.value) }
          : { defaultValue: entry.name })}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onRenameCommit?.()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onRenameCancel?.()
          }
        }}
        onBlur={() => (renameBlur === 'cancel' ? onRenameCancel?.() : onRenameCommit?.())}
        className={cn(
          'min-w-0 flex-1 rounded-sm bg-background px-1 py-0.5 text-xs text-foreground outline-none ring-1',
          renameError ? 'ring-destructive' : 'ring-ring',
        )}
      />
      {renameError ? (
        <span role='alert' className='shrink-0 text-xs text-destructive'>
          {renameError}
        </span>
      ) : null}
    </span>
  ) : null

  const menuContent = hasMenu ? (
    <ContextMenuContent className='min-w-[10rem]' onClick={(e) => e.stopPropagation()}>
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
      {onDownload ? (
        <ContextMenuItem onClick={() => onDownload(entry)}>
          <Download className='size-3' />
          Download
        </ContextMenuItem>
      ) : null}
      {onCopyPath ? (
        <ContextMenuItem onClick={() => onCopyPath(entry)}>
          <Copy className='size-3' />
          Copy path
        </ContextMenuItem>
      ) : null}
      {bookmarkItem ? (
        <ContextMenuItem onClick={() => bookmarkItem(entry)}>
          {bookmarked ? <PinOff className='size-3' /> : <Pin className='size-3' />}
          {bookmarked ? 'Remove bookmark' : 'Bookmark'}
        </ContextMenuItem>
      ) : null}
      {actions?.length
        ? actions.map((a) => (
            <ContextMenuItem
              key={a.label}
              className={a.destructive ? 'text-destructive focus:text-destructive' : undefined}
              onClick={() => a.onSelect(entry.id)}
            >
              {a.icon}
              {a.label}
            </ContextMenuItem>
          ))
        : null}
      {onRename ? (
        <ContextMenuItem onClick={() => onRename(entry)}>
          <Pencil className='size-3' />
          Rename
        </ContextMenuItem>
      ) : null}
      {onDelete ? (
        <ContextMenuItem className='text-destructive focus:text-destructive' onClick={() => onDelete(entry)}>
          <Trash2 className='size-3' />
          Delete
        </ContextMenuItem>
      ) : null}
    </ContextMenuContent>
  ) : null

  const handleClick = (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) =>
    onSelect?.(entry, e.shiftKey || e.metaKey || e.ctrlKey)
  const handleKeyDown = (e: { key: string; shiftKey: boolean; preventDefault: () => void }) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onActivate?.(entry)
    } else if (e.key === ' ') {
      e.preventDefault()
      onSelect?.(entry, e.shiftKey)
    }
  }

  // --- Table variant: a native <tr>. The type icon sits inside the Name cell
  // (not its own column): Name | Date | Type | Size. Native elements (no
  // primitive import) so the row renders unconditionally in the live preview. ---
  if (variant === 'table') {
    const row = (
      <tr
        data-selected={selected}
        tabIndex={0}
        style={touchStyle}
        onClick={handleClick}
        onDoubleClick={() => onActivate?.(entry)}
        {...middleClickOpens(entry.href)}
        onKeyDown={handleKeyDown}
        className={cn(
          'cursor-pointer border-b outline-none transition-colors hover:bg-muted',
          selected && 'bg-primary/10',
          className,
        )}
      >
        <td className='py-1.5 pl-2 pr-2 align-middle'>
          <div className='flex items-center gap-2'>
            <FileTypeIcon name={entry.name} directory={directory} />
            {renaming ? nameInput : <span className='truncate text-xs font-medium text-foreground'>{entry.name}</span>}
          </div>
        </td>
        <td className='py-1.5 pr-2 align-middle text-xs text-muted-foreground'>{entry.modified ?? '—'}</td>
        <td className='py-1.5 pr-2 align-middle text-xs text-muted-foreground'>{FILE_KIND_LABEL[fileKind(entry.name, directory)]}</td>
        <td className='py-1.5 pr-2 text-right align-middle text-xs text-muted-foreground'>{entry.size ?? '—'}</td>
      </tr>
    )
    if (!hasMenu) return row
    return (
      <ContextMenu onOpenChange={onMenuOpenChange}>
        <ContextMenuTrigger render={row} />
        {menuContent}
      </ContextMenu>
    )
  }

  // --- Card / row variants: a div row. ---
  const content =
    variant === 'card' ? (
      <div className='flex w-full min-w-0 flex-col items-center gap-1 px-1 py-2 text-center'>
        <FileTypeIcon name={entry.name} directory={directory} size='lg' />
        {renaming ? nameInput : <span className='w-full break-words text-xs text-foreground'>{entry.name}</span>}
        {entry.size ? <span className='shrink-0 text-xs text-muted-foreground'>{entry.size}</span> : null}
      </div>
    ) : (
      <div className='flex w-full min-w-0 items-center gap-2 py-1 pl-1 pr-2 text-left'>
        <FileTypeIcon name={entry.name} directory={directory} />
        {renaming ? nameInput : <span className='min-w-0 flex-1 truncate text-xs font-medium text-foreground'>{entry.name}</span>}
        {entry.size ? <span className='ml-auto shrink-0 pl-2 text-xs text-muted-foreground'>{entry.size}</span> : null}
        {entry.modified ? (
          <span className='hidden w-28 shrink-0 truncate text-xs text-muted-foreground sm:block'>{entry.modified}</span>
        ) : null}
      </div>
    )

  const rootClass = cn(
    'relative w-full min-w-0 cursor-pointer rounded-md outline-none transition-colors',
    'hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
    selected && 'bg-primary/10 ring-1 ring-primary/40',
    className,
  )

  const root = (
    <div
      role='button'
      tabIndex={0}
      data-selected={selected}
      style={touchStyle}
      onClick={handleClick}
      onDoubleClick={() => onActivate?.(entry)}
      {...middleClickOpens(entry.href)}
      onKeyDown={handleKeyDown}
      className={rootClass}
    >
      {content}
    </div>
  )

  if (!hasMenu) return root

  return (
    <ContextMenu onOpenChange={onMenuOpenChange}>
      <ContextMenuTrigger render={root} />
      {menuContent}
    </ContextMenu>
  )
}
