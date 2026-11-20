'use client'

import { type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Folder, Pin, PinOff, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'
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
  // row's tooltip, what the filter matches and the breadcrumb's fallback.
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
  // root path, a container that is not running). Given, the row is dimmed,
  // pressing it does nothing, and the reason shows in place of `detail` (or
  // under `label`); its pin still works.
  unreachable?: string
  // The collapsible groups the place sits in, outermost first. Places sharing
  // a group's id share its row, which is placed where the first of them is.
  groups?: PlaceGroup[]
}

export interface PlacePin {
  pinned: boolean
  label: string
  onToggle: () => void
}

// A collapsible row over the places inside it. `id` is unique in its section;
// `name` is the plain-text form (the tooltip, and what the filter matches),
// `label` draws it in its place, as on a PlaceItem. Without a remembered
// state a group is open unless `defaultOpen` is false.
export interface PlaceGroup {
  id: string
  name: string
  label?: ReactNode
  icon?: ReactNode
  defaultOpen?: boolean
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
// `filterPlaceholder` puts a filter field over its places: typing keeps the
// places whose name, or a group's name above them, contains the text, with
// their groups open. `rememberOpenAs` is a key under which this browser keeps
// which of its groups are open or closed, across reloads.
export interface PlaceSection {
  id: string
  label?: string
  items: PlaceItem[]
  filterPlaceholder?: string
  rememberOpenAs?: string
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
        <SidebarSection
          key={section.id}
          section={section}
          activePlaceId={activePlaceId}
          onPlaceActivate={onPlaceActivate}
        />
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

// A group's row and what is inside it, in the order the places came.
interface GroupNode {
  group: PlaceGroup
  children: TreeNode[]
}

type TreeNode = { kind: 'group'; node: GroupNode } | { kind: 'place'; item: PlaceItem }

// Nests the places under their groups. A group is drawn where the first place
// inside it comes, so the host's order is the tree's order.
export function buildPlaceTree(items: PlaceItem[]): TreeNode[] {
  const roots: TreeNode[] = []
  const nodes = new Map<string, GroupNode>()
  for (const item of items) {
    let level = roots
    for (const group of item.groups ?? []) {
      let node = nodes.get(group.id)
      if (!node) {
        node = { group, children: [] }
        nodes.set(group.id, node)
        level.push({ kind: 'group', node })
      }
      level = node.children
    }
    level.push({ kind: 'place', item })
  }
  return roots
}

// Whether a place stays under a filter: its name, or the name of a group
// above it, contains `query` (lower-cased already).
export function placeMatches(item: PlaceItem, query: string): boolean {
  const names = [item.name, ...(item.groups ?? []).map((group) => group.name)]
  return names.some((name) => name.toLowerCase().includes(query))
}

function readRemembered(key: string | undefined): Record<string, boolean> {
  if (!key || typeof window === 'undefined') return {}
  try {
    const stored = JSON.parse(window.localStorage.getItem(key) ?? '{}')
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
  } catch {
    return {}
  }
}

function remember(key: string | undefined, open: Record<string, boolean>): void {
  if (!key || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(open))
  } catch {
    // Storage full or refused (a private window): the state lasts until reload.
  }
}

interface SidebarSectionProps {
  section: PlaceSection
  activePlaceId?: string
  onPlaceActivate?: (id: string) => void
}

function SidebarSection({ section, activePlaceId, onPlaceActivate }: SidebarSectionProps) {
  const { items, rememberOpenAs } = section
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(() => readRemembered(rememberOpenAs))
  const filter = query.trim().toLowerCase()
  const shown = useMemo(() => (filter ? items.filter((item) => placeMatches(item, filter)) : items), [items, filter])
  const tree = useMemo(() => buildPlaceTree(shown), [shown])

  const isOpen = (group: PlaceGroup) => open[group.id] ?? group.defaultOpen ?? true
  const setGroupOpen = (changes: Record<string, boolean>) => {
    setOpen((current) => {
      const next = { ...current, ...changes }
      remember(rememberOpenAs, next)
      return next
    })
  }

  // The active place is opened into view: its groups open when it becomes the
  // active one (a click, a link, the place the page opened on), and stay as
  // the person leaves them after that. Keyed on the groups' ids, so a place
  // that arrives after it was made active is opened too. The ref hands the
  // effect this render's state without making every render a reason to run it.
  const activeGroups = items.find((item) => item.id === activePlaceId)?.groups ?? []
  const activeGroupIds = activeGroups.map((group) => group.id).join('\n')
  const latest = useRef({ activeGroups, isOpen, setGroupOpen })
  latest.current = { activeGroups, isOpen, setGroupOpen }
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the active place's groups change; everything else it reads comes through the ref
  useEffect(() => {
    if (!activeGroupIds) return
    const current = latest.current
    const closed = current.activeGroups.filter((group) => !current.isOpen(group))
    if (closed.length) current.setGroupOpen(Object.fromEntries(closed.map((group) => [group.id, true])))
  }, [activeGroupIds])

  const renderNodes = (nodes: TreeNode[]): ReactNode =>
    nodes.map((entry) =>
      entry.kind === 'place' ? (
        <PlaceRow
          key={entry.item.id}
          item={entry.item}
          active={entry.item.id === activePlaceId}
          onActivate={onPlaceActivate}
        />
      ) : (
        <GroupRow
          key={entry.node.group.id}
          node={entry.node}
          open={filter !== '' || isOpen(entry.node.group)}
          onToggle={() => setGroupOpen({ [entry.node.group.id]: !isOpen(entry.node.group) })}
        >
          {renderNodes(entry.node.children)}
        </GroupRow>
      ),
    )

  return (
    <div className='flex flex-col gap-0.5'>
      {section.label ? (
        <span className='px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
          {section.label}
        </span>
      ) : null}
      {section.filterPlaceholder !== undefined ? (
        <Input
          type='search'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={section.filterPlaceholder}
          aria-label={section.filterPlaceholder}
          className='mb-1 h-7 text-xs'
        />
      ) : null}
      {renderNodes(tree)}
      {filter && shown.length === 0 ? (
        <span className='px-2 py-1.5 text-xs text-muted-foreground'>Nothing matches “{query.trim()}”</span>
      ) : null}
    </div>
  )
}

interface GroupRowProps {
  node: GroupNode
  open: boolean
  onToggle: () => void
  children: ReactNode
}

function GroupRow({ node, open, onToggle, children }: GroupRowProps) {
  const { group } = node
  return (
    <div className='flex flex-col gap-0.5'>
      <button
        type='button'
        aria-expanded={open}
        onClick={onToggle}
        title={group.name}
        className='flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-1.5 text-left text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'
      >
        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden />
        {group.label !== undefined ? (
          <span className='flex min-w-0 flex-1 items-center gap-2'>{group.label}</span>
        ) : (
          <>
            {group.icon ? (
              <span className='shrink-0' aria-hidden>
                {group.icon}
              </span>
            ) : null}
            <span className='min-w-0 flex-1 truncate font-medium'>{group.name}</span>
          </>
        )}
      </button>
      {open ? <div className='ml-3 flex flex-col gap-0.5 border-l pl-1'>{children}</div> : null}
    </div>
  )
}

interface PlaceRowProps {
  item: PlaceItem
  active: boolean
  onActivate?: (id: string) => void
}

function PlaceRow({ item, active, onActivate }: PlaceRowProps) {
  const unreachable = item.unreachable !== undefined
  const detail = unreachable ? item.unreachable : item.detail
  const place = (
    <button
      type='button'
      disabled={unreachable}
      onClick={() => onActivate?.(item.id)}
      {...(unreachable ? {} : middleClickOpens(item.href))}
      title={unreachable ? `${item.name}: ${item.unreachable}` : item.name}
      className='flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60'
    >
      {item.label !== undefined ? (
        <span className='flex min-w-0 flex-1 flex-col'>
          <span className='flex min-w-0 items-center gap-2'>{item.label}</span>
          {unreachable ? <span className='truncate font-normal text-muted-foreground'>{item.unreachable}</span> : null}
        </span>
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
    <ContextMenu>
      <ContextMenuTrigger render={row} />
      <ContextMenuContent className='min-w-[10rem]'>{item.menu}</ContextMenuContent>
    </ContextMenu>
  )
}
