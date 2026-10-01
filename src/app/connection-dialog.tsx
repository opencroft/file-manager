import {
  Button,
  ControlledInput,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Flex,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ext/ui'
import { React } from '@ext/host'

import type { FtpConnectionConfig, ProtocolConnection, S3ConnectionConfig } from './types'

const { useEffect, useState } = React

function emptyS3(): S3ConnectionConfig {
  return { endpoint: '', region: '', bucket: '', accessKeyId: '', secretAccessKey: '' }
}

function emptyFtp(): FtpConnectionConfig {
  return { host: '', port: 21, user: '', password: '', secure: false }
}

// Base UI's SelectValue shows the raw value unless the root knows the labels.
const CONNECTION_TYPE_LABELS: Record<ProtocolConnection['type'], string> = { s3: 'S3', ftp: 'FTP' }

export type ConnectionDraft = Omit<ProtocolConnection, 'id'>

function draftFrom(connection?: ProtocolConnection): ConnectionDraft {
  if (connection) {
    return { name: connection.name, type: connection.type, config: connection.config }
  }
  return { name: 'New S3 connection', type: 's3', config: emptyS3() }
}

export function ConnectionDialog({
  open,
  onOpenChange,
  connection,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  connection?: ProtocolConnection
  onSave: (draft: ConnectionDraft) => Promise<void>
}) {
  const [draft, setDraft] = useState<ConnectionDraft>(() => draftFrom(connection))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setDraft(draftFrom(connection))
    }
  }, [open, connection])

  const setType = (type: 's3' | 'ftp') => {
    setDraft({ name: draft.name, type, config: type === 's3' ? emptyS3() : emptyFtp() })
  }

  const updateConfig = (patch: Partial<S3ConnectionConfig & FtpConnectionConfig>) => {
    setDraft({ ...draft, config: { ...draft.config, ...patch } })
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSave(draft)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  const s3 = draft.type === 's3' ? (draft.config as S3ConnectionConfig) : undefined
  const ftp = draft.type === 'ftp' ? (draft.config as FtpConnectionConfig) : undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{connection ? 'Edit connection' : 'Add connection'}</DialogTitle>
        </DialogHeader>

        <div className='flex flex-col gap-3'>
          <div className='flex flex-col gap-1.5'>
            <Label className='text-xs'>Name</Label>
            <ControlledInput value={draft.name} onValueChanged={(v) => setDraft({ ...draft, name: v })} className='h-8 text-sm' />
          </div>

          <div className='flex flex-col gap-1.5'>
            <Label className='text-xs'>Type</Label>
            <Select
              items={CONNECTION_TYPE_LABELS}
              value={draft.type}
              onValueChange={(v) => {
                if (v !== null) {
                  setType(v as 's3' | 'ftp')
                }
              }}
              disabled={Boolean(connection)}
            >
              <SelectTrigger className='h-8 text-sm w-32'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='s3'>S3</SelectItem>
                <SelectItem value='ftp'>FTP</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {s3 ? (
            <>
              <div className='flex flex-col gap-1.5'>
                <Label className='text-xs'>Endpoint (optional)</Label>
                <ControlledInput value={s3.endpoint ?? ''} onValueChanged={(v) => updateConfig({ endpoint: v })} placeholder='https://s3.example.com' className='h-8 text-sm font-mono' />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label className='text-xs'>Region</Label>
                <ControlledInput value={s3.region ?? ''} onValueChanged={(v) => updateConfig({ region: v })} placeholder='us-east-1' className='h-8 text-sm font-mono' />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label className='text-xs'>Bucket</Label>
                <ControlledInput value={s3.bucket} onValueChanged={(v) => updateConfig({ bucket: v })} className='h-8 text-sm font-mono' />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label className='text-xs'>Access key id</Label>
                <ControlledInput value={s3.accessKeyId} onValueChanged={(v) => updateConfig({ accessKeyId: v })} placeholder='or secret:NAME' className='h-8 text-sm font-mono' />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label className='text-xs'>Secret access key</Label>
                <ControlledInput value={s3.secretAccessKey} onValueChanged={(v) => updateConfig({ secretAccessKey: v })} placeholder='or secret:NAME' className='h-8 text-sm font-mono' />
              </div>
            </>
          ) : null}

          {ftp ? (
            <>
              <div className='flex flex-col gap-1.5'>
                <Label className='text-xs'>Host</Label>
                <ControlledInput value={ftp.host} onValueChanged={(v) => updateConfig({ host: v })} className='h-8 text-sm font-mono' />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label className='text-xs'>Port</Label>
                <ControlledInput
                  value={String(ftp.port ?? 21)}
                  onValueChanged={(v) => updateConfig({ port: Number(v) || 21 })}
                  className='h-8 text-sm font-mono'
                />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label className='text-xs'>User</Label>
                <ControlledInput value={ftp.user} onValueChanged={(v) => updateConfig({ user: v })} className='h-8 text-sm font-mono' />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label className='text-xs'>Password</Label>
                <ControlledInput value={ftp.password} onValueChanged={(v) => updateConfig({ password: v })} placeholder='or secret:NAME' className='h-8 text-sm font-mono' />
              </div>
            </>
          ) : null}

          <Label className='text-[10px] text-muted-foreground italic'>
            Credential fields accept <code>secret:NAME</code> to resolve from the Secrets Store server-side.
          </Label>
        </div>

        <DialogFooter>
          <Flex row className='gap-2'>
            <Button variant='outline' size='sm' onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size='sm' onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </Flex>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
