'use client'

import type { ComponentProps } from 'react'
import { PanelLeft, PanelLeftClose } from 'lucide-react'

import { ConnectionSidebar } from '@/components/ui/file-manager/connection-sidebar'
import { FileToolbar } from '@/components/ui/file-manager/file-toolbar'
import { FileEntryList } from '@/components/ui/file-manager/file-entry-list'
import { TransfersTray } from '@/components/ui/file-manager/transfers-tray'
import { Button } from '@/components/ui/button'
import { cn } from 'cn'

// Each slice is exactly the corresponding subcomponent's props, produced by
// the use-file-browser hook — so the view is fully stateless and a host can
// also spread a single slice into a pane for a custom layout.
type PlacesSlice = ComponentProps<typeof ConnectionSidebar>
type ToolbarSlice = ComponentProps<typeof FileToolbar>
type ListingSlice = ComponentProps<typeof FileEntryList>
type TransfersSlice = ComponentProps<typeof TransfersTray>

interface FileBrowserProps {
  places?: PlacesSlice
  toolbar?: ToolbarSlice
  listing?: ListingSlice
  transfers?: TransfersSlice
  // mobile sidebar: when open, the sidebar renders in place of the entry list
  // (a full-view swap), toggled from the toolbar's leading slot. Hook-owned.
  sidebarOpen?: boolean
  onSidebarOpenChange?: (open: boolean) => void
  className?: string
}

// The composed file-manager shell, T-shaped: the toolbar spans the full width
// across the top (carrying the mobile sidebar toggle in its leading slot), and
// below it the connection sidebar sits beside the entry list + transfers tray.
// It fills its container (no border/rounding — it's meant to occupy a full
// dashboard pane) and holds NO state of its own: the four grouped slices + the
// mobile sidebar-open flag come from the use-file-browser hook. On narrow
// widths the sidebar collapses and is toggled to a full-view swap (sidebar in
// place of the list) rather than a popup. Visual only.
export function FileBrowser({ places, toolbar, listing, transfers, sidebarOpen, onSidebarOpenChange, className }: FileBrowserProps) {
  const hasTransfers = Boolean(transfers?.transfers?.length)
  const sidebarToggle = places ? (
    <Button
      variant='ghost'
      size='sm'
      aria-label={sidebarOpen ? 'Hide places' : 'Show places'}
      className='h-7 w-7 p-0 sm:hidden'
      onClick={() => onSidebarOpenChange?.(!sidebarOpen)}
    >
      {sidebarOpen ? <PanelLeftClose className='size-4' /> : <PanelLeft className='size-4' />}
    </Button>
  ) : null

  return (
    <div className={cn('flex h-full min-w-0 flex-col overflow-hidden bg-card', className)}>
      {toolbar ? <FileToolbar {...toolbar} leading={sidebarToggle} /> : null}

      <div className='flex min-h-0 min-w-0 flex-1'>
        {/* desktop sidebar */}
        {places ? (
          <aside className='hidden w-52 shrink-0 border-r bg-card sm:flex sm:flex-col'>
            <ConnectionSidebar {...places} className={cn('flex-1', places.className)} />
          </aside>
        ) : null}

        {/* mobile full-view sidebar swap */}
        {places && sidebarOpen ? (
          <div className='flex min-w-0 flex-1 flex-col sm:hidden'>
            <ConnectionSidebar {...places} className='h-full' />
          </div>
        ) : null}

        {/* content (always on desktop; on mobile only when the sidebar is closed) */}
        <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', sidebarOpen ? 'hidden sm:flex' : 'flex')}>
          {listing ? <FileEntryList {...listing} className={cn('flex-1', listing.className)} /> : null}
          {hasTransfers && transfers ? <TransfersTray {...transfers} /> : null}
        </div>
      </div>
    </div>
  )
}
