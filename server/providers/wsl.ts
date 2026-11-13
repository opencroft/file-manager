import { exec, execFile, spawn } from 'node:child_process'
import type { Readable } from 'node:stream'

import type { FileEntry, ListResult, Provider, ReadStreamResult, TerminalContext } from '../types'
import { createArgv, refuseTaken } from './create'
import { joinPath as join, normalizePath as normalize } from './shared'
import { shellQuote } from './shell'

function run(distro: string | undefined, cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = distro ? ['-d', distro] : []
    exec(
      `wsl ${args.join(' ')} -- bash -c "${cmd.replace(/"/g, '\\"')}"`,
      { maxBuffer: 50 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || err.message))
          return
        }
        resolve(stdout)
      },
    )
  })
}

// Runs `argv` in the distro as a program (`wsl -e`), with no shell between:
// unlike `run`, whose command line passes through the distro's default shell
// first, nothing in `argv` is expanded or re-quoted on the way.
function runArgv(distro: string | undefined, argv: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('wsl', [...(distro ? ['-d', distro] : []), '-e', ...argv], (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message))
        return
      }
      resolve(stdout)
    })
  })
}

export function wslProvider(ctx: TerminalContext): Provider {
  const distro = ctx.distro

  return {
    async list(path): Promise<ListResult> {
      const dir = normalize(path)
      // '|'-delimited: a filename containing '|' or a newline will misparse; such names are not supported.
      const output = await run(
        distro,
        `find ${shellQuote(dir)} -maxdepth 1 -mindepth 1 -printf '%y|%f|%s|%T@\\n' 2>/dev/null | sort`,
      )
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
            modified: mtime ? new Date(parseFloat(mtime) * 1000).toISOString() : '',
          }
        })
      return { entries }
    },

    async readStream(path): Promise<ReadStreamResult> {
      const full = normalize(path)
      const sizeOut = await run(distro, `stat -c %s ${shellQuote(full)} 2>/dev/null || echo 0`)
      const size = parseInt(sizeOut.trim(), 10) || undefined
      const args = [...(distro ? ['-d', distro] : []), '--', 'cat', full]
      const proc = spawn('wsl', args, { stdio: ['ignore', 'pipe', 'pipe'] })
      const stream: Readable = proc.stdout
      let stderr = ''
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      proc.on('close', (code) => {
        if (code !== 0 && code !== null) {
          stream.emit('error', new Error(stderr || `wsl cat exited with code ${code}`))
        }
      })
      return { stream, size }
    },

    async writeStream(path, filename, stream): Promise<void> {
      const full = join(normalize(path), filename)
      const args = [...(distro ? ['-d', distro] : []), '--', 'tee', full]
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('wsl', args, { stdio: ['pipe', 'ignore', 'pipe'] })
        let stderr = ''
        proc.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString()
        })
        proc.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(stderr || `wsl tee exited with code ${code}`))
            return
          }
          resolve()
        })
        proc.on('error', reject)
        stream.on('error', reject)
        stream.pipe(proc.stdin)
      })
    },

    async delete(path): Promise<void> {
      await run(distro, `rm -rf ${shellQuote(normalize(path))}`)
    },

    async rename(oldPath, newPath): Promise<void> {
      await run(distro, `mv ${shellQuote(normalize(oldPath))} ${shellQuote(normalize(newPath))}`)
    },

    async mkdir(path): Promise<void> {
      await refuseTaken(path, () => runArgv(distro, createArgv('directory', normalize(path))))
    },

    async createFile(path): Promise<void> {
      await refuseTaken(path, () => runArgv(distro, createArgv('file', normalize(path))))
    },
  }
}
