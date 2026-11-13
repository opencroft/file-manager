'use client'

import type { MouseEvent, ReactNode } from 'react'
import { Folder, Pin, PinOff, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import { cn } from 'cn'

// One browsable place. Deliberately abstract: the host supplies the icon, so
// any connection kind (terminal handle, s3, ssh, ftp, a favorite folder, ...)
// renders without the sidebar hardcoding types. Falls back to a folder icon.
// `menu` is optional right-click menu content (ContextMenuItem children) — when
// present the row is wrapped in a context menu (right-click / long-press) with
// the row as the trigger, same pattern as file-entry-row. Type-agnostic:
// the host decides which places get a menu (e.g. connections, not favorites).
export interface PlaceItem {
  id: string
  name: string
  icon?: ReactNode
  menu?: ReactNode
  // Rendered in place of the icon AND the name when given: a host component
  // that draws the place itself (e.g. one that resolves a reference to its
  // current name and type icon). `name` stays the plain-text form -- the
  // row's tooltip and the breadcrumb's fallback.
  label?: ReactNode
  // A page of its own for this place, opened in a new tab on a middle-click.
  // Host-built; none means no new-tab gesture.
  href?: string
  // A second, muted line under the name: where the place is (e.g. the
  // terminal a bookmarked folder is on).
  detail?: ReactNode
  // A pin button at the row's end, always shown: `pinned` draws it as
  // unpinning, `label` names what pressing it does.
  pin?: PlacePin
  // A folder inside another place (a bookmark, a recent folder): activating
  // the item opens `placeId` at `path` (root-first, the same crumbs the
  // breadcrumb shows) rather than a place root of its own.
  location?: { placeId: string; path: { id: string; name: string }[] }
  // Why the place can't be opened now (e.g. a folder outside its terminal's
  // root path). Given, the row is dimmed, pressing it does nothing, and the
  // reason shows in place of `detail`; its pin still works.
  unreachable?: string
}

export interface PlacePin {
  pinned: boolean
  label: string
  onToggle: () => void
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

// A labelled group of places (e.g. "Favorites", "Connections").
export interface PlaceSection {
  id: string
  label?: string
  items: PlaceItem[]
}

interface ConnectionSidebarProps {
  sections: PlaceSection[]
  activePlaceId?: string
  onPlaceActivate?: (id: string) => void
  onAddConnection?: () => void
  className?: string
}

// The file-browser sidebar: grouped places (favorites + connections) on the
// left, with an optional Add-connection action at the foot. Places are abstract
// -- the host owns the list and each item's icon, so no connection type is
// hardcoded here. A row with a `menu` slot is wrapped in a context menu that
// opens on right-click (desktop) / long-press (touch); the row itself is
// unchanged in any state. Visual only.
export function ConnectionSidebar({
  sections,
  activePlaceId,
  onPlaceActivate,
  onAddConnection,
  className,
}: ConnectionSidebarProps) {
  return (
    <div className={cn('flex w-full flex-col gap-3 overflow-auto p-2', className)}>
      {sections.map((section) => (
        <div key={section.id} className='flex flex-col gap-0.5'>
          {section.label ? (
            <span className='px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
              {section.label}
            </span>
          ) : null}
          {section.items.map((item) => {
            const active = item.id === activePlaceId
            const unreachable = item.unreachable !== undefined
            const detail = unreachable ? item.unreachable : item.detail
            const place = (
              <button
                type='button'
                disabled={unreachable}
                onClick={() => onPlaceActivate?.(item.id)}
                {...(unreachable ? {} : middleClickOpens(item.href))}
                title={unreachable ? `${item.name}: ${item.unreachable}` : item.name}
                className='flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60'
              >
                {item.label !== undefined ? (
                  <span className='flex min-w-0 flex-1 items-center gap-2'>{item.label}</span>
                ) : (
                  <>
                    <span className='shrink-0 text-muted-foreground' aria-hidden>
                      {item.icon ?? <Folder className='size-4' />}
                    </span>
                    <span className='flex min-w-0 flex-1 flex-col'>
                      <span className='truncate'>{item.name}</span>
                      {detail !== undefined ? (
                        <span className='flex min-w-0 items-center gap-1 truncate font-normal text-muted-foreground'>
                          {detail}
                        </span>
                      ) : null}
                    </span>
                  </>
                )}
              </button>
            )
            const row = (
              <div
                key={item.id}
                className={cn(
                  'flex w-full items-center rounded-md text-xs transition-colors',
                  active
                    ? 'bg-primary/10 font-medium text-foreground ring-1 ring-primary/40'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {place}
                {item.pin ? (
                  <Button
                    variant='ghost'
                    size='sm'
                    aria-label={item.pin.label}
                    title={item.pin.label}
                    className='mr-0.5 h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-foreground'
                    onClick={item.pin.onToggle}
                  >
                    {item.pin.pinned ? <PinOff className='size-3.5' /> : <Pin className='size-3.5' />}
                  </Button>
                ) : null}
              </div>
            )
            if (!item.menu) return row
            return (
              <ContextMenu key={item.id}>
                <ContextMenuTrigger render={row} />
                <ContextMenuContent className='min-w-[10rem]'>{item.menu}</ContextMenuContent>
              </ContextMenu>
            )
          })}
        </div>
      ))}

      {onAddConnection ? (
        <Button variant='outline' size='sm' className='mt-auto gap-1' onClick={onAddConnection}>
          <Plus className='size-3.5' />
          Add connection
        </Button>
      ) : null}
    </div>
  )
}
