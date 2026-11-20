import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import nodePath from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { afterEach, beforeEach, test } from 'node:test'

import yazl from 'yazl'

import { alreadyExists } from '../providers/create'
import type { FileEntry, Provider } from '../types'
import { EntryOutsideError } from './names'
import { packInto, zipDownload, zipStream } from './pack'
import { unpackInto } from './unpack'

// A source over a real folder, `/` being `root`: the Provider contract as the
// shell backends keep it (a folder's path ends in `/`, mkdir and createFile
// refuse a taken path), without the host.
function folderProvider(root: string, faults: { failRead?: string } = {}): Provider {
  const real = (path: string) => nodePath.join(root, path)
  const refuseTaken = async (path: string, create: () => Promise<unknown>) => {
    try {
      await create()
    } catch (err) {
      throw (err as NodeJS.ErrnoException).code === 'EEXIST' ? alreadyExists(path) : err
    }
  }
  return {
    async list(path) {
      const dir = path.endsWith('/') ? path : `${path}/`
      const entries: FileEntry[] = []
      for (const item of await fs.promises.readdir(real(dir), { withFileTypes: true })) {
        const stat = await fs.promises.stat(real(dir + item.name))
        const isDir = item.isDirectory()
        entries.push({
          name: item.name,
          path: `${dir}${item.name}${isDir ? '/' : ''}`,
          type: isDir ? 'directory' : 'file',
          size: isDir ? 0 : stat.size,
          modified: stat.mtime.toISOString(),
        })
      }
      return { entries }
    },
    async readStream(path) {
      if (faults.failRead && path.endsWith(faults.failRead)) {
        const stream = new Readable({ read() {} })
        stream.push(Buffer.alloc(1000, 1))
        setImmediate(() => stream.destroy(new Error('read failed')))
        return { stream }
      }
      return { stream: fs.createReadStream(real(path)), size: (await fs.promises.stat(real(path))).size }
    },
    async writeStream(path, filename, stream) {
      await pipeline(stream, fs.createWriteStream(real(nodePath.posix.join(path, filename))))
    },
    async delete(path) {
      await fs.promises.rm(real(path), { recursive: true, force: true })
    },
    async rename(oldPath, newPath) {
      await fs.promises.rename(real(oldPath), real(newPath))
    },
    mkdir: (path) => refuseTaken(path, () => fs.promises.mkdir(real(path))),
    createFile: (path) => refuseTaken(path, () => fs.promises.writeFile(real(path), '', { flag: 'wx' })),
  }
}

let root: string
let temp: string

beforeEach(async () => {
  root = await fs.promises.mkdtemp(nodePath.join(os.tmpdir(), 'fm-archive-'))
  temp = nodePath.join(root, '..', `${nodePath.basename(root)}-temp`)
})

afterEach(async () => {
  await fs.promises.rm(root, { recursive: true, force: true })
  await fs.promises.rm(temp, { recursive: true, force: true })
})

