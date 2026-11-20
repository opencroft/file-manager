import { Loader2, X } from 'lucide-react'
import { type ComponentProps, type ReactNode, useEffect, useRef } from 'react'

import { Button } from '../button'
import { ScrollArea } from '@/components/ui/layout/scroll-area'
import { cn } from 'cn'

export interface BulkActionBarProps {
  /** How many items are picked. The bar shows while there is at least one, or `above` holds something. */
  count: number
  /** Clears the selection: the bar's close button, and Esc. */
  onClear: () => void
  /** What the count reads; "N selected" unless given (e.g. "Updating 3…" while an action runs). */
  status?: ReactNode
  /** The toolbar's name for assistive tech; "Actions for N selected" unless given. */
  label?: string
  /** The actions, in a row that scrolls sideways when the bar is narrower than they are. */
  children?: ReactNode
  /** Actions after the scrolling row, always in view: a destructive one, a ⋮ menu. */
  end?: ReactNode
  /** A strip above the bar, such as how the last action went. */
  above?: ReactNode
  className?: string
}

/** Esc inside a menu, a dialog or a field belongs to that; anywhere else it clears the selection. */
function escapeIsOurs(event: KeyboardEvent): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented) {
    return false
  }
  const target = event.target instanceof HTMLElement ? event.target : null
  if (!target) {
    return true
  }
  if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
    return false
  }
  return !target.closest('[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"], [data-slot="popover-content"]')
}

export interface BulkActionBarButtonProps extends Omit<ComponentProps<typeof Button>, 'children'> {
  icon: ReactNode
  /** The action's name: its accessible name and tooltip, shown beside the icon when the bar is wide. */
  label: string
  /** The action is running: a spinner in place of the icon. */
  busy?: boolean
  destructive?: boolean
  /** Something after the label, such as a chevron for a menu; shown with the label. */
  trailing?: ReactNode
}

/**
 * One action of the bar: an icon, and its name beside it once the bar is
 * 36rem wide (`@xl`). Under a coarse pointer it is a 44px target. It takes
 * every button prop, so it also serves as a menu's trigger.
 */
export function BulkActionBarButton({ icon, label, busy = false, destructive = false, trailing, className, ...props }: BulkActionBarButtonProps) {
  return (
    <Button
      variant='ghost'
      size='sm'
      aria-label={label}
      title={label}
      className={cn(
        'shrink-0 px-2 pointer-coarse:h-11 pointer-coarse:min-w-11',
        destructive && 'text-destructive hover:bg-destructive/10 hover:text-destructive',
        className,
      )}
      {...props}
    >
      {busy ? <Loader2 className='animate-spin' /> : icon}
      <span className='hidden @xl:inline'>{label}</span>
      {trailing ? <span className='hidden @xl:inline-flex'>{trailing}</span> : null}
    </Button>
  )
}

/**
 * The bar shown while items are picked: a close button, the count, then the
 * actions for all of them. Domain bars compose it with their own actions. It
 * holds no selection: the host keeps it, runs the actions and places the bar,
 * usually floating at the bottom of the page or under a list. Esc clears the
 * selection unless a menu, a dialog or a field has it.
 */
export function BulkActionBar({ count, onClear, status, label, children, end, above, className }: BulkActionBarProps) {
  const clear = useRef(onClear)
  clear.current = onClear

  useEffect(() => {
    if (count === 0) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (escapeIsOurs(event)) {
        clear.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [count])

  if (count === 0 && !above) {
    return null
  }

  return (
    <div data-slot='bulk-action-bar' className={cn('@container flex w-full min-w-0 flex-col gap-2', className)}>
      {above}
      {count > 0 ? (
        <div
          role='toolbar'
          aria-label={label ?? `Actions for ${count} selected`}
          className='flex h-12 min-w-0 items-center gap-1 rounded-xl border bg-popover px-1.5 text-popover-foreground shadow-lg pointer-coarse:h-14'
        >
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label='Clear the selection'
            title='Clear the selection (Esc)'
            className='pointer-coarse:size-11'
            onClick={onClear}
          >
            <X />
          </Button>
          <span className='shrink-0 px-1 text-sm font-medium whitespace-nowrap tabular-nums' aria-live='polite'>
            {status ?? `${count} selected`}
          </span>
          <div aria-hidden='true' className='mx-1 h-5 w-px shrink-0 bg-border' />
          <ScrollArea scrollbars='horizontal' className='min-w-0 flex-1' innerClassName='flex-row items-center gap-0.5'>
            {children}
          </ScrollArea>
          {end}
        </div>
      ) : null}
    </div>
  )
}
