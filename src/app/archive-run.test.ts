import assert from 'node:assert/strict'
import { test } from 'node:test'

import { type ArchiveProgress, readArchiveRun } from './archive-run'

// An answer arriving in the chunks given, which need not end on a line.
function answer(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
  return new Response(body, { status })
}

test('progress lines are reported and the result is answered, however the lines are cut', async () => {
  const seen: ArchiveProgress[] = []
  const result = await readArchiveRun<{ path: string }>(
    answer([
      '{"progress":{"done":1,"tot',
      'al":4}}\n{"progress":{"done":4,"total":4}}\n{"result":{"pa',
      'th":"/a.zip"}}\n',
    ]),
    (p) => seen.push(p),
  )
  assert.deepEqual(seen, [
    { done: 1, total: 4 },
    { done: 4, total: 4 },
  ])
  assert.deepEqual(result, { path: '/a.zip' })
})

test('an error line rejects with its message', async () => {
  await assert.rejects(
    readArchiveRun(answer(['{"error":"no space left"}\n']), () => {}),
    /no space left/,
  )
})

test('a refusal before the run rejects with the message the route gave', async () => {
  await assert.rejects(
    readArchiveRun(new Response(JSON.stringify({ error: 'Space "x" is not one of yours' }), { status: 403 }), () => {}),
    /not one of yours/,
  )
})

test('an answer cut off before its last line rejects', async () => {
  await assert.rejects(
    readArchiveRun(answer(['{"progress":{"done":1,"total":4}}\n']), () => {}),
    /ended before/,
  )
})

test('a last line without a newline still counts', async () => {
  assert.deepEqual(await readArchiveRun(answer(['{"result":{"ok":true}}']), () => {}), { ok: true })
})
