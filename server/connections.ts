import { secrets } from '@opencroft/server/secrets'
import { terminal } from '@opencroft/server/terminal'

import { getProvider } from './provider'
import { getConnection, getSourceSettings } from './storage'
import { requireTerminalInSpace } from './terminal-sources'
import type {
  FtpConnectionConfig,
  Provider,
  ResolvedFtpConfig,
  ResolvedS3Config,
  S3ConnectionConfig,
  Source,
} from './types'

const TERM_PREFIX = 'term:'
const CONN_PREFIX = 'conn:'

// A field value of "secret:NAME" resolves NAME server-side from the Secrets Stores in the
// connection's space; anything else is used literally. Only the reference (never the resolved
// value) is ever part of connections storage, so it can't leak through the client or a graph read.
function resolveField(space: string, value: string): Promise<string> {
  return secrets.resolveValue(value, { spaceSlug: space })
}

async function resolveS3Config(space: string, config: S3ConnectionConfig): Promise<ResolvedS3Config> {
  return {
    ...config,
    accessKeyId: await resolveField(space, config.accessKeyId ?? ''),
    secretAccessKey: await resolveField(space, config.secretAccessKey ?? ''),
  }
}

async function resolveFtpConfig(space: string, config: FtpConnectionConfig): Promise<ResolvedFtpConfig> {
  return {
    ...config,
    password: await resolveField(space, config.password ?? ''),
  }
}

/**
 * Resolve a source reference into a concrete, secret-resolved `Source`.
 * `term:<nodeId>/<handleId>` — a terminal-context output handle `space` lists
 * (listTerminalSources), resolved via terminal.getContext (no edge required).
 * `conn:<id>` — an S3/FTP connection configured in `space`.
 */
export async function resolveSource(space: string, ref: string): Promise<Source> {
  if (ref.startsWith(TERM_PREFIX)) {
    const rest = ref.slice(TERM_PREFIX.length)
    const slash = rest.indexOf('/')
    if (slash < 0) {
      throw new Error(`Invalid terminal source reference: ${ref}`)
    }
    await requireTerminalInSpace(space, ref)
    const nodeId = rest.slice(0, slash)
    const handleId = rest.slice(slash + 1)
    const ctx = await terminal.getContext(nodeId, handleId)
    return { kind: 'terminal', ctx }
  }

  if (ref.startsWith(CONN_PREFIX)) {
    const id = ref.slice(CONN_PREFIX.length)
    const connection = await getConnection(space, id)
    if (!connection) {
      throw new Error(`Unknown connection: ${id}`)
    }
    if (connection.type === 's3') {
      return { kind: 's3', config: await resolveS3Config(space, connection.config as S3ConnectionConfig) }
    }
    return { kind: 'ftp', config: await resolveFtpConfig(space, connection.config as FtpConnectionConfig) }
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
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

/** Wraps a provider so every path is relative to `root` — the UI never sees or sends anything above it. */
function withRootPath(provider: Provider, root: string): Provider {
  const prefix = `${root}/`

  const toReal = (uiPath: string) => {
    const clean = uiPath.startsWith('/') ? uiPath : `/${uiPath}`
    return clean === '/' ? prefix : root + clean
  }
  const stripRoot = (realPath: string) => (realPath.startsWith(prefix) ? `/${realPath.slice(prefix.length)}` : realPath)

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
    createFile: (path) => provider.createFile(toReal(path)),
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
