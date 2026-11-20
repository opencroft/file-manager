// A program streaming through its stdin and stdout, run here or on the far
// side of a transport. Free of host imports, so it runs under test as is.

import { spawn } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'

import type { Client, ClientChannel } from 'ssh2'

import { shellQuote } from './shell'

export interface StreamProcess {
  stdout: Readable
  stdin: Writable
  /**
   * Settles once the program has ended: resolves on exit code 0, rejects when
   * it could not start, exited non-zero or was killed.
   */
  exited: Promise<void>
  /** Ends the program and its transport, whether or not it has exited. */
  close: () => void
}

/**
 * Wraps a program's events into `exited`. `onError` is the start or transport
 * failure; `onClose` gets the exit code, null when a signal ended it.
 */
export function exitOf(
  onError: (fn: (err: Error) => void) => void,
  onClose: (fn: (code: number | null) => void) => void,
  stderrOf: () => string,
): Promise<void> {
  const exited = new Promise<void>((resolve, reject) => {
    onError(reject)
    onClose((code) => (code === 0 ? resolve() : reject(new Error(stderrOf() || `exited with code ${code}`))))
  })
  // A caller that never awaits it (a download whose reader went away) must not
  // turn a failed exit into an unhandled rejection.
  exited.catch(() => {})
  return exited
}

/** Runs `argv` over an ssh connection; `close` ends the channel. */
export async function spawnOverSsh(client: Client, argv: string[]): Promise<StreamProcess> {
  const channel: ClientChannel = await new Promise((resolve, reject) => {
    client.exec(argv.map(shellQuote).join(' '), (err, ch) => (err ? reject(err) : resolve(ch)))
  })
  let stderr = ''
  channel.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
  return {
    stdout: channel,
    stdin: channel,
    // ssh2 emits `close` only once stdout has ended, with the exit status as
    // its first argument; a channel closed without one (the connection
    // dropped) passes none.
    exited: exitOf(
      (fn) => channel.on('error', fn),
      (fn) => channel.on('close', (code: number | null | undefined) => fn(code ?? null)),
      () => stderr,
    ),
    close: () => channel.close(),
  }
}

/** Runs `argv` on this machine. */
export function spawnLocal(argv: string[]): StreamProcess {
  const [cmd, ...rest] = argv
  const proc = spawn(cmd, rest, { stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
  return {
    stdout: proc.stdout,
    stdin: proc.stdin,
    exited: exitOf(
      (fn) => proc.on('error', fn),
      (fn) => proc.on('close', fn),
      () => stderr,
    ),
    close: () => {
      if (proc.exitCode === null && proc.signalCode === null) {
        proc.kill()
      }
    },
  }
}
