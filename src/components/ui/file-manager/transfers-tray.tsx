'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { TransferItem, type TransferItemData } from '@/components/ui/file-manager/transfer-item'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from 'cn'

interface TransfersTrayProps {
  transfers: TransferItemData[]
  // Collapsed summary text. Host-formatted aggregate (counts + total speed);
  // defaults to a derived count ("3 active · 1 failed") when omitted.
  summary?: string
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  onCancelTransfer?: (id: string) => void
  onRetryTransfer?: (id: string) => void
  className?: string
}

// The transfers tray: a collapsed summary bar (a clickable header with a count
// badge) that expands to a scrollable list of transfer-items. Visual only -- it
// owns just the expand/collapse state and forwards cancel/retry.
export function TransfersTray({
  transfers,
  summary,
  expanded,
  onExpandedChange,
  onCancelTransfer,
  onRetryTransfer,
  className,
}: TransfersTrayProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = expanded ?? internalOpen
  const setOpen = (next: boolean) => {
    if (expanded === undefined) setInternalOpen(next)
    onExpandedChange?.(next)
  }

  const active = transfers.filter((t) => !t.error && (t.state ?? 'active') === 'active').length
  const failed = transfers.filter((t) => Boolean(t.error) || t.state === 'error').length
  const summaryLabel = summary ?? `${active} active${failed ? ` · ${failed} failed` : ''}`

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn('border-t bg-card', className)}>
      <CollapsibleTrigger
        render={<Button variant='ghost' className='h-9 w-full justify-between rounded-none px-2 text-xs font-medium' />}
      >
        <span className='flex min-w-0 items-center gap-1.5'>
          <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
          <span className='truncate'>{summaryLabel}</span>
        </span>
        <Badge variant='secondary' className='shrink-0 tabular-nums'>{transfers.length}</Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className='max-h-48 divide-y divide-border overflow-auto border-t'>
          {transfers.map((t) => (
            <TransferItem key={t.id} transfer={t} onCancel={onCancelTransfer} onRetry={onRetryTransfer} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
