import { secrets } from '@opencroft/server/secrets'
import { ssh } from '@opencroft/server/terminal'
import { Client } from 'ssh2'

import type { TerminalContext } from '../types'

export { joinPath, normalizePath } from './paths'

// The node the context names as `credentialsScope` (the Server it comes from) scopes its
// credentials: a `secret:NAME` password resolves from the Secrets Stores on that node's graph, and a
// `<storeId>:<name>` key only from a Key Store there. A context naming none resolves neither.
function credentialsScopeOf(ctx: TerminalContext): { nodeId: string } {
  return { nodeId: typeof ctx.credentialsScope === 'string' ? ctx.credentialsScope : '' }
}

function resolvePassword(ctx: TerminalContext): Promise<string> | undefined {
  if (!ctx.password) {
    return undefined
  }
  return secrets.resolveValue(ctx.password, credentialsScopeOf(ctx))
}

export async function connectSsh(ctx: TerminalContext): Promise<Client> {
  const privateKey = ctx.keyPath ? await ssh.resolveKey(ctx.keyPath, credentialsScopeOf(ctx)) : undefined
  const password = await resolvePassword(ctx)
  return new Promise((resolve, reject) => {
    const client = new Client()
    client.on('ready', () => resolve(client))
    client.on('error', reject)
    client.connect({
      host: ctx.host,
      port: ctx.port || 22,
      username: ctx.username || 'root',
      password: password || undefined,
      privateKey,
      readyTimeout: 10_000,
    })
  })
}
