import { Button, ControlledInput, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Label } from '@ext/ui'
import { React } from '@ext/host'

const { useEffect, useState } = React

/** Set/clear a source's rootPath — reuses ConnectionDialog's dialog primitives
 *  rather than inventing new chrome. Works for both connection and terminal
 *  sources; the caller only needs to pass the ref + display name + current value. */
export function RootPathDialog({
  open,
  onOpenChange,
  sourceName,
  initialRootPath,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceName: string
  initialRootPath?: string
  onSave: (rootPath: string) => Promise<void>
}) {
  const [value, setValue] = useState(initialRootPath ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setValue(initialRootPath ?? '')
    }
  }, [open, initialRootPath])

  const save = async () => {
    setSaving(true)
    try {
      await onSave(value)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Root path — {sourceName}</DialogTitle>
        </DialogHeader>

        <div className='flex flex-col gap-1.5'>
          <Label className='text-xs'>Path</Label>
          <ControlledInput
            value={value}
            onValueChanged={setValue}
            placeholder='/ (no scoping)'
            className='h-8 text-sm font-mono'
          />
          <Label className='text-[10px] text-muted-foreground italic'>
            Scopes browsing to this path — it becomes the breadcrumb root. Clear the field to remove scoping.
          </Label>
        </div>

        <DialogFooter>
          <Button variant='outline' size='sm' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size='sm' onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
