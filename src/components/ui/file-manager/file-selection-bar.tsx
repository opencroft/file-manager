import { CheckCheck, Copy, Download, EllipsisVertical, FileArchive, PackageOpen, Pencil, Pin, PinOff, Trash2 } from 'lucide-react'

import { BulkActionBar, BulkActionBarButton } from '../actions/bulk-action-bar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../dropdown-menu'
import type { FileEntry } from './file-entry-row'

interface FileSelectionBarProps {
  // The selected entries, in listing order. The bar shows while there is one.
  entries: FileEntry[]
  // Ends the selection: the close button, and Esc.
  onClear: () => void
  // Select all, offered in More while something is not selected yet.
  onSelectAll?: () => void
  // The actions for all of `entries`, as the multi-item row menu has them.
  onDownload?: (entries: FileEntry[]) => void
  onPack?: (entries: FileEntry[]) => void
  onCopyPath?: (entries: FileEntry[]) => void
  onDelete?: (entries: FileEntry[]) => void
  // One entry's own actions, offered in More while exactly one is selected:
  // Rename, Unpack here (a `.zip` file), Bookmark (a folder; `bookmarked` says
  // which way).
  onRename?: (entry: FileEntry) => void
  onUnpack?: (entry: FileEntry) => void
  onToggleBookmark?: (entry: FileEntry) => void
  bookmarked?: boolean
  className?: string
}

function items(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'items'}`
}

// The bar of selection mode in the file browser: the count, Download, Pack into
// zip and Delete for all selected entries, and ⋮ More with the rest -- Select
// all, Copy paths, and for a single entry its own actions. Built on the base
// kit's bulk action bar; the owner keeps the selection and places the bar.
// Visual only.
export function FileSelectionBar({
  entries,
  onClear,
  onSelectAll,
  onDownload,
  onPack,
  onCopyPath,
  onDelete,
  onRename,
  onUnpack,
  onToggleBookmark,
  bookmarked = false,
  className,
}: FileSelectionBarProps) {
  const count = entries.length
  const only = count === 1 ? entries[0] : undefined
  const zip = !(only && only.kind === 'file')
  const unpack = only && only.kind === 'file' && /\.zip$/i.test(only.name) ? onUnpack : undefined
  const bookmark = only?.kind === 'directory' ? onToggleBookmark : undefined
  const singles = only && (onRename || unpack || bookmark)

  const more = (
    <DropdownMenu>
      <DropdownMenuTrigger render={<BulkActionBarButton icon={<EllipsisVertical />} label='More' />} />
      <DropdownMenuContent side='top' align='end' className='min-w-48'>
        <DropdownMenuGroup>
          {onSelectAll ? (
            <DropdownMenuItem onClick={onSelectAll}>
              <CheckCheck />
              Select all
            </DropdownMenuItem>
          ) : null}
          {onDownload ? (
            <DropdownMenuItem onClick={() => onDownload(entries)}>
              <Download />
              {zip ? 'Download as zip' : 'Download'}
            </DropdownMenuItem>
          ) : null}
          {onPack ? (
            <DropdownMenuItem onClick={() => onPack(entries)}>
              <FileArchive />
              Pack into zip
            </DropdownMenuItem>
          ) : null}
          {onCopyPath ? (
            <DropdownMenuItem onClick={() => onCopyPath(entries)}>
              <Copy />
              {count === 1 ? 'Copy path' : 'Copy paths'}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        {singles && only ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {unpack ? (
                <DropdownMenuItem onClick={() => unpack(only)}>
                  <PackageOpen />
                  Unpack here
                </DropdownMenuItem>
              ) : null}
              {bookmark ? (
                <DropdownMenuItem onClick={() => bookmark(only)}>
                  {bookmarked ? <PinOff /> : <Pin />}
                  {bookmarked ? 'Remove bookmark' : 'Bookmark'}
                </DropdownMenuItem>
              ) : null}
              {onRename ? (
                <DropdownMenuItem onClick={() => onRename(only)}>
                  <Pencil />
                  Rename
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
          </>
        ) : null}
        {onDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem variant='destructive' onClick={() => onDelete(entries)}>
                <Trash2 />
                Delete {items(count)}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <BulkActionBar
      count={count}
      onClear={onClear}
      label={`Actions for ${items(count)}`}
      className={className}
      end={
        <>
          {onDelete ? (
            <BulkActionBarButton icon={<Trash2 />} label={`Delete ${items(count)}`} destructive onClick={() => onDelete(entries)} />
          ) : null}
          {more}
        </>
      }
    >
      {onDownload ? (
        <BulkActionBarButton icon={<Download />} label={zip ? 'Download as zip' : 'Download'} onClick={() => onDownload(entries)} />
      ) : null}
      {onPack ? <BulkActionBarButton icon={<FileArchive />} label='Pack into zip' onClick={() => onPack(entries)} /> : null}
    </BulkActionBar>
  )
}
