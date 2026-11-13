import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { promisify } from 'node:util'

import { createArgv, createCommand, refuseTaken } from './create'

const run = promisify(execFile)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-manager-create-'))
after(() => fs.rmSync(dir, { recursive: true, force: true }))

// The argv as `docker exec` and `wsl -e` run it: executed directly, with no
// shell of their own in between.
async function create(kind: 'directory' | 'file', target: string): Promise<void> {
  await refuseTaken(target, async () => {
    try {
      const [program, ...args] = createArgv(kind, target)
      await run(program, args)
    } catch (err) {
      throw new Error((err as { stderr?: string }).stderr || String(err))
    }
  })
}

test('a folder is created where nothing is', async () => {
  const target = path.join(dir, 'new folder')
  await create('directory', target)
  assert.ok(fs.statSync(target).isDirectory())
})

test('an empty file is created where nothing is', async () => {
  const target = path.join(dir, "it's new.txt")
  await create('file', target)
  assert.equal(fs.readFileSync(target, 'utf8'), '')
})

test('an existing file is refused and left as it was', async () => {
  const target = path.join(dir, 'kept.txt')
  fs.writeFileSync(target, 'contents')
  await assert.rejects(create('file', target), { message: '"kept.txt" already exists' })
  await assert.rejects(create('directory', target), { message: '"kept.txt" already exists' })
  assert.equal(fs.readFileSync(target, 'utf8'), 'contents')
})

test('an existing folder is refused and keeps what is in it', async () => {
  const target = path.join(dir, 'kept')
  fs.mkdirSync(target)
  fs.writeFileSync(path.join(target, 'inside.txt'), 'x')
  await assert.rejects(create('directory', target), { message: '"kept" already exists' })
  await assert.rejects(create('file', target), { message: '"kept" already exists' })
  assert.deepEqual(fs.readdirSync(target), ['inside.txt'])
})

test('a dangling symlink counts as taken', async () => {
  const target = path.join(dir, 'dangling')
  fs.symlinkSync(path.join(dir, 'missing'), target)
  await assert.rejects(create('file', target), { message: '"dangling" already exists' })
  assert.equal(fs.existsSync(path.join(dir, 'missing')), false)
})

test('any other failure is passed on as itself', async () => {
  await assert.rejects(create('file', path.join(dir, 'no-such-dir', 'x.txt')), (err: Error) => {
    assert.doesNotMatch(err.message, /already exists/)
    return true
  })
})

test('the argv form hands the path over unexpanded', async () => {
  const target = path.join(dir, 'argv "$1" $HOME `x`')
  await create('directory', target)
  assert.ok(fs.statSync(target).isDirectory())
})

// Why WSL creates through `wsl -e` and an argv: a command line wrapped in
// double quotes, as `wsl -- bash -c "<cmd>"` does, passes through the
// distro's default shell first, which expands the script's "$1" to nothing.
test('one more shell layer around the command line breaks the create', async () => {
  const target = path.join(dir, 'layered')
  const line = `sh -c "${createCommand('directory', target).replace(/"/g, '\\"')}"`
  await assert.rejects(run('sh', ['-c', line]))
  assert.equal(fs.existsSync(target), false)
})

test('the one-line command form, run by a shell, quotes the path', async () => {
  const target = path.join(dir, "quote ' and $HOME")
  await run('sh', ['-c', createCommand('file', target)])
  assert.ok(fs.existsSync(target))
})
