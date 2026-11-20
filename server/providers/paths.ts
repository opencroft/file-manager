// Path arithmetic on a source's paths, the form the listing gives them in: a
// leading slash, and a trailing one on a folder. Free of host imports.

export function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

export function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') ? dir + name : `${dir}/${name}`
}

/** The folder holding `path`, with its trailing slash; "/" for anything at the top. */
export function parentPath(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  return idx <= 0 ? '/' : trimmed.slice(0, idx + 1)
}

/** The last segment of `path`, a folder's trailing slash ignored. */
export function baseName(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() ?? ''
}
