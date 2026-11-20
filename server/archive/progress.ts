import { type Readable, Transform } from 'node:stream'

/** How far a pack or unpack is: bytes of file content handled so far, of `total`. */
export interface ArchiveProgress {
  done: number
  total: number
}

export interface ArchiveRunOptions {
  /** Called as content goes through; often, so a caller showing it throttles. */
  onProgress?: (progress: ArchiveProgress) => void
  /** Aborting stops the run; it then cleans up as on any failure and rejects. */
  signal?: AbortSignal
}

/** A pass-through stream telling `onBytes` the size of every chunk that goes through it. */
export function counting(onBytes: (bytes: number) => void): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      onBytes(chunk.length)
      callback(null, chunk)
    },
  })
}

/** `stream` through counting(onBytes), its error passed on: a bare pipe would leave the reader waiting. */
export function counted(stream: Readable, onBytes: (bytes: number) => void): Readable {
  const counter = counting(onBytes)
  stream.on('error', (err) => counter.destroy(err))
  return stream.pipe(counter)
}

/** Destroys `stream` with the abort's reason once `signal` aborts; the returned function stops watching. */
export function destroyOnAbort(
  signal: AbortSignal | undefined,
  stream: { destroy: (err?: Error) => void },
): () => void {
  if (!signal) {
    return () => {}
  }
  const abort = () => stream.destroy(abortReason(signal))
  if (signal.aborted) {
    abort()
    return () => {}
  }
  signal.addEventListener('abort', abort, { once: true })
  return () => signal.removeEventListener('abort', abort)
}

export function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Cancelled')
}
