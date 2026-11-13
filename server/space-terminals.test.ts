import assert from 'node:assert/strict'
import { test } from 'node:test'

import { LISTING_TTL_MS, NotInSpaceError, spaceTerminals } from './space-terminals'

const ALPHA = 'term:node-a/terminal'
const BETA = 'term:node-b/terminal'

/** A host whose spaces hold what `held` says now, counting each listing it is asked for. */
function host(held: Record<string, string[]>) {
  let clock = 0
  const calls: string[] = []
  const terminals = spaceTerminals(
    async (space) => {
      calls.push(space)
      return held[space] ?? []
    },
    () => clock,
  )
  return {
    terminals,
    calls,
    advance(ms: number) {
      clock += ms
    },
  }
}

test('a terminal the space lists is accepted', async () => {
  const { terminals } = host({ alpha: [ALPHA] })
  await terminals.require('alpha', ALPHA)
})

test("another space's terminal is refused", async () => {
  const { terminals } = host({ alpha: [ALPHA], beta: [BETA] })
  await assert.rejects(terminals.require('alpha', BETA), NotInSpaceError)
})

test('a fresh listing serves the calls after it', async () => {
  const { terminals, calls } = host({ alpha: [ALPHA] })
  await terminals.require('alpha', ALPHA)
  await terminals.require('alpha', ALPHA)
  assert.deepEqual(calls, ['alpha'])
})

test('calls made together share one listing', async () => {
  const { terminals, calls } = host({ alpha: [ALPHA] })
  await Promise.all([terminals.require('alpha', ALPHA), terminals.require('alpha', ALPHA)])
  assert.deepEqual(calls, ['alpha'])
})

test('a terminal newer than a fresh listing is listed again and accepted', async () => {
  const held = { alpha: [ALPHA] }
  const { terminals, calls } = host(held)
  await terminals.require('alpha', ALPHA)
  held.alpha.push(BETA)
  await terminals.require('alpha', BETA)
  assert.deepEqual(calls, ['alpha', 'alpha'])
})

test('a terminal that left the space is refused once its listing is stale', async () => {
  const held = { alpha: [ALPHA] }
  const { terminals, advance } = host(held)
  await terminals.require('alpha', ALPHA)
  held.alpha = []
  advance(LISTING_TTL_MS)
  await assert.rejects(terminals.require('alpha', ALPHA), NotInSpaceError)
})

test('a remembered listing is used without listing again', async () => {
  const { terminals, calls } = host({ alpha: [ALPHA] })
  terminals.remember('alpha', [ALPHA])
  await terminals.require('alpha', ALPHA)
  assert.deepEqual(calls, [])
})

test('a listing that failed is not kept', async () => {
  let fail = true
  const terminals = spaceTerminals(async () => {
    if (fail) {
      throw new Error('graph unavailable')
    }
    return [ALPHA]
  })
  await assert.rejects(terminals.require('alpha', ALPHA), /graph unavailable/)
  fail = false
  await terminals.require('alpha', ALPHA)
})
