import { PassThrough, Readable } from 'node:stream'

import { Client, FileType } from 'basic-ftp'

import type { FileEntry, ListResult, Provider, ReadStreamResult, ResolvedFtpConfig } from '../types'
import { alreadyExists } from './create'

async function connect(config: ResolvedFtpConfig): Promise<Client> {
  const client = new Client()
  await client.access({
    host: config.host,
    port: config.port || 21,
    user: config.user,
    password: config.password,
    secure: config.secure ?? false,
  })
  return client
}

async function withClient<T>(config: ResolvedFtpConfig, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await connect(config)
  try {
    return await fn(client)
  } finally {
    client.close()
  }
}

function join(dir: string, name: string): string {
  return dir.endsWith('/') ? dir + name : `${dir}/${name}`
}

export function ftpProvider(config: ResolvedFtpConfig): Provider {
  return {
    async list(path): Promise<ListResult> {
      const dir = path || '/'
      const entries = await withClient(config, async (client) => {
        const list = await client.list(dir)
        return list.map((item): FileEntry => {
          const isDir = item.type === FileType.Directory
          const full = join(dir, item.name)
          return {
            name: item.name,
            path: isDir ? `${full}/` : full,
            type: isDir ? 'directory' : 'file',
            size: isDir ? 0 : item.size,
            modified: item.modifiedAt ? item.modifiedAt.toISOString() : '',
          }
        })
      })
      return { entries }
    },

    async readStream(path): Promise<ReadStreamResult> {
      // basic-ftp streams into a Writable, not out of a Readable — bridge with a
      // PassThrough so the caller can pipe it out (e.g. into an HTTP Response)
      // while the download is still in flight.
      const client = await connect(config)
      const size = await client.size(path).catch(() => undefined)
      const pass = new PassThrough()
      client
        .downloadTo(pass, path)
        .catch((err) => pass.emit('error', err))
        .finally(() => client.close())
      return { stream: pass, size }
    },

    async writeStream(path, filename, stream): Promise<void> {
      const full = join(path || '/', filename)
      await withClient(config, (client) => client.uploadFrom(stream as Readable, full))
    },

    async delete(path): Promise<void> {
      // Matches the S3 provider's convention: a trailing slash means "directory,
      // delete recursively" (the caller's listing already reports paths this way).
      await withClient(config, async (client) => {
        if (path.endsWith('/')) {
          await client.removeDir(path)
        } else {
          await client.remove(path)
        }
      })
    },

    async rename(oldPath, newPath): Promise<void> {
      await withClient(config, (client) => client.rename(oldPath, newPath))
    },

    async mkdir(path): Promise<void> {
      await withClient(config, async (client) => {
        await refuseExisting(client, path)
        // One MKD, not ensureDir: a folder is created in its existing parent
        // only, as Provider.mkdir says.
        await client.send(`MKD ${path.replace(/\/+$/, '')}`)
      })
    },

    async createFile(path): Promise<void> {
      await withClient(config, async (client) => {
        await refuseExisting(client, path)
        await client.uploadFrom(Readable.from([]), path)
      })
    },
  }
}

// FTP has no create-if-absent for a file (STOR replaces), so a create looks in
// the parent first. A create racing another to the same name between the look
// and the write can still land second.
async function refuseExisting(client: Client, path: string): Promise<void> {
  const clean = path.replace(/\/+$/, '')
  const slash = clean.lastIndexOf('/')
  const parent = slash > 0 ? clean.slice(0, slash) : '/'
  const name = clean.slice(slash + 1)
  if ((await client.list(parent)).some((item) => item.name === name)) {
    throw alreadyExists(path)
  }
}
