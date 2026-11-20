import { spawn } from 'node:child_process'

import type { FileEntry, ListResult, Provider, ReadStreamResult, TerminalContext } from '../types'
import { createArgv, refuseTaken } from './create'
import { type StreamProcess, spawnLocal, spawnOverSsh } from './process'
import { connectSsh, joinPath as join, normalizePath as normalize } from './shared'
import { shellQuote } from './shell'
import { commandBackend, upload } from './upload'

function dockerArgv(ctx: TerminalContext, extra: string[]): string[] {
  const contextArgs = ctx.contextName ? ['--context', ctx.contextName] : []
  const userArgs = ctx.user ? ['-u', ctx.user] : []
  return ['docker', ...contextArgs, 'exec', ...userArgs, '-i', ctx.containerId ?? '', ...extra]
}

// docker-exec composes with the parent transport (`ctx.via`, defaulting to local).
// Only local and ssh `via` are supported here; a deeper chain (e.g.
// docker-over-wsl) is out of scope.
function via(ctx: TerminalContext): TerminalContext {
  return ctx.via ?? { type: 'local' }
}

async function execVia(ctx: TerminalContext, argv: string[]): Promise<string> {
  const parent = via(ctx)
  if (parent.type === 'ssh') {
    return execSsh(parent, argv.map(shellQuote).join(' '))
  }
  return execLocal(argv)
}

function execLocal(argv: string[]): Promise<string> {
  const [cmd, ...rest] = argv
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, rest, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    proc.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr || `exited with code ${code}`))))
    proc.on('error', reject)
  })
}

async function execSsh(ctx: TerminalContext, command: string): Promise<string> {
  const client = await connectSsh(ctx)
  try {
    return await new Promise<string>((resolve, reject) => {
      client.exec(command, (err, channel) => {
        if (err) {
          reject(err)
          return
        }
        let stdout = ''
        let stderr = ''
        channel.on('data', (d: Buffer) => (stdout += d.toString()))
        channel.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
        channel.on('close', (code: number) =>
          code === 0 ? resolve(stdout) : reject(new Error(stderr || `exited with code ${code}`)),
        )
      })
    })
  } finally {
    client.end()
  }
}

// Streaming exec: either a local child process or an ssh2 exec channel; both
// expose a Readable stdout and a Writable stdin.
async function spawnStreamVia(ctx: TerminalContext, argv: string[]): Promise<StreamProcess> {
  const parent = via(ctx)
  if (parent.type !== 'ssh') {
    return spawnLocal(argv)
  }
  const client = await connectSsh(parent)
  try {
    const proc = await spawnOverSsh(client, argv)
    return {
      ...proc,
      close: () => {
        proc.close()
        client.end()
      },
    }
  } catch (err) {
    client.end()
    throw err
  }
}

export function dockerProvider(ctx: TerminalContext): Provider {
  return {
    async list(path): Promise<ListResult> {
      const dir = normalize(path)
      const q = shellQuote(dir)
      // '|'-delimited: a filename containing '|' or a newline will misparse; such names are not supported.
      const cmd =
        `for f in ${q}/* ${q}/.*; do ` +
        '[ -e "$f" ] || continue; ' +
        'b=$(basename "$f"); ' +
        '[ "$b" = "." ] || [ "$b" = ".." ] && continue; ' +
        'if [ -d "$f" ]; then t=d; else t=f; fi; ' +
        's=$(stat -c "%s" "$f" 2>/dev/null || echo 0); ' +
        'm=$(stat -c "%Y" "$f" 2>/dev/null || echo 0); ' +
        'echo "$t|$b|$s|$m"; ' +
        'done | sort -t"|" -k2'
      const output = await execVia(ctx, dockerArgv(ctx, ['sh', '-c', cmd]))
      if (!output.trim()) {
        return { entries: [] }
      }
      const entries: FileEntry[] = output
        .trim()
        .split('\n')
        .map((line) => {
          const [typeChar, name, size, mtime] = line.split('|')
          const isDir = typeChar === 'd'
          const full = join(dir, name)
          return {
            name,
            path: isDir ? `${full}/` : full,
            type: isDir ? ('directory' as const) : ('file' as const),
            size: isDir ? 0 : parseInt(size, 10) || 0,
            modified: mtime ? new Date(parseInt(mtime, 10) * 1000).toISOString() : '',
          }
        })
      return { entries }
    },

    async readStream(path): Promise<ReadStreamResult> {
      const full = normalize(path)
      const sizeOut = await execVia(
        ctx,
        dockerArgv(ctx, ['sh', '-c', `stat -c %s ${shellQuote(full)} 2>/dev/null || echo 0`]),
      )
      const size = parseInt(sizeOut.trim(), 10) || undefined
      const { stdout, exited, close } = await spawnStreamVia(ctx, dockerArgv(ctx, ['cat', full]))
      exited.catch((err: Error) => stdout.emit('error', err))
      stdout.on('close', close)
      return { stream: stdout, size }
    },

    async writeStream(path, filename, stream): Promise<void> {
      await upload(
        join(normalize(path), filename),
        stream,
        commandBackend({
          spawn: (argv) => spawnStreamVia(ctx, dockerArgv(ctx, argv)),
          exec: (argv) => execVia(ctx, dockerArgv(ctx, argv)),
        }),
      )
    },

    async delete(path): Promise<void> {
      await execVia(ctx, dockerArgv(ctx, ['rm', '-rf', normalize(path)]))
    },

    async rename(oldPath, newPath): Promise<void> {
      await execVia(ctx, dockerArgv(ctx, ['mv', normalize(oldPath), normalize(newPath)]))
    },

    async mkdir(path): Promise<void> {
      await refuseTaken(path, () => execVia(ctx, dockerArgv(ctx, createArgv('directory', normalize(path)))))
    },

    async createFile(path): Promise<void> {
      await refuseTaken(path, () => execVia(ctx, dockerArgv(ctx, createArgv('file', normalize(path)))))
    },
  }
}
