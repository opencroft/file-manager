'use client'

import type { MouseEvent, ReactNode } from 'react'
import { Folder, Plus } from 'lucide-react'

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
            const row = (
              <button
                key={item.id}
                type='button'
                onClick={() => onPlaceActivate?.(item.id)}
                {...middleClickOpens(item.href)}
                title={item.name}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none transition-colors',
                  active
                    ? 'bg-primary/10 font-medium text-foreground ring-1 ring-primary/40'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                {item.label !== undefined ? (
                  <span className='flex min-w-0 flex-1 items-center gap-2'>{item.label}</span>
                ) : (
                  <>
                    <span className='shrink-0 text-muted-foreground' aria-hidden>
                      {item.icon ?? <Folder className='size-4' />}
                    </span>
                    <span className='min-w-0 flex-1 truncate'>{item.name}</span>
                  </>
                )}
              </button>
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
