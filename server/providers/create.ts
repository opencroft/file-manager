// Creating one folder or empty file only where nothing has that path yet, the
// same way on every backend. Free of host imports, so it runs under test as is.

import { shellQuote } from './shell'

/** The refusal of a create whose path is taken, worded the same by every backend. */
export function alreadyExists(path: string): Error {
  const name = path.replace(/\/+$/, '').split('/').pop() || path
  return new Error(`"${name}" already exists`)
}

// What createScript prints on stderr when the path is taken, so the shell
// backends' refusal can be told from any other failure of the same command.
const TAKEN_MARKER = 'file-manager: path taken'

/**
 * A POSIX shell script creating "$1" (a folder, or an empty file) only when
 * nothing has that path, a dangling symlink included. The check and the create
 * are two steps, so the create refuses on its own too: `mkdir` without `-p`
 * fails on an existing path, and under `noclobber` so does the redirection.
 */
export function createScript(kind: 'directory' | 'file'): string {
  const create = kind === 'directory' ? 'mkdir "$1"' : 'set -C; : > "$1"'
  return `if [ -e "$1" ] || [ -L "$1" ]; then echo '${TAKEN_MARKER}' >&2; exit 1; fi; ${create}`
}

/**
 * createScript run on `path`, as an argv for a backend that executes a
 * program directly, with no shell of its own in between (`docker exec`,
 * `wsl -e`): `sh` gets the script and `path` as its `$1`, untouched.
 */
export function createArgv(kind: 'directory' | 'file', path: string): string[] {
  return ['sh', '-c', createScript(kind), 'sh', path]
}

/** createScript run on `path`, as one shell command line, for a backend that hands a line to a shell (ssh exec). */
export function createCommand(kind: 'directory' | 'file', path: string): string {
  return `sh -c ${shellQuote(createScript(kind))} sh ${shellQuote(path)}`
}

/** Runs `create`, turning a backend's own "that path exists" into `alreadyExists(path)`. */
export async function refuseTaken(path: string, create: () => Promise<unknown>): Promise<void> {
  try {
    await create()
  } catch (err) {
    const taken =
      (err as NodeJS.ErrnoException).code === 'EEXIST' || (err instanceof Error && err.message.includes(TAKEN_MARKER))
    throw taken ? alreadyExists(path) : err
  }
}
