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


test('a remounted customer draft retries its uncertain mutation with the original key and revision', () => {
  const first = new MutationAttempt<{ reason: string; expectedRevision: number }>()
  const payload = first.prepare({ reason: 'Reviewed source', expectedRevision: 4 }, () => 'original-key')
  const snapshot = first.snapshot()!
  const restored = new MutationAttempt(snapshot)
  first.clear()
  assert.deepEqual(restored.prepare({ reason: 'Reviewed source', expectedRevision: 4 }, () => 'wrong-new-key'), payload)
  assert.throws(() => restored.prepare({ reason: 'Reviewed source', expectedRevision: 5 }, () => 'wrong-new-key'), /Retry the unchanged details/)
  assert.equal(snapshot.value.idempotencyKey, 'original-key')
  restored.clear()
  assert.equal(restored.snapshot(), null)
})

test('mutation snapshots are independent of the instance and later snapshots', () => {
  const attempt = new MutationAttempt<{ name: string }>()
  attempt.prepare({ name: 'Customer A' }, () => 'same-key')
  const snapshot = attempt.snapshot()!
  snapshot.value.name = 'Changed outside the request'
  assert.equal(attempt.snapshot()!.value.name, 'Customer A')
  const restored = new MutationAttempt(attempt.snapshot())
  attempt.clear()
  assert.equal(restored.snapshot()!.value.name, 'Customer A')
})

test('nested reviewed candidate revisions and property address remain immutable across retries', () => {
  const attempt = new MutationAttempt<{ decision: { reviewedCandidates: { id: string; revision: number }[] }; property: { address: { unit: string } } }>()
  const input = { decision: { reviewedCandidates: [{ id: 'candidate-a', revision: 2 }] }, property: { address: { unit: 'Unit 4' } } }
  attempt.prepare(input, () => 'fixed-review-key')
  input.decision.reviewedCandidates[0].revision = 99
  input.property.address.unit = 'Unit 5'
  const snapshot = attempt.snapshot()!
  assert.equal(snapshot.value.decision.reviewedCandidates[0].revision, 2)
  assert.equal(snapshot.value.property.address.unit, 'Unit 4')
  const remounted = new MutationAttempt(snapshot)
  snapshot.value.decision.reviewedCandidates[0].revision = 88
  assert.equal(remounted.snapshot()!.value.decision.reviewedCandidates[0].revision, 2)
  assert.equal(remounted.snapshot()!.value.idempotencyKey, 'fixed-review-key')
})
