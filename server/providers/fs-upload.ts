// UploadBackend on this machine's file system, keeping the rules the shell
// scripts in ./upload keep. Free of host imports, so it runs under test as is.

import fs from 'node:fs'
import { pipeline } from 'node:stream/promises'

import type { UploadBackend, Written } from './upload'

const REFUSED = new Set(['EACCES', 'EPERM', 'EROFS'])

async function isWritableFile(path: string): Promise<boolean> {
  try {
    await fs.promises.access(path, fs.constants.W_OK)
    return (await fs.promises.stat(path)).isFile()
  } catch {
    return false
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.promises.lstat(path)
    return true
  } catch {
    return false
  }
}

export const fsBackend: UploadBackend = {
  async write(body, partial, full): Promise<Written> {
    let where: Written['where'] = 'partial'
    let handle: fs.promises.FileHandle
    try {
      handle = await fs.promises.open(partial, 'wx')
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (!(code && REFUSED.has(code) && (await isWritableFile(full)))) {
        throw err
      }
      where = 'in-place'
      handle = await fs.promises.open(full, 'w')
    }
    await pipeline(body, handle.createWriteStream())
    const size = (await fs.promises.stat(where === 'partial' ? partial : full)).size
    return { where, size }
  },

  async land(partial, full) {
    if (await exists(full)) {
      // Opening with "w" truncates the file it reaches: mode, owner and links stay.
      await pipeline(fs.createReadStream(partial), fs.createWriteStream(full))
      await fs.promises.rm(partial, { force: true })
    } else {
      await fs.promises.rename(partial, full)
    }
  },

  async discard(partial) {
    await fs.promises.rm(partial, { force: true })
  },
}
