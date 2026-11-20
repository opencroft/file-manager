// Writing an upload so that its target holds either what it held before or the
// whole new body. The body goes to a hidden partial file beside the target; the
// far side reports how many bytes it wrote, which must be the number streamed;
// only then does the partial file land on the target. A failed, short or
// cut-off transfer is an error and removes the partial file. Free of host
// imports, so it runs under test as is.

import { randomBytes } from 'node:crypto'
import { type Readable, pipeline as streamPipeline, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import type { StreamProcess } from './process'

/**
 * A hidden name beside `full` for the bytes in flight: random, so concurrent
 * uploads of one name never share it, and short whatever the target's length.
 */
export function partialPathOf(full: string): string {
  const dir = full.slice(0, full.lastIndexOf('/') + 1)
  return `${dir}.upload-${randomBytes(6).toString('hex')}.part`
}

const PARTIAL_NAME = /^\.upload-[0-9a-f]{12}\.part$/

/** Whether a listed name is an upload still in flight (or one a crash left), which a listing leaves out. */
export function isPartialUpload(name: string): boolean {
  return PARTIAL_NAME.test(name)
}

/**
 * How long a partial file may go unwritten before it counts as left behind,
 * by a server that stopped mid-upload or a far side it could no longer reach
 * to remove it. A live upload writes its partial file with every chunk that
 * arrives, so this only has to be longer than any pause between two chunks
 * of a transfer still going.
 */
export const STALE_PARTIAL_MS = 60 * 60 * 1000

/** The partial files among `entries` that no upload has written for STALE_PARTIAL_MS; one with no known time is never stale. */
export function stalePartials<T extends { name: string; modified: string }>(entries: T[], now: number): T[] {
  return entries.filter((entry) => isPartialUpload(entry.name) && now - Date.parse(entry.modified) > STALE_PARTIAL_MS)
}

/** Where the far side put the body, and how many bytes it holds there. */
export interface Written {
  /** `in-place`: the folder takes no new file but the target is writable, so the target itself was written. */
  where: 'partial' | 'in-place'
  size: number
}

/** How one backend writes, lands and removes the files of an upload. */
export interface UploadBackend {
  /** Writes all of `body` to `partial`, or in place to `full` when only that is possible. */
  write: (body: Readable, partial: string, full: string) => Promise<Written>
  /**
   * Puts the complete `partial` onto `full` and removes it: a rename onto a new
   * name, a copy into an existing file, so the file keeps its mode, owner and
   * links, and a file bind-mounted into a container stays the one it reads.
   */
  land: (partial: string, full: string) => Promise<void>
  /** Removes `partial`, if it is there. */
  discard: (partial: string) => Promise<void>
}

/** `stream`, passed on with a count of the bytes that went through. */
function counted(stream: Readable): { body: Readable; bytes: () => number } {
  let bytes = 0
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length
      done(null, chunk)
    },
  })
  // Errors travel both ways: a cut-off request fails the body, and a body that
  // stops being read stops the request.
  streamPipeline(stream, counter, () => {})
  return { body: counter, bytes: () => bytes }
}

export async function upload(full: string, stream: Readable, backend: UploadBackend): Promise<void> {
  const partial = partialPathOf(full)
  const { body, bytes } = counted(stream)
  try {
    const written = await backend.write(body, partial, full)
    if (written.size !== bytes()) {
      throw new Error(`The upload was cut short: ${written.size} of ${bytes()} bytes were written`)
    }
    if (written.where === 'partial') {
      await backend.land(partial, full)
    }
  } catch (err) {
    await backend.discard(partial).catch(() => {})
    throw err
  }
}

/**
 * Feeds `stream` to a program that writes its stdin to a file, and resolves
 * with what it printed once it has exited 0. Its stdin being flushed is not
 * enough: the bytes can still be in the pipe or on the wire, and ending the
 * transport then ends the program before it has written them. Its stdout is
 * read throughout, since a program blocks once nobody reads the pipe. On any
 * failure the body stops being read and the program is ended.
 *
 * When one side fails the other usually fails too, so the error reported is
 * the one that says why: the body's own when the transfer was cut off, else
 * the program's (a missing folder, a full disk) over the broken pipe it left.
 */
export async function pipeToProcess(stream: Readable, proc: StreamProcess): Promise<string> {
  let printed = ''
  proc.stdout.on('data', (chunk: Buffer) => {
    // Only a short report is expected; the cap keeps a chatty program from growing it.
    if (printed.length < 4096) {
      printed += chunk.toString()
    }
  })
  // The pipeline destroys the body with whatever error it met first, so a
  // broken stdin is told from a cut-off body by where the error came from.
  let stdinError: unknown
  proc.stdin.on('error', (err) => {
    stdinError ??= err
  })
  const exited = proc.exited.catch((err: Error) => {
    stream.destroy(err)
    throw err
  })
  try {
    const [piped, exit] = await Promise.allSettled([pipeline(stream, proc.stdin), exited])
    if (piped.status === 'rejected' && piped.reason !== stdinError) {
      throw piped.reason
    }
    if (exit.status === 'rejected') {
      throw exit.reason
    }
    if (piped.status === 'rejected') {
      throw piped.reason
    }
    return printed
  } finally {
    proc.close()
  }
}

/**
 * Writes stdin to the partial file "$1" and prints `partial <bytes>`; when the
 * folder takes no new file but the target "$2" is a writable file, writes "$2"
 * in place and prints `in-place <bytes>`. A hangup or kill removes the partial
 * file. Otherwise it fails with the shell's own reason for the partial file.
 */
export const WRITE_SCRIPT = [
  `trap 'rm -f "$1"; exit 129' HUP INT TERM;`,
  `if (set -C; : > "$1") 2>/dev/null; then`,
  `cat > "$1" || { rm -f "$1"; exit 1; }; echo partial $(wc -c < "$1");`,
  `elif [ -f "$2" ] && [ -w "$2" ] && [ ! -w "$(dirname "$2")" ]; then`,
  `cat > "$2" || exit 1; echo in-place $(wc -c < "$2");`,
  `else : > "$1"; exit 1; fi`,
].join(' ')

/** UploadBackend.land for a shell: "$1" onto "$2". */
export const LAND_SCRIPT = `if [ -e "$2" ] || [ -L "$2" ]; then cat "$1" > "$2" && rm -f "$1"; else mv "$1" "$2"; fi`

function parseWritten(printed: string): Written {
  const match = /^(partial|in-place) (\d+)\s*$/.exec(printed.trim())
  if (!match) {
    throw new Error(`The upload's writer did not report what it wrote: ${JSON.stringify(printed.slice(0, 200))}`)
  }
  return { where: match[1] as Written['where'], size: Number(match[2]) }
}

/** A backend running argv programs on the far side (`docker exec`, `wsl -e`, an ssh exec). */
export interface CommandRunner {
  spawn: (argv: string[]) => Promise<StreamProcess>
  exec: (argv: string[]) => Promise<unknown>
}

/** An UploadBackend over a POSIX shell on the far side. */
export function commandBackend(runner: CommandRunner): UploadBackend {
  return {
    write: async (body, partial, full) =>
      parseWritten(await pipeToProcess(body, await runner.spawn(['sh', '-c', WRITE_SCRIPT, 'sh', partial, full]))),
    land: async (partial, full) => {
      await runner.exec(['sh', '-c', LAND_SCRIPT, 'sh', partial, full])
    },
    discard: async (partial) => {
      await runner.exec(['rm', '-f', partial])
    },
  }
}
