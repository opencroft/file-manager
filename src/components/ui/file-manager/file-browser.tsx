'use client'

import { type ComponentProps, type ReactNode, useRef, useState, useSyncExternalStore } from 'react'
import { PanelLeft, PanelLeftClose } from 'lucide-react'
import { usePanelRef } from 'react-resizable-panels'

import { ConnectionSidebar } from '@/components/ui/file-manager/connection-sidebar'
import { FileToolbar } from '@/components/ui/file-manager/file-toolbar'
import { FileEntryList } from '@/components/ui/file-manager/file-entry-list'
import { TransfersTray } from '@/components/ui/file-manager/transfers-tray'
import { FileSelectionBar } from '@/components/ui/file-manager/file-selection-bar'
import { Button } from '@/components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { cn } from 'cn'

// Each slice is exactly the corresponding subcomponent's props, produced by
// the use-file-browser hook — so the view is fully stateless and a host can
// also spread a single slice into a pane for a custom layout.
type PlacesSlice = ComponentProps<typeof ConnectionSidebar>
type ToolbarSlice = ComponentProps<typeof FileToolbar>
type ListingSlice = ComponentProps<typeof FileEntryList>
type TransfersSlice = ComponentProps<typeof TransfersTray>
type SelectionBarSlice = ComponentProps<typeof FileSelectionBar>

interface FileBrowserProps {
  places?: PlacesSlice
  toolbar?: ToolbarSlice
  listing?: ListingSlice
  transfers?: TransfersSlice
  // The bar of selection mode, under the entry list while it is given.
  selectionBar?: SelectionBarSlice
  // mobile sidebar: when open, the sidebar renders in place of the entry list
  // (a full-view swap), toggled from the toolbar's leading slot. Hook-owned.
  sidebarOpen?: boolean
  onSidebarOpenChange?: (open: boolean) => void
  // A key under which this browser keeps the width the sidebar was dragged
  // to, across reloads. Omitted, the sidebar starts at its default width.
  rememberSidebarWidthAs?: string
  className?: string
}

// The sidebar's starting width: room for a place's name beside its icon and
// pin, and the rest of the browser for the entry list.
const SIDEBAR_WIDTH = '13rem'
// A place's icon, pin button and padding take about 4rem, which leaves a
// top-level name about 6rem; rows deeper in a tree truncate, their full name
// in the tooltip.
const SIDEBAR_MIN_WIDTH = '10rem'
// The entry list keeps at least half of the browser.
const SIDEBAR_MAX_WIDTH = '50%'
// The handle's hit area in pixels, centred on the boundary. For a finger it
// matches the handle's own box (`pointer-coarse:after:w-6`, 1.5rem), where the
// handle's `touch-action: none` keeps the browser from taking the touch for
// scrolling; past that box a touch starts on a pane's content, where the
// browser can take it.
const HANDLE_TARGET = { coarse: 24, fine: 10 }
// Below sm (40rem, Tailwind's `max-sm:`) the sidebar and the entry list take
// the whole width in turn, as the toolbar's places toggle expects.
const NARROW_QUERY = '(width < 40rem)'

