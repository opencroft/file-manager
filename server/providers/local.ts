import fs from 'node:fs'

import { joinPath as join, normalizePath as normalize } from './shared'
import type { FileEntry, ListResult, Provider, ReadStreamResult } from '../types'

export const localProvider: Provider = {
  async list(path): Promise<ListResult> {
    const dir = normalize(path)
    const items = await fs.promises.readdir(dir, { withFileTypes: true })
    const entries: FileEntry[] = []
    for (const item of items) {
      const full = join(dir, item.name)
      const isDir = item.isDirectory()
      let size = 0
      let modified = ''
      try {
        const stat = await fs.promises.stat(full)
        size = isDir ? 0 : stat.size
        modified = stat.mtime.toISOString()
      } catch {
        // Entry vanished or is unreadable (broken symlink, permissions) — list it with blank stats.
      }
      entries.push({ name: item.name, path: isDir ? full + '/' : full, type: isDir ? 'directory' : 'file', size, modified })
    }
    return { entries }
  },

  async readStream(path): Promise<ReadStreamResult> {
    const full = normalize(path)
    const stat = await fs.promises.stat(full)
    return { stream: fs.createReadStream(full), size: stat.size }
  },

  async writeStream(path, filename, stream): Promise<void> {
    const full = join(normalize(path), filename)
    await new Promise<void>((resolve, reject) => {
      const ws = fs.createWriteStream(full)
      ws.on('close', () => resolve())
      ws.on('error', reject)
      stream.on('error', reject)
      stream.pipe(ws)
    })
  },

  async delete(path): Promise<void> {
    await fs.promises.rm(normalize(path), { recursive: true, force: true })
  },

  async rename(oldPath, newPath): Promise<void> {
    await fs.promises.rename(normalize(oldPath), normalize(newPath))
  },

  async mkdir(path): Promise<void> {
    await fs.promises.mkdir(normalize(path), { recursive: true })
  },
}
