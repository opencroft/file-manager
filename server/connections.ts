import host from '@ext/host'

import { getConnection, getSourceSettings } from './storage'
import type { FtpConnectionConfig, Provider, ResolvedFtpConfig, ResolvedS3Config, S3ConnectionConfig, Source } from './types'
import { getProvider } from './provider'

const SECRET_PREFIX = 'secret:'
const TERM_PREFIX = 'term:'
const CONN_PREFIX = 'conn:'

// A field value of "secret:NAME" resolves NAME from the Secrets Store server-side;
// anything else is used literally. Only the reference (never the resolved value) is
// ever part of connections storage, so it can't leak through the client or a graph read.
async function resolveField(value: string): Promise<string> {
  if (!value.startsWith(SECRET_PREFIX)) {
    return value
  }
  const name = value.slice(SECRET_PREFIX.length).trim()
  const resolved = name ? await host.secrets.resolve(name) : null
  if (resolved === null) {
    throw new Error(`Secret "${name}" not found in any Secrets Store`)
  }
  return resolved
}

async function resolveS3Config(config: S3ConnectionConfig): Promise<ResolvedS3Config> {
  return {
    ...config,
    accessKeyId: await resolveField(config.accessKeyId ?? ''),
    secretAccessKey: await resolveField(config.secretAccessKey ?? ''),
  }
}

async function resolveFtpConfig(config: FtpConnectionConfig): Promise<ResolvedFtpConfig> {
  return {
    ...config,
    password: await resolveField(config.password ?? ''),
  }
}

/**
 * Resolve a source reference into a concrete, secret-resolved `Source`.
 * `term:<nodeId>/<handleId>` — any terminal-context output handle, anywhere,
 * resolved via host.terminal.getContext (no edge required).
 * `conn:<id>` — an S3/FTP connection configured in `space`.
 */
export async function resolveSource(space: string, ref: string): Promise<Source> {
  if (ref.startsWith(TERM_PREFIX)) {
    const rest = ref.slice(TERM_PREFIX.length)
    const slash = rest.indexOf('/')
    if (slash < 0) {
      throw new Error(`Invalid terminal source reference: ${ref}`)
    }
    const nodeId = rest.slice(0, slash)
    const handleId = rest.slice(slash + 1)
    const ctx = await host.terminal.getContext(nodeId, handleId)
    return { kind: 'terminal', ctx }
  }

  if (ref.startsWith(CONN_PREFIX)) {
    const id = ref.slice(CONN_PREFIX.length)
    const connection = await getConnection(space, id)
    if (!connection) {
      throw new Error(`Unknown connection: ${id}`)
    }
    if (connection.type === 's3') {
      return { kind: 's3', config: await resolveS3Config(connection.config as S3ConnectionConfig) }
    }
    return { kind: 'ftp', config: await resolveFtpConfig(connection.config as FtpConnectionConfig) }
  }

  throw new Error(`Invalid source reference: ${ref}`)
}

// "/" (or, after trimming trailing slashes, "") means "no root" — it doesn't
// scope anything, and treating it as a real root would turn the prefix into "//".
function normalizeRoot(rootPath: string): string | undefined {
  const trimmed = rootPath.replace(/\/+$/, '')
  if (!trimmed) {
    return undefined
  }
  return trimmed.startsWith('/') ? trimmed : '/' + trimmed
}

/** Wraps a provider so every path is relative to `root` — the UI never sees or sends anything above it. */
function withRootPath(provider: Provider, root: string): Provider {
  const prefix = root + '/'

  const toReal = (uiPath: string) => {
    const clean = uiPath.startsWith('/') ? uiPath : '/' + uiPath
    return clean === '/' ? prefix : root + clean
  }
  const stripRoot = (realPath: string) => (realPath.startsWith(prefix) ? '/' + realPath.slice(prefix.length) : realPath)

  return {
    async list(path, cursor) {
      const result = await provider.list(toReal(path), cursor)
      return { ...result, entries: result.entries.map((entry) => ({ ...entry, path: stripRoot(entry.path) })) }
    },
    readStream: (path) => provider.readStream(toReal(path)),
    writeStream: (path, filename, stream) => provider.writeStream(toReal(path), filename, stream),
    delete: (path) => provider.delete(toReal(path)),
    rename: (oldPath, newPath) => provider.rename(toReal(oldPath), toReal(newPath)),
    mkdir: (path) => provider.mkdir(toReal(path)),
  }
}

/** The single entry point actions/routes use: resolve the ref, build its provider, apply any configured root-path scoping. */
export async function getProviderForRef(space: string, ref: string): Promise<Provider> {
  const source = await resolveSource(space, ref)
  const provider = getProvider(source)
  const { rootPath } = await getSourceSettings(space, ref)
  const root = rootPath ? normalizeRoot(rootPath) : undefined
  return root ? withRootPath(provider, root) : provider
}
