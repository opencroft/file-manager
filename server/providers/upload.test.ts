import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { fsBackend } from './fs-upload'
import { spawnLocal } from './process'
import {
  type CommandRunner,
  commandBackend,
  isPartialUpload,
  stalePartials,
  type UploadBackend,
  upload,
  WRITE_SCRIPT,
} from './upload'

const run = promisify(execFile)

/** Programs run on this machine, as `docker exec` runs them in a container. */
const here: CommandRunner = {
  spawn: async (argv) => spawnLocal(argv),
  exec: (argv) => run(argv[0], argv.slice(1)),
}

/** The same, with every program starting `delay` late, as one does behind a slow transport. */
function startingLate(delay: string): CommandRunner {
  return { ...here, spawn: async (argv) => spawnLocal(['sh', '-c', `sleep ${delay}; exec "$@"`, 'sh', ...argv]) }
}

const backends: [string, UploadBackend][] = [
  ['through a shell', commandBackend(here)],
  ['on the file system', fsBackend],
]

/** `body` in chunks, the way a request body arrives. */
function chunked(body: Buffer, size = 64 * 1024): Readable {
  const chunks: Buffer[] = []
  for (let at = 0; at < body.length; at += size) {
    chunks.push(body.subarray(at, at + size))
  }
  return Readable.from(chunks)
}

/** `head`, then the error of a transfer cut off midway. */
function cutOffAfter(head: Buffer): Readable {
  return new Readable({
    read() {
      this.push(head)
      setImmediate(() => this.destroy(new Error('aborted')))
    },
  })
}

