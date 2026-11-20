// The parameters of a pack or an unpack as a caller sends them (the App's UI
// through a route, an agent through an App action), checked into requests.
// Free of host imports.

import type { PackRequest } from './pack'
import type { UnpackRequest } from './unpack'

function optionalPath(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key]
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (typeof value !== 'string' || !value.startsWith('/')) {
    throw new Error(`"${key}" must be an absolute path`)
  }
  return value
}

function requiredPath(params: Record<string, unknown>, key: string): string {
  const value = optionalPath(params, key)
  if (!value) {
    throw new Error(`"${key}" is required`)
  }
  return value
}

export function packRequestOf(params: Record<string, unknown>): PackRequest {
  const { paths, name } = params
  if (!Array.isArray(paths) || !paths.length) {
    throw new Error('"paths" must list at least one file or folder')
  }
  const checked = paths.map((path, i) => requiredPath({ [`paths[${i}]`]: path }, `paths[${i}]`))
  if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.includes('/'))) {
    throw new Error('"name" must be a file name, without "/"')
  }
  return {
    paths: checked,
    target: optionalPath(params, 'target'),
    name: typeof name === 'string' ? name.trim() : undefined,
  }
}

export function unpackRequestOf(params: Record<string, unknown>): UnpackRequest {
  return { archive: requiredPath(params, 'archive'), target: optionalPath(params, 'target') }
}
