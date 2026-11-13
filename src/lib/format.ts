const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), SIZE_UNITS.length - 1)
  const value = bytes / 1024 ** exp
  return `${exp === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${SIZE_UNITS[exp]}`
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatSize(bytesPerSecond)}/s`
}

export function formatModified(iso: string): string {
  if (!iso) {
    return ''
  }
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) {
    return ''
  }
  const diffSeconds = Math.round((Date.now() - then) / 1000)
  if (diffSeconds < 60) {
    return 'just now'
  }
  const diffMinutes = Math.round(diffSeconds / 60)
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`
  }
  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) {
    return `${diffHours}h ago`
  }
  const diffDays = Math.round(diffHours / 24)
  if (diffDays < 7) {
    return `${diffDays}d ago`
  }
  return new Date(iso).toLocaleDateString()
}

export function parentPath(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  return idx <= 0 ? '/' : trimmed.slice(0, idx + 1)
}

/**
 * Where `path`, as the listing names it, really is on its source: under the
 * source's `rootPath` when one is set, the way the server resolves it (a
 * root of "" or "/" scopes nothing), and without a folder's trailing slash.
 */
export function fullPath(rootPath: string | undefined, path: string): string {
  const root = (rootPath ?? '').replace(/\/+$/, '')
  const rooted = root ? `${root.startsWith('/') ? '' : '/'}${root}${path}` : path
  return rooted.length > 1 ? rooted.replace(/\/+$/, '') : rooted
}

/**
 * The inverse of fullPath for a folder: where the folder at full path `path`
 * is in the listing of a source scoped to `rootPath`, in the listing's own
 * form (a leading and a trailing slash, "/" for the root). Undefined when the
 * folder is outside the root, so the listing cannot reach it.
 */
export function listingPath(rootPath: string | undefined, path: string): string | undefined {
  const root = fullPath(rootPath, '/')
  const folder = fullPath(undefined, path)
  if (root === '/') {
    return folder === '/' ? '/' : `${folder}/`
  }
  if (folder === root) {
    return '/'
  }
  return folder.startsWith(`${root}/`) ? `${folder.slice(root.length)}/` : undefined
}

/** The last segment of a folder path, or "" for the root. */
export function folderName(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() ?? ''
}

export function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') ? dir + name : `${dir}/${name}`
}