async function inTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-test-'))
  try {
    await fn(dir)
  } finally {
    fs.chmodSync(dir, 0o755)
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// Bodies small enough to sit whole in the pipe: the writer's stdin is flushed
// before the writer has read a byte.
for (const size of [100, 4096]) {
  test(`a ${size}-byte file is complete when the upload resolves, though the writer starts after the body is sent`, async () => {
    await inTempDir(async (dir) => {
      const body = randomBytes(size)
      const full = path.join(dir, 'late.bin')
      await upload(full, chunked(body), commandBackend(startingLate('0.3')))
      assert.ok(fs.readFileSync(full).equals(body), 'the target holds the whole body')
    })
  })
}

test('a body larger than any pipe buffer arrives whole through a shell', { timeout: 30_000 }, async () => {
  await inTempDir(async (dir) => {
    const body = randomBytes(24 * 1024 * 1024)
    const full = path.join(dir, 'large.bin')
    await upload(full, chunked(body), commandBackend(here))
    assert.ok(fs.readFileSync(full).equals(body), 'the target holds the whole body')
  })
})

test('a far side reporting fewer bytes than were sent fails the upload and leaves the target as it was', async () => {
  await inTempDir(async (dir) => {
    const full = path.join(dir, 'kept.txt')
    fs.writeFileSync(full, 'the earlier version')
    const shell = commandBackend(here)
    const losing: UploadBackend = {
      ...shell,
      write: async (body, partial, target) => ({ ...(await shell.write(body, partial, target)), size: 3 }),
    }
    await assert.rejects(upload(full, chunked(randomBytes(1024)), losing), /3 of 1024 bytes/)
    assert.equal(fs.readFileSync(full, 'utf8'), 'the earlier version')
    assert.deepEqual(fs.readdirSync(dir), ['kept.txt'])
  })
})

test('a hangup of the writer removes the partial file', async () => {
  await inTempDir(async (dir) => {
    const partial = path.join(dir, '.upload-000000000000.part')
    const writer = spawn('sh', ['-c', WRITE_SCRIPT, 'sh', partial, path.join(dir, 'target.bin')], {
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    writer.stdin.write(randomBytes(1024))
    const started = Date.now()
    while (!fs.existsSync(partial) && Date.now() - started < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.ok(fs.existsSync(partial), 'the partial file is there while the body arrives')
    const exited = new Promise((resolve) => writer.on('close', resolve))
    // A dropped ssh session hangs up the whole process group.
    process.kill(-(writer.pid as number), 'SIGHUP')
    await exited
    assert.equal(fs.existsSync(partial), false)
  })
})

test('a listing leaves out the partial files of uploads and nothing else', () => {
  assert.equal(isPartialUpload('.upload-0123456789ab.part'), true)
  for (const name of ['.upload-0123456789ab.part.txt', 'upload-0123456789ab.part', '.upload-notes.part', 'a.part']) {
    assert.equal(isPartialUpload(name), false, name)
  }
})

test('a listing counts as left behind only the partial files no upload has written for an hour', () => {
  const now = Date.parse('2026-01-10T12:00:00Z')
  const entry = (name: string, modified: string) => ({ name, modified })
  const stale = stalePartials(
    [
      entry('.upload-aaaaaaaaaaaa.part', '2026-01-10T10:59:59Z'),
      entry('.upload-bbbbbbbbbbbb.part', '2026-01-10T11:30:00Z'),
      entry('.upload-cccccccccccc.part', ''),
      entry('notes.txt', '2026-01-01T00:00:00Z'),
    ],
    now,
  )
  assert.deepEqual(
    stale.map((e) => e.name),
    ['.upload-aaaaaaaaaaaa.part'],
  )
})

for (const [label, backend] of backends) {
  test(`${label}: the target name is not taken while the body is still arriving`, async () => {
    await inTempDir(async (dir) => {
      const full = path.join(dir, 'slow.bin')
      const slow = new Readable({ read() {} })
      const done = upload(full, slow, backend)
      slow.push(Buffer.alloc(1024, 1))
      await new Promise((resolve) => setTimeout(resolve, 200))
      const seenDuringWrite = fs.existsSync(full)
      slow.push(Buffer.alloc(1024, 2))
      slow.push(null)
      await done
      assert.equal(seenDuringWrite, false)
      assert.equal(fs.statSync(full).size, 2048)
    })
  })

  test(`${label}: a transfer cut off midway rejects, keeps the file it would replace, and leaves nothing beside it`, async () => {
    await inTempDir(async (dir) => {
      const full = path.join(dir, 'kept.txt')
      fs.writeFileSync(full, 'the earlier version')
      await assert.rejects(upload(full, cutOffAfter(randomBytes(64 * 1024)), backend), /aborted/)
      assert.equal(fs.readFileSync(full, 'utf8'), 'the earlier version')
      assert.deepEqual(fs.readdirSync(dir), ['kept.txt'])
    })
  })

  test(`${label}: a transfer cut off midway leaves no file under a new name`, async () => {
    await inTempDir(async (dir) => {
      await assert.rejects(upload(path.join(dir, 'new.bin'), cutOffAfter(randomBytes(64 * 1024)), backend), /aborted/)
      assert.deepEqual(fs.readdirSync(dir), [])
    })
  })

  for (const size of [1024, 1024 * 1024]) {
    test(`${label}: a ${size}-byte upload into a folder that does not exist rejects with the reason`, async () => {
      await inTempDir(async (dir) => {
        const full = path.join(dir, 'missing', 'file.bin')
        await assert.rejects(upload(full, chunked(randomBytes(size)), backend), /missing/)
        assert.deepEqual(fs.readdirSync(dir), [])
      })
    })
  }

  test(`${label}: an empty upload creates an empty file`, async () => {
    await inTempDir(async (dir) => {
      const full = path.join(dir, 'empty.txt')
      await upload(full, Readable.from([]), backend)
      assert.equal(fs.statSync(full).size, 0)
    })
  })

  test(`${label}: a new file gets the mode a new file gets in its folder`, async () => {
    await inTempDir(async (dir) => {
      const reference = path.join(dir, 'reference.txt')
      fs.writeFileSync(reference, '')
      const full = path.join(dir, 'new.txt')
      await upload(full, chunked(Buffer.from('new')), backend)
      assert.equal(fs.statSync(full).mode, fs.statSync(reference).mode)
    })
  })

  test(`${label}: an existing file keeps its mode, its hard links and the symlink to it`, async () => {
    await inTempDir(async (dir) => {
      const real = path.join(dir, 'real.conf')
      fs.writeFileSync(real, 'the earlier version')
      fs.chmodSync(real, 0o640)
      const hardLink = path.join(dir, 'hard.conf')
      fs.linkSync(real, hardLink)
      const symlink = path.join(dir, 'link.conf')
      fs.symlinkSync(real, symlink)

      await upload(symlink, chunked(Buffer.from('through the symlink')), backend)
      assert.equal(fs.lstatSync(symlink).isSymbolicLink(), true)
      assert.equal(fs.readFileSync(hardLink, 'utf8'), 'through the symlink')

      await upload(real, chunked(Buffer.from('onto the file')), backend)
      assert.equal(fs.readFileSync(hardLink, 'utf8'), 'onto the file')
      assert.equal(fs.statSync(real).mode & 0o777, 0o640)
      assert.deepEqual(fs.readdirSync(dir).sort(), ['hard.conf', 'link.conf', 'real.conf'])
    })
  })

  test(`${label}: a writable file in a folder that takes no new file is written in place`, {
    skip: process.getuid?.() === 0 ? 'root writes into any folder, so the folder cannot refuse' : false,
  }, async () => {
    await inTempDir(async (dir) => {
      const full = path.join(dir, 'settings.json')
      fs.writeFileSync(full, 'the earlier version')
      fs.chmodSync(dir, 0o555)
      await upload(full, chunked(Buffer.from('written in place')), backend)
      assert.equal(fs.readFileSync(full, 'utf8'), 'written in place')
      assert.deepEqual(fs.readdirSync(dir), ['settings.json'])
    })
  })
}
