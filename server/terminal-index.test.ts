import assert from 'node:assert/strict'
import { test } from 'node:test'

import { LISTING_TTL_MS, type ListedTerminal, NotATerminalError, terminalIndex } from './terminal-index'

const ALPHA = { ref: 'term:node-a/terminal', space: 'alpha' }
const BETA = { ref: 'term:node-b/terminal', space: 'beta' }

/** A host listing what `held` holds now, counting each listing it is asked for. */
function host(held: ListedTerminal[]) {
  let clock = 0
  let calls = 0
  const index = terminalIndex(
    async () => {
      calls += 1
      return [...held]
    },
    () => clock,
  )
  return {
    index,
    calls: () => calls,
    advance(ms: number) {
      clock += ms
    },
  }
}

test('a listed terminal answers with its own space', async () => {
  const { index } = host([ALPHA, BETA])
  assert.equal(await index.spaceOf(ALPHA.ref), 'alpha')
  assert.equal(await index.spaceOf(BETA.ref), 'beta')
})

test('a ref no space lists is refused', async () => {
  const { index } = host([ALPHA])
  await assert.rejects(index.spaceOf('term:node-elsewhere/terminal'), NotATerminalError)
})

test('a fresh listing serves the lookups after it', async () => {
  const { index, calls } = host([ALPHA, BETA])
  await index.spaceOf(ALPHA.ref)
  await index.spaceOf(BETA.ref)
  assert.equal(calls(), 1)
})

test('lookups made together share one listing', async () => {
  const { index, calls } = host([ALPHA])
  await Promise.all([index.spaceOf(ALPHA.ref), index.spaceOf(ALPHA.ref)])
  assert.equal(calls(), 1)
})

test('a terminal newer than a fresh listing is listed again and found', async () => {
  const held = [ALPHA]
  const { index, calls } = host(held)
  await index.spaceOf(ALPHA.ref)
  held.push(BETA)
  assert.equal(await index.spaceOf(BETA.ref), 'beta')
  assert.equal(calls(), 2)
})

test('a terminal that is gone is refused once its listing is stale', async () => {
  const held = [ALPHA]
  const { index, advance } = host(held)
  await index.spaceOf(ALPHA.ref)
  held.length = 0
  advance(LISTING_TTL_MS)
  await assert.rejects(index.spaceOf(ALPHA.ref), NotATerminalError)
})

test('a remembered listing is used without listing again', async () => {
  const { index, calls } = host([ALPHA])
  index.remember([ALPHA])
  assert.equal(await index.spaceOf(ALPHA.ref), 'alpha')
  assert.equal(calls(), 0)
})

test('a listing that failed is not kept', async () => {
  let fail = true
  const index = terminalIndex(async () => {
    if (fail) {
      throw new Error('graph unavailable')
    }
    return [ALPHA]
  })
  await assert.rejects(index.spaceOf(ALPHA.ref), /graph unavailable/)
  fail = false
  assert.equal(await index.spaceOf(ALPHA.ref), 'alpha')
})