function write(path: string, content: string | Buffer) {
  const full = nodePath.join(root, path)
  fs.mkdirSync(nodePath.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
}

// Every file and folder under `dir`, with each file's size and content hash.
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (rel: string) => {
    for (const item of fs.readdirSync(nodePath.join(root, dir, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${item.name}` : item.name
      if (item.isDirectory()) {
        out[`${path}/`] = 'dir'
        walk(path)
      } else {
        const bytes = fs.readFileSync(nodePath.join(root, dir, path))
        out[path] = `${bytes.length}:${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}`
      }
    }
  }
  walk('')
  return out
}

const ls = (dir: string) => fs.readdirSync(nodePath.join(root, dir)).sort()

// An archive yazl writes, with `rename` applied to the names in its bytes:
// yazl refuses to write the names an unsafe or foreign archive carries.
async function craftZip(
  path: string,
  files: { name: string; content: string; mode?: number }[],
  rename: (bytes: Buffer) => void = () => {},
) {
  const zip = new yazl.ZipFile()
  for (const file of files) {
    zip.addBuffer(Buffer.from(file.content), file.name, file.mode ? { mode: file.mode } : {})
  }
  zip.end()
  const chunks: Buffer[] = []
  for await (const chunk of zip.outputStream) {
    chunks.push(chunk as Buffer)
  }
  const bytes = Buffer.concat(chunks)
  rename(bytes)
  write(path, bytes)
}

function replaceAll(bytes: Buffer, from: string, to: string) {
  assert.equal(from.length, to.length, 'a renamed entry keeps its length')
  let at = bytes.indexOf(from)
  assert.notEqual(at, -1, `"${from}" is in the archive`)
  while (at !== -1) {
    bytes.write(to, at, 'latin1')
    at = bytes.indexOf(from, at + 1)
  }
}

test('a mix of files and nested folders packs and unpacks elsewhere to the same tree', async () => {
  write('src/a.txt', 'alpha')
  write('src/big.bin', Buffer.alloc(3 * 1024 * 1024, 7))
  write('src/docs/readme.md', '# hello')
  write('src/docs/deep/er/x.json', '{"x":1}')
  fs.mkdirSync(nodePath.join(root, 'src/docs/empty'))
  write('src/not-packed.txt', 'left out')
  const provider = folderProvider(root)
  const seen: number[] = []

  const packed = await packInto(
    provider,
    { paths: ['/src/a.txt', '/src/big.bin', '/src/docs/'] },
    { onProgress: (p) => seen.push(p.done / p.total) },
  )

  assert.equal(packed.path, '/src/Archive.zip')
  assert.deepEqual([packed.files, packed.folders], [4, 4])
  assert.deepEqual(ls('src'), ['Archive.zip', 'a.txt', 'big.bin', 'docs', 'not-packed.txt'])
  assert.equal(seen.at(-1), 1)

  fs.mkdirSync(nodePath.join(root, 'elsewhere'))
  fs.renameSync(nodePath.join(root, 'src/Archive.zip'), nodePath.join(root, 'elsewhere/Archive.zip'))
  const unpacked = await unpackInto(provider, { archive: '/elsewhere/Archive.zip' }, { tempDir: temp })

  assert.equal(unpacked.path, '/elsewhere/Archive/')
  const expected = tree('src')
  delete expected['not-packed.txt']
  assert.deepEqual(tree('elsewhere/Archive'), expected)
  assert.deepEqual(fs.readdirSync(temp), [], 'the copy of the archive is gone')
})

test('a name taken already gets the next free one, for the archive and for the folder', async () => {
  write('docs/a.txt', 'a')
  write('docs.zip', 'someone else')
  write('docs 2.zip', 'someone else too')
  const provider = folderProvider(root)

  const packed = await packInto(provider, { paths: ['/docs'] })
  assert.equal(packed.name, 'docs 3.zip')
  assert.equal(fs.readFileSync(nodePath.join(root, 'docs.zip'), 'utf8'), 'someone else')

  const unpacked = await unpackInto(provider, { archive: '/docs 3.zip' }, { tempDir: temp })
  assert.equal(unpacked.name, 'docs 3')
  fs.rmSync(nodePath.join(root, 'docs 3'), { recursive: true })
  fs.mkdirSync(nodePath.join(root, 'docs 3'))
  const again = await unpackInto(provider, { archive: '/docs 3.zip' }, { tempDir: temp })
  assert.equal(again.name, 'docs 3 2')
  assert.deepEqual(tree('docs 3 2'), { 'docs/': 'dir', 'docs/a.txt': tree('docs')['a.txt'] })
})

test('a failed read leaves neither the archive nor its temporary file', async () => {
  write('src/a.txt', 'alpha')
  write('src/b.txt', 'beta')
  const provider = folderProvider(root, { failRead: 'b.txt' })

  await assert.rejects(packInto(provider, { paths: ['/src/a.txt', '/src/b.txt'] }), /read failed/)
  assert.deepEqual(ls('src'), ['a.txt', 'b.txt'])
})

test('an abort while packing leaves nothing behind', async () => {
  write('src/big.bin', Buffer.alloc(8 * 1024 * 1024, 1))
  const controller = new AbortController()
  const run = packInto(
    folderProvider(root),
    { paths: ['/src/big.bin'] },
    { signal: controller.signal, onProgress: (p) => p.done > 0 && controller.abort() },
  )
  await assert.rejects(run)
  assert.deepEqual(ls('src'), ['big.bin'])
})

test('an archive with a ../ entry is refused and writes nothing anywhere', async () => {
  fs.mkdirSync(nodePath.join(root, 'in'))
  await craftZip(
    'in/evil.zip',
    [
      { name: 'ok.txt', content: 'fine' },
      { name: 'aa/evil.txt', content: 'escaped' },
    ],
    (bytes) => replaceAll(bytes, 'aa/evil.txt', '../evil.txt'),
  )

  await assert.rejects(
    unpackInto(folderProvider(root), { archive: '/in/evil.zip' }, { tempDir: temp }),
    EntryOutsideError,
  )
  assert.deepEqual(ls('in'), ['evil.zip'], 'no folder was made')
  assert.deepEqual(ls(''), ['in'], 'nothing was written beside the target either')
  assert.deepEqual(fs.readdirSync(temp), [])
})

test('an archive with an absolute entry is refused', async () => {
  await craftZip('abs.zip', [{ name: 'xetc/passwd', content: 'root' }], (bytes) =>
    replaceAll(bytes, 'xetc/passwd', '/etc/passwd'),
  )
  await assert.rejects(unpackInto(folderProvider(root), { archive: '/abs.zip' }, { tempDir: temp }), EntryOutsideError)
  assert.deepEqual(ls(''), ['abs.zip'])
})

test('an archive in the Windows form, backslashes and no folder entries, unpacks to its tree', async () => {
  await craftZip('win.zip', [{ name: 'dir/sub/f.txt', content: 'from windows' }], (bytes) =>
    replaceAll(bytes, 'dir/sub/f.txt', 'dir\\sub\\f.txt'),
  )
  const result = await unpackInto(folderProvider(root), { archive: '/win.zip' }, { tempDir: temp })
  assert.equal(fs.readFileSync(nodePath.join(root, 'win/dir/sub/f.txt'), 'utf8'), 'from windows')
  assert.deepEqual([result.files, result.folders], [1, 2])
})

test("Finder's __MACOSX metadata and symbolic links are left out and counted", async () => {
  await craftZip('mac.zip', [
    { name: 'photo.txt', content: 'content' },
    { name: '__MACOSX/._photo.txt', content: 'resource fork' },
    { name: 'link', content: 'photo.txt', mode: 0o120777 },
  ])
  const result = await unpackInto(folderProvider(root), { archive: '/mac.zip' }, { tempDir: temp })
  assert.deepEqual(ls('mac'), ['photo.txt'])
  assert.deepEqual(result.skipped, { links: 1, macMetadata: 1 })
})

test('a failure while unpacking removes the folder it made', async () => {
  await craftZip('clash.zip', [
    { name: 'a', content: 'a file' },
    { name: 'a/b.txt', content: 'needs a folder named a' },
  ])
  await assert.rejects(unpackInto(folderProvider(root), { archive: '/clash.zip' }, { tempDir: temp }))
  assert.deepEqual(ls(''), ['clash.zip'])
})

test('the zip stream alone is an archive a download can serve', async () => {
  write('one.txt', 'one')
  const provider = folderProvider(root)
  const chunks: Buffer[] = []
  for await (const chunk of zipStream(provider, [{ source: '/one.txt', name: 'one.txt', kind: 'file', size: 3 }])) {
    chunks.push(chunk as Buffer)
  }
  write('served.zip', Buffer.concat(chunks))
  await unpackInto(provider, { archive: '/served.zip' }, { tempDir: temp })
  assert.equal(fs.readFileSync(nodePath.join(root, 'served/one.txt'), 'utf8'), 'one')
})

// The whole of a stream, or the error that ended it.
async function drain(stream: AsyncIterable<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

test('a download of files, a nested folder and an empty one unpacks to the same tree, writing nothing at the source', async () => {
  write('src/a.txt', 'alpha')
  write('src/big.bin', Buffer.alloc(2 * 1024 * 1024, 3))
  write('src/docs/readme.md', '# hello')
  write('src/docs/deep/x.json', '{"x":1}')
  fs.mkdirSync(nodePath.join(root, 'src/docs/empty'))
  write('src/not-chosen.txt', 'left out')
  const provider = folderProvider(root)
  const before = tree('src')

  const download = await zipDownload(provider, ['/src/a.txt', '/src/big.bin', '/src/docs/'])
  assert.equal(download.name, 'Archive.zip')
  write('got/Archive.zip', await drain(download.stream))
  assert.deepEqual(tree('src'), before, 'the source is as it was')

  await unpackInto(provider, { archive: '/got/Archive.zip' }, { tempDir: temp })
  const expected = { ...before }
  delete expected['not-chosen.txt']
  assert.deepEqual(tree('got/Archive'), expected)
})

test('a download of one folder is named after it', async () => {
  write('photos/one.txt', '1')
  const download = await zipDownload(folderProvider(root), ['/photos/'])
  assert.equal(download.name, 'photos.zip')
  await drain(download.stream)
})

test('a download naming a path that is not there is refused before any stream exists', async () => {
  write('a.txt', 'a')
  await assert.rejects(zipDownload(folderProvider(root), ['/a.txt', '/gone.txt']), /"\/gone.txt" was not found/)
})

test('a read failing part-way errors the download stream rather than ending it as if complete', async () => {
  write('src/a.txt', 'alpha')
  write('src/b.txt', 'beta')
  const download = await zipDownload(folderProvider(root, { failRead: 'b.txt' }), ['/src/a.txt', '/src/b.txt'])
  await assert.rejects(drain(download.stream), /read failed/)
})

test('aborting a download stops it, and no further file is opened', async () => {
  for (const name of ['1.bin', '2.bin', '3.bin']) {
    write(`src/${name}`, Buffer.alloc(4 * 1024 * 1024, 5))
  }
  const base = folderProvider(root)
  const opened: string[] = []
  const provider: Provider = {
    ...base,
    readStream: (path) => {
      opened.push(path)
      return base.readStream(path)
    },
  }
  const controller = new AbortController()
  const download = await zipDownload(provider, ['/src/1.bin', '/src/2.bin', '/src/3.bin'], controller.signal)
  let received = 0
  await assert.rejects(
    (async () => {
      for await (const chunk of download.stream) {
        received += (chunk as Buffer).length
        controller.abort()
      }
    })(),
  )
  assert.ok(received > 0, 'the download had started')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(opened, ['/src/1.bin'])
})
