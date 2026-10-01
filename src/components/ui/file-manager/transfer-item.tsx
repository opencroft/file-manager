import { Check, Download, Loader2, RefreshCw, Upload, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from 'cn'

export type TransferDirection = 'upload' | 'download'
export type TransferState = 'active' | 'complete' | 'error'

// One in-flight file transfer. `progress` is 0..100 (omit it for an
// indeterminate active transfer). `size` and `speed` arrive host-formatted
// (human units) -- the component does no formatting itself.
export interface TransferItemData {
  id: string
  name: string
  direction: TransferDirection
  progress?: number
  size?: string
  speed?: string
  state?: TransferState
  error?: string
}

interface TransferItemProps {
  transfer: TransferItemData
  onCancel?: (id: string) => void
  onRetry?: (id: string) => void
  className?: string
}

const DirectionIcon = { upload: Upload, download: Download } as const

// A single transfer row: a direction icon, the name with size/speed (or an
// error message), a progress bar, and a trailing action -- cancel while
// active, retry when failed, a check when done. Visual only.
export function TransferItem({ transfer, onCancel, onRetry, className }: TransferItemProps) {
  const state: TransferState = transfer.error ? 'error' : transfer.state ?? 'active'
  const Icon = DirectionIcon[transfer.direction]
  const hasProgress = typeof transfer.progress === 'number'
  const pct = hasProgress ? Math.max(0, Math.min(100, transfer.progress as number)) : 0

  // Bar fill: green when done, red when failed, indeterminate pulse when no
  // progress value is known, else the live percentage.
  const bar = state === 'error' ? (
    <div className='h-1.5 w-full rounded-full bg-destructive/30' />
  ) : state === 'complete' ? (
    <div className='h-1.5 w-full rounded-full bg-emerald-500' />
  ) : hasProgress ? (
    <div className='h-1.5 w-full rounded-full bg-muted'>
      <div className='h-full rounded-full bg-primary transition-all duration-300' style={{ width: `${pct}%` }} />
    </div>
  ) : (
    <div className='h-1.5 w-full animate-pulse rounded-full bg-muted-foreground/30' />
  )

  const action = state === 'error' ? (
    onRetry ? (
      <Button variant='ghost' size='sm' aria-label='Retry' className='h-6 w-6 shrink-0 p-0' onClick={() => onRetry(transfer.id)}>
        <RefreshCw className='size-3.5' />
      </Button>
    ) : null
  ) : state === 'complete' ? (
    <Check className='size-4 shrink-0 text-emerald-500' aria-label='Completed' />
  ) : onCancel ? (
    <Button variant='ghost' size='sm' aria-label='Cancel' className='h-6 w-6 shrink-0 p-0' onClick={() => onCancel(transfer.id)}>
      <X className='size-3.5' />
    </Button>
  ) : state === 'active' ? (
    <Loader2 className='size-4 shrink-0 animate-spin text-muted-foreground' aria-hidden />
  ) : null

  return (
    <div className={cn('flex w-full min-w-0 items-center gap-2 px-2 py-1.5', className)}>
      <div
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-md bg-muted',
          transfer.direction === 'upload' ? 'text-blue-500' : 'text-emerald-500',
        )}
        aria-hidden
      >
        <Icon className='size-3.5' />
      </div>

      <div className='flex min-w-0 flex-1 flex-col gap-1'>
        <div className='flex min-w-0 items-center gap-2'>
          <span className='min-w-0 flex-1 truncate text-xs font-medium text-foreground'>{transfer.name}</span>
          {state === 'error' ? (
            <span className='shrink-0 truncate text-xs text-destructive'>{transfer.error ?? 'Failed'}</span>
          ) : transfer.speed ? (
            <span className='shrink-0 text-xs text-muted-foreground'>{transfer.speed}</span>
          ) : null}
        </div>

        <div className='flex items-center gap-2'>
          <div className='min-w-0 flex-1'>{bar}</div>
          {state !== 'error' && transfer.size ? (
            <span className='shrink-0 text-xs text-muted-foreground'>{transfer.size}</span>
          ) : null}
        </div>
      </div>

      {action}
    </div>
  )
}
