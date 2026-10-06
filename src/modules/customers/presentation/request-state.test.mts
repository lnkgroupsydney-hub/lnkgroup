import test from 'node:test'
import assert from 'node:assert/strict'
import { ReadLane, MutationAttempt } from './request-state.ts'

test('a newer search/detail request invalidates a late previous response and clear cancels all reads', () => {
  const lane = new ReadLane(), first = lane.begin(), second = lane.begin()
  assert.equal(first.signal.aborted, true); assert.equal(first.current(), false); assert.equal(second.current(), true)
  lane.cancel(); assert.equal(second.signal.aborted, true); assert.equal(second.current(), false)
})

test('uncertain saves reuse the same key and payload and reject edited retries', () => {
  const attempt = new MutationAttempt<{ name: string }>()
  let generated = 0
  const key = () => `synthetic-key-${++generated}`
  const first = attempt.prepare({ name: 'Synthetic customer' }, key)
  assert.strictEqual(attempt.prepare({ name: 'Synthetic customer' }, key), first)
  assert.equal(generated, 1)
  assert.throws(() => attempt.prepare({ name: 'Edited customer' }, key), /Retry the unchanged details/)
  attempt.clear()
  assert.equal(attempt.prepare({ name: 'Edited customer' }, key).idempotencyKey, 'synthetic-key-2')
})
