import { SecretValueField } from '@opencroft/client/secrets'
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
} from '@opencroft/client/ui'
import { useEffect, useState } from 'react'

import type { FtpConnectionConfig, ProtocolConnection, S3ConnectionConfig } from './types'

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
  spaceSlug,
  open,
  onOpenChange,
  connection,
  onSave,
}: {
  /** The space the connection belongs to: its credentials are picked from, and resolve in, its Secrets Stores. */
  spaceSlug: string
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
            <ControlledInput
              value={draft.name}
              onValueChanged={(v: string) => setDraft({ ...draft, name: v })}
              className='h-8 text-sm'
            />
          </div>

          <div className='flex flex-col gap-1.5'>
            <Label className='text-xs'>Type</Label>
            <Select
              items={CONNECTION_TYPE_LABELS}
              value={draft.type}
              onValueChange={(v: string | null) => {
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
                <ControlledInput
                  value={s3.endpoint ?? ''}
                  onValueChanged={(v: string) => updateConfig({ endpoint: v })}
                  placeholder='https://s3.example.com'
                  className='h-8 text-sm font-mono'
                />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label className='text-xs'>Region</Label>
                <ControlledInput
                  value={s3.region ?? ''}
                  onValueChanged={(v: string) => updateConfig({ region: v })}
                  placeholder='us-east-1'
                  className='h-8 text-sm font-mono'
                />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label className='text-xs'>Bucket</Label>
                <ControlledInput
                  value={s3.bucket}
                  onValueChanged={(v: string) => updateConfig({ bucket: v })}
                  className='h-8 text-sm font-mono'
                />
              </div>
              <SecretValueField
                label='Access key id'
                value={s3.accessKeyId}
                onChange={(v) => updateConfig({ accessKeyId: v })}
                spaceSlug={spaceSlug}
              />
              <SecretValueField
                label='Secret access key'
                value={s3.secretAccessKey}
                onChange={(v) => updateConfig({ secretAccessKey: v })}
                spaceSlug={spaceSlug}
              />
            </>
          ) : null}

          {ftp ? (
            <>
              <div className='flex flex-col gap-1.5'>
                <Label className='text-xs'>Host</Label>
                <ControlledInput
                  value={ftp.host}
                  onValueChanged={(v: string) => updateConfig({ host: v })}
                  className='h-8 text-sm font-mono'
                />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label className='text-xs'>Port</Label>
                <ControlledInput
                  value={String(ftp.port ?? 21)}
                  onValueChanged={(v: string) => updateConfig({ port: Number(v) || 21 })}
                  className='h-8 text-sm font-mono'
                />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label className='text-xs'>User</Label>
                <ControlledInput
                  value={ftp.user}
                  onValueChanged={(v: string) => updateConfig({ user: v })}
                  className='h-8 text-sm font-mono'
                />
              </div>
              <SecretValueField
                label='Password'
                value={ftp.password}
                onChange={(v) => updateConfig({ password: v })}
                spaceSlug={spaceSlug}
              />
            </>
          ) : null}
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
