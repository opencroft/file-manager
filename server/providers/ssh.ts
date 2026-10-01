import type { Readable } from 'node:stream'

import type { Client, SFTPWrapper } from 'ssh2'

import { connectSsh, joinPath as join, normalizePath as normalize, shellQuote } from './shared'
import type { FileEntry, ListResult, Provider, ReadStreamResult, TerminalContext } from '../types'

function openSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)))
  })
}

async function withClient<T>(ctx: TerminalContext, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await connectSsh(ctx)
  try {
    return await fn(client)
  } finally {
    client.end()
  }
}

async function withSftp<T>(ctx: TerminalContext, fn: (sftp: SFTPWrapper, client: Client) => Promise<T>): Promise<T> {
  return withClient(ctx, async (client) => fn(await openSftp(client), client))
}

function execOnClient(client: Client, command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, channel) => {
      if (err) {
        reject(err)
        return
      }
      let stderr = ''
      channel.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
      channel.on('close', (code: number) => (code === 0 ? resolve() : reject(new Error(stderr || `exited with code ${code}`))))
    })
  })
}

export function sshProvider(ctx: TerminalContext): Provider {
  return {
    async list(path): Promise<ListResult> {
      const dir = normalize(path)
      const entries = await withSftp(ctx, (sftp) => {
        return new Promise<FileEntry[]>((resolve, reject) => {
          sftp.readdir(dir, (err, list) => {
            if (err) {
              reject(err)
              return
            }
            resolve(
              list
                .filter((item) => item.filename !== '.' && item.filename !== '..')
                .map((item) => {
                  const isDir = item.attrs.isDirectory()
                  const full = join(dir, item.filename)
                  return {
                    name: item.filename,
                    path: isDir ? full + '/' : full,
                    type: isDir ? ('directory' as const) : ('file' as const),
                    size: item.attrs.size,
                    modified: new Date(item.attrs.mtime * 1000).toISOString(),
                  }
                }),
            )
          })
        })
      })
      return { entries }
    },

    async readStream(path): Promise<ReadStreamResult> {
      const full = normalize(path)
      const client = await connectSsh(ctx)
      const sftp = await openSftp(client)
      const stat = await new Promise<{ size: number }>((resolve, reject) => {
        sftp.stat(full, (err, stats) => (err ? reject(err) : resolve({ size: stats.size })))
      })
      const stream: Readable = sftp.createReadStream(full)
      stream.on('close', () => client.end())
      stream.on('error', () => client.end())
      return { stream, size: stat.size }
    },

    async writeStream(path, filename, stream): Promise<void> {
      const full = join(normalize(path), filename)
      await withClient(ctx, async (client) => {
        const sftp = await openSftp(client)
        await new Promise<void>((resolve, reject) => {
          const ws = sftp.createWriteStream(full)
          ws.on('close', () => resolve())
          ws.on('error', reject)
          stream.on('error', reject)
          stream.pipe(ws)
        })
      })
    },

    async delete(path): Promise<void> {
      await withClient(ctx, (client) => execOnClient(client, `rm -rf ${shellQuote(normalize(path))}`))
    },

    async rename(oldPath, newPath): Promise<void> {
      await withSftp(ctx, (sftp) => {
        return new Promise<void>((resolve, reject) => {
          sftp.rename(normalize(oldPath), normalize(newPath), (err) => (err ? reject(err) : resolve()))
        })
      })
    },

    async mkdir(path): Promise<void> {
      // sftp.mkdir doesn't create parents — use `mkdir -p` over exec for the same
      // recursive semantics every other backend has.
      await withClient(ctx, (client) => execOnClient(client, `mkdir -p ${shellQuote(normalize(path))}`))
    },
  }
}
