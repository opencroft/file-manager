'use client'

import { useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  FolderPlus,
  LayoutGrid,
  List,
  MoreHorizontal,
  RefreshCw,
  Search,
  Upload,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from 'cn'

export interface Crumb {
  id: string
  name: string
  // Rendered in place of `name` when given (e.g. a place's own label for the
  // root segment); `name` stays the plain-text form.
  label?: ReactNode
  // A page of its own for this location, opened in a new tab on a middle-click.
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

interface FileToolbarProps {
  // Breadcrumb path segments, root-first; the last segment is the current folder.
  path: Crumb[]
  onNavigate?: (crumb: Crumb) => void
  // Optional leading slot rendered first (e.g. the mobile sidebar toggle).
  leading?: ReactNode
  // Navigation controls. Each renders only when its callback is wired; the
  // `can*` flag disables it (e.g. can't go back / up at the root).
  onBack?: () => void
  canBack?: boolean
  onForward?: () => void
  canForward?: boolean
  onUp?: () => void
  canUp?: boolean
  onRefresh?: () => void
  // Search lives IN the address bar: a toggle on its right swaps the
  // breadcrumb for an in-place search field.
  searchValue?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
  view?: 'list' | 'grid'
  onViewChange?: (view: 'list' | 'grid') => void
  showViewToggle?: boolean
  onNewFolder?: () => void
  onUpload?: () => void
  className?: string
}

// The file browser toolbar. Leading slot, then a nav cluster (Back / Forward /
// Up / Refresh), then the address bar — a single bordered field that shows the
// breadcrumb (which dynamically collapses leading segments under a “…” dropdown
// until they fit) and a search toggle on its right that swaps the breadcrumb for
// an in-place search field. Trailing: list/grid toggle, New folder, Upload
// (inline on desktop, collapsed into a “more” menu on narrow widths). Visual
// only.
export function FileToolbar({
  path,
  onNavigate,
  leading,
  onBack,
  canBack = true,
  onForward,
  canForward = true,
  onUp,
  canUp = true,
  onRefresh,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search',
  view = 'list',
  onViewChange,
  showViewToggle = false,
  onNewFolder,
  onUpload,
  className,
}: FileToolbarProps) {
  const hasNav = Boolean(onBack || onForward || onUp || onRefresh)
  const hasActions = Boolean(showViewToggle || onNewFolder || onUpload)
  const [searchOpen, setSearchOpen] = useState(false)

  // --- breadcrumb dynamic overflow: hide leading segments under “…” until fit ---
  const addressRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [hiddenCount, setHiddenCount] = useState(0)

  useLayoutEffect(() => {
    const address = addressRef.current
    const measure = measureRef.current
    if (!address || !measure) return
    const compute = () => {
      const avail = address.clientWidth
      const widths = Array.from(measure.children).map((el) => (el as HTMLElement).offsetWidth)
      const n = widths.length
      if (!n) {
        setHiddenCount(0)
        return
      }
      const totalAll = widths.reduce((sum, w) => sum + w, 0)
      if (totalAll <= avail) {
        setHiddenCount(0)
        return
      }
      const budget = avail - 32 // reserve the “…” button
      let total = 0
      let shown = 0
      for (let i = n - 1; i >= 0; i--) {
        if (i < n - 1 && total + widths[i] > budget) break
        total += widths[i]
        shown++
      }
      shown = Math.max(1, shown)
      setHiddenCount(n - shown)
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(address)
    return () => ro.disconnect()
  }, [path, searchOpen])

  const hiddenCrumbs = path.slice(0, hiddenCount)
  const shownCrumbs = path.slice(hiddenCount)

  const renderCrumb = (c: Crumb, i: number, total: number) => {
    const last = i === total - 1
    return (
      <span key={c.id} className='flex min-w-0 shrink-0 items-center gap-0.5'>
        {i > 0 ? <ChevronRight className='size-3 shrink-0 text-muted-foreground' aria-hidden /> : null}
        <Button
          variant='ghost'
          size='sm'
          className={cn('h-6 min-w-0 px-1.5 text-xs font-normal', last ? 'text-foreground' : 'text-muted-foreground')}
          onClick={() => onNavigate?.(c)}
          {...middleClickOpens(c.href)}
        >
          <span className='truncate'>{c.label ?? c.name}</span>
        </Button>
      </span>
    )
  }

  const toggleSearch = () => {
    if (searchOpen) {
      onSearchChange?.('')
      setSearchOpen(false)
    } else {
      setSearchOpen(true)
    }
  }

  return (
    <div className={cn('flex items-center gap-1 border-b px-2 py-1', className)}>
      {leading ? <span className='shrink-0'>{leading}</span> : null}

      {/* navigation cluster — hidden on mobile while search is open */}
      {hasNav ? (
        <div className={cn('flex shrink-0 items-center gap-0.5', searchOpen && 'hidden sm:flex')}>
          {onBack ? (
            <Button variant='ghost' size='sm' aria-label='Back' disabled={!canBack} className='h-7 w-7 p-0' onClick={onBack}>
              <ArrowLeft className='size-4' aria-hidden />
            </Button>
          ) : null}
          {onForward ? (
            <Button variant='ghost' size='sm' aria-label='Forward' disabled={!canForward} className='h-7 w-7 p-0' onClick={onForward}>
              <ArrowRight className='size-4' aria-hidden />
            </Button>
          ) : null}
          {onUp ? (
            <Button variant='ghost' size='sm' aria-label='Up' disabled={!canUp} className='h-7 w-7 p-0' onClick={onUp}>
              <ArrowUp className='size-4' aria-hidden />
            </Button>
          ) : null}
          {onRefresh ? (
            <Button variant='ghost' size='sm' aria-label='Refresh' className='h-7 w-7 p-0' onClick={onRefresh}>
              <RefreshCw className='size-4' aria-hidden />
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* address / search bar (single field) */}
      <div className='flex min-w-0 flex-1 items-center'>
        <nav
          aria-label='Path'
          className='flex min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-md border bg-background px-2 py-1'
        >
          {searchOpen ? (
            <input
              autoFocus
              value={searchValue ?? ''}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder={searchPlaceholder}
              className='h-6 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground'
            />
          ) : (
            <div ref={addressRef} className='relative flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden'>
              {/* invisible measuring copy of the full path (each segment’s width) */}
              <div ref={measureRef} aria-hidden className='pointer-events-none absolute left-0 top-0 flex items-center gap-0.5 opacity-0'>
                {path.map((c, i) => renderCrumb(c, i, path.length))}
              </div>

              {hiddenCount > 0 ? (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<Button variant='ghost' size='sm' className='h-6 shrink-0 px-1.5 text-xs text-muted-foreground' aria-label='Hidden path segments' />}
                    >
                      …
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='start'>
                      {hiddenCrumbs.map((c) => (
                        <DropdownMenuItem key={c.id} onClick={() => onNavigate?.(c)} {...middleClickOpens(c.href)}>
                          {c.label ?? c.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {shownCrumbs.length > 0 ? <ChevronRight className='size-3 shrink-0 text-muted-foreground' aria-hidden /> : null}
                </>
              ) : null}

              {shownCrumbs.map((c, i) => renderCrumb(c, i, shownCrumbs.length))}
            </div>
          )}

          {/* search toggle (right side of the address bar) */}
          {onSearchChange ? (
            <Button
              variant='ghost'
              size='sm'
              aria-label={searchOpen ? 'Close search' : 'Search'}
              className='h-6 w-6 shrink-0 p-0'
              onClick={toggleSearch}
            >
              {searchOpen ? <X className='size-3.5' /> : <Search className='size-3.5' />}
            </Button>
          ) : null}
        </nav>
      </div>

      {/* trailing actions — hidden on mobile while search is open */}
      <div className={cn('flex shrink-0 items-center gap-1', searchOpen && 'hidden sm:flex')}>
        {showViewToggle ? (
          <div className='hidden items-center rounded-md border p-0.5 sm:flex'>
            <Button variant='ghost' size='sm' aria-label='Table view' className={cn('h-6 w-6 p-0', view === 'list' && 'bg-muted')} onClick={() => onViewChange?.('list')}>
              <List className='size-3.5' />
            </Button>
            <Button variant='ghost' size='sm' aria-label='Grid view' className={cn('h-6 w-6 p-0', view === 'grid' && 'bg-muted')} onClick={() => onViewChange?.('grid')}>
              <LayoutGrid className='size-3.5' />
            </Button>
          </div>
        ) : null}
        {onNewFolder ? (
          <Button variant='ghost' size='sm' aria-label='New folder' className='hidden h-7 w-7 p-0 sm:inline-flex' onClick={onNewFolder}>
            <FolderPlus className='size-4' />
          </Button>
        ) : null}
        {onUpload ? (
          <Button variant='default' size='sm' aria-label='Upload' className='hidden h-7 w-7 p-0 sm:inline-flex' onClick={onUpload}>
            <Upload className='size-4' />
          </Button>
        ) : null}

        {/* mobile overflow menu */}
        {hasActions ? (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant='ghost' size='sm' aria-label='More actions' className='h-7 w-7 p-0 sm:hidden' />}>
              <MoreHorizontal className='size-4' />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              {onNewFolder ? (
                <DropdownMenuItem onClick={onNewFolder}>
                  <FolderPlus className='size-3.5' /> New folder
                </DropdownMenuItem>
              ) : null}
              {onUpload ? (
                <DropdownMenuItem onClick={onUpload}>
                  <Upload className='size-3.5' /> Upload
                </DropdownMenuItem>
              ) : null}
              {showViewToggle ? (
                <>
                  <DropdownMenuItem onClick={() => onViewChange?.('list')}>
                    <List className='size-3.5' /> Table view
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onViewChange?.('grid')}>
                    <LayoutGrid className='size-3.5' /> Grid view
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  )
}