function subscribeToWidth(onChange: () => void): () => void {
  const query = window.matchMedia(NARROW_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

// False until mounted, and on the server; before that nothing is resizable anyway.
function useIsNarrow(): boolean {
  return useSyncExternalStore(
    subscribeToWidth,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  )
}

function readRememberedWidth(key: string | undefined): number | undefined {
  if (!key || typeof window === 'undefined') return undefined
  try {
    const width = Number(window.localStorage.getItem(key))
    return Number.isFinite(width) && width > 0 ? width : undefined
  } catch {
    return undefined
  }
}

function rememberWidth(key: string | undefined, width: number): void {
  if (!key || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, String(width))
  } catch {
    // Storage full or refused (a private window): the width lasts until reload.
  }
}

interface ResizableSidebarProps {
  places: PlacesSlice
  sidebarOpen?: boolean
  rememberWidthAs?: string
  children: ReactNode
}

// The sidebar beside the content with a draggable boundary between them from
// sm up, operated by pointer, touch on the handle, or the keyboard on the
// focused handle (arrows, Home, End). Below sm they take the whole width in
// turn, as `sidebarOpen` says, with no handle.
function ResizableSidebar({ places, sidebarOpen, rememberWidthAs, children }: ResizableSidebarProps) {
  const isNarrow = useIsNarrow()
  const groupRef = useRef<HTMLDivElement>(null)
  const sidebarRef = usePanelRef()
  const handleRef = useRef<HTMLDivElement>(null)
  // A bare number would be pixels and an unsuffixed string a percentage, so
  // the unit is always written.
  const [startWidth] = useState(() => {
    const remembered = readRememberedWidth(rememberWidthAs)
    return remembered === undefined ? SIDEBAR_WIDTH : `${remembered}px`
  })
  // The width the sidebar is meant to have: the starting one, then each one
  // the person chooses with the handle.
  const sidebarWidth = useRef(startWidth)

  // The library also reports the layout on mount and whenever the window
  // resizes the group, which can clamp the sidebar to its maximum; only a
  // change made with the handle (a drag, once the pointer is released, or a
  // key) is the person's choice, which the library marks `isUserInteraction`.
  const recordChosenWidth = (_layout: unknown, { isUserInteraction }: { isUserInteraction: boolean }) => {
    if (!isUserInteraction) return
    const percentage = sidebarRef.current?.getSize().asPercentage
    // Whichever layout the panels' pixel sizes show yet, together they span
    // the same width.
    const panels = groupRef.current?.querySelectorAll<HTMLElement>(':scope > [data-panel]') ?? []
    const panelsWidth = [...panels].reduce((sum, panel) => sum + panel.offsetWidth, 0)
    if (!percentage || !panelsWidth) return
    const width = Math.round((percentage / 100) * panelsWidth)
    sidebarWidth.current = `${width}px`
    rememberWidth(rememberWidthAs, width)
  }

  // The library holds the layout in percentages of the group. It converts the
  // sidebar's width for a group that resizes, but not for one that grows while
  // it mounts: a registration made at the narrower width is kept, so 13rem of
  // a narrower group becomes a wider sidebar. Whenever either panel's width
  // changes other than through the handle, the sidebar is put back to the
  // width it is meant to have: the minimum and maximum still apply, so a
  // sidebar the maximum narrowed widens again once there is room, and when it
  // already has that width the call changes nothing. The handle has focus
  // while a press on it or a key moves it.
  const keepSidebarWidth = () => {
    if (isNarrow || document.activeElement === handleRef.current) return
    sidebarRef.current?.resize(sidebarWidth.current)
  }

  return (
    <ResizablePanelGroup
      orientation='horizontal'
      elementRef={groupRef}
      // The handle hidden below sm measures 0 by 0 at the page's top-left
      // corner, and the library pads a hit area around it there unless the
      // group is disabled.
      disabled={isNarrow}
      resizeTargetMinimumSize={HANDLE_TARGET}
      onLayoutChanged={recordChosenWidth}
      className={cn(
        'min-h-0 min-w-0 flex-1',
        // Below sm: one pane at a time at the full width, and the browser's
        // own touch gestures (the library hands only vertical panning to the
        // browser). The library writes display, flex-grow and touch-action
        // inline, so these rules need !important.
        'max-sm:touch-auto! max-sm:[&>[data-panel]]:grow! max-sm:[&>[data-hidden-below-sm]]:hidden!',
      )}
    >
      <ResizablePanel
        panelRef={sidebarRef}
        defaultSize={startWidth}
        minSize={SIDEBAR_MIN_WIDTH}
        maxSize={SIDEBAR_MAX_WIDTH}
        // When the window's width changes the sidebar keeps its own and the
        // content takes the difference.
        groupResizeBehavior='preserve-pixel-size'
        onResize={keepSidebarWidth}
        data-hidden-below-sm={sidebarOpen ? undefined : ''}
        className='flex flex-col max-sm:touch-auto!'
      >
        <ConnectionSidebar {...places} className={cn('flex-1', places.className)} />
      </ResizablePanel>
      <ResizableHandle
        withHandle
        elementRef={handleRef}
        aria-label='Resize places'
        className='max-sm:hidden pointer-coarse:after:w-6'
      />
      <ResizablePanel
        onResize={keepSidebarWidth}
        data-hidden-below-sm={sidebarOpen ? '' : undefined}
        className='flex min-w-0 flex-col max-sm:touch-auto!'
      >
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

// The composed file-manager shell, T-shaped: the toolbar spans the full width
// across the top (carrying the mobile sidebar toggle in its leading slot), and
// below it the connection sidebar sits beside the entry list + transfers tray,
// with a draggable boundary between them. It fills its container (no
// border/rounding — it's meant to occupy a full dashboard pane) and holds no
// state of its own beyond the sidebar's width: the four grouped slices + the
// mobile sidebar-open flag come from the use-file-browser hook. On narrow
// widths the sidebar is toggled to a full-view swap (sidebar in place of the
// list) rather than a popup. Visual only.
export function FileBrowser({
  places,
  toolbar,
  listing,
  transfers,
  selectionBar,
  sidebarOpen,
  onSidebarOpenChange,
  rememberSidebarWidthAs,
  className,
}: FileBrowserProps) {
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
  const content = (
    <>
      {listing ? <FileEntryList {...listing} className={cn('flex-1', listing.className)} /> : null}
      {selectionBar ? <FileSelectionBar {...selectionBar} className={cn('shrink-0 px-2 pb-2', selectionBar.className)} /> : null}
      {hasTransfers && transfers ? <TransfersTray {...transfers} /> : null}
    </>
  )

  return (
    <div className={cn('flex h-full min-w-0 flex-col overflow-hidden bg-card', className)}>
      {toolbar ? <FileToolbar {...toolbar} leading={sidebarToggle} /> : null}

      {places ? (
        <ResizableSidebar places={places} sidebarOpen={sidebarOpen} rememberWidthAs={rememberSidebarWidthAs}>
          {content}
        </ResizableSidebar>
      ) : (
        <div className='flex min-h-0 min-w-0 flex-1 flex-col'>{content}</div>
      )}
    </div>
  )
}
