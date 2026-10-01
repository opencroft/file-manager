import host from '@ext/host'
import { Client } from 'ssh2'

import type { TerminalContext } from '../types'

export function normalizePath(path: string): string {
  return path.startsWith('/') ? path : '/' + path
}

export function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') ? dir + name : dir + '/' + name
}

/** Quote one argument for a POSIX shell — safe against embedded spaces, quotes, and glob chars. */
export function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

export async function connectSsh(ctx: TerminalContext): Promise<Client> {
  const privateKey = ctx.keyPath ? await host.ssh.resolveKey(ctx.keyPath) : undefined
  return new Promise((resolve, reject) => {
    const client = new Client()
    client.on('ready', () => resolve(client))
    client.on('error', reject)
    client.connect({
      host: ctx.host,
      port: ctx.port || 22,
      username: ctx.username || 'root',
      password: ctx.password || undefined,
      privateKey,
      readyTimeout: 10_000,
    })
  })
}
