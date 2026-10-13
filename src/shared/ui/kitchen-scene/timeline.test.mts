import assert from 'node:assert/strict'
import test from 'node:test'
import { kitchenChapterProgress, kitchenTimeline } from './timeline.ts'

test('chapter centres, click/hash targets and active steps use the same reading point at either chapter height', () => {
  for (const height of [590.4, 820, 1200]) {
    const centres = Array.from({ length: 10 }, (_, index) => 250 + index * height)
    for (let index = 0; index < centres.length; index += 1) {
      const progress = kitchenChapterProgress(centres, centres[index])
      assert.equal(progress, Math.min(9, index + 0.5))
      assert.equal(Math.floor(progress), index)
      if (index < 9) {
        const boundary = (centres[index] + centres[index + 1]) / 2
        assert.equal(Math.floor(kitchenChapterProgress(centres, boundary - 0.01)), index)
        assert.equal(Math.floor(kitchenChapterProgress(centres, boundary + 0.01)), index + 1)
      }
    }
  }
})

test('reading progress remains continuous through unequal content heights and invariant under viewport translation', () => {
  const centres = [400, 1050, 1725, 2540, 3190, 3840, 4570, 5220, 5940, 6610]
  let previous = 0
  for (let target = -100; target <= 7500; target += 5) {
    const progress = kitchenChapterProgress(centres, target)
    assert.ok(progress >= previous)
    assert.ok(progress - previous < 0.51)
    assert.equal(kitchenChapterProgress(centres.map((centre) => centre - 270), target - 270), progress)
    previous = progress
  }
  assert.equal(kitchenChapterProgress([], 360), 0)
  assert.equal(kitchenChapterProgress([NaN, 100], 360), 0)
  assert.equal(kitchenChapterProgress(centres, Infinity), 0)
})

test('every timeline output is finite and bounded including untrusted progress', () => {
  const inputs = [NaN, Infinity, -Infinity, -20, 20, ...Array.from({ length: 1801 }, (_, index) => index / 200)]
  for (const input of inputs) {
    for (const [key, value] of Object.entries(kitchenTimeline(input))) {
      assert.ok(Number.isFinite(value), `${key} must be finite at ${input}`)
      assert.ok(value >= 0 && value <= (key === 'progress' ? 9 : 1), `${key} must be bounded at ${input}`)
    }
  }
})

test('all operations are continuous at chapter and operation boundaries', () => {
  const boundaries = [0, 0.45, 1, 2, 2.45, 2.84, 3, 3.1, 3.3, 3.65, 4, 4.5, 5, 5.05, 5.15, 5.8, 5.85, 6, 6.47, 6.48, 6.95, 6.96, 7, 7.4, 7.7, 8, 8.45, 9]
  for (const boundary of boundaries) {
    const before = kitchenTimeline(boundary - 0.000001)
    const after = kitchenTimeline(boundary + 0.000001)
    for (const key of Object.keys(before) as (keyof typeof before)[]) {
      assert.ok(Math.abs(before[key] - after[key]) < 0.00002, `${key} must not jump at ${boundary}`)
    }
  }
})

test('reverse and fast arbitrary jumps reproduce exactly the same absolute scene', () => {
  const positions = [0, 1.5, 2.5, 3.5, 4.5, 5.5, 6.2, 6.72, 7.5, 8.5, 9]
  const forward = new Map(positions.map((position) => [position, kitchenTimeline(position)]))
  for (const position of [...positions.toReversed(), 3.5, 9, 1.5, 7.5, 0, 6.72, 2.5]) {
    assert.deepEqual(kitchenTimeline(position), forward.get(position))
  }
})

test('preparation keeps patch/sanding before paint and both finish coats remain ordered', () => {
  const prepare = kitchenTimeline(3.5)
  assert.equal(prepare.patch, 1)
  assert.ok(prepare.sanding > 0)
  assert.equal(prepare.primer, 0)
  assert.equal(prepare.firstCoat, 0)
  assert.equal(prepare.secondCoat, 0)
  const base = kitchenTimeline(5.5)
  assert.ok(base.primer > 0 && base.primer < 1)
  assert.equal(base.firstCoat, 0)
  assert.equal(base.secondCoat, 0)
  assert.equal(kitchenTimeline(6.48).firstCoat, 1)
  assert.equal(kitchenTimeline(6.48).secondCoat, 0)
  assert.ok(kitchenTimeline(6.72).secondCoat > 0 && kitchenTimeline(6.72).secondCoat < 1)
  const cure = kitchenTimeline(7.5)
  assert.equal(cure.firstCoat, 1)
  assert.equal(cure.secondCoat, 1)
  assert.equal(cure.cure, 1)
})

test('removal and reassembly stay monotonic and completion restores doors/hardware/protection', () => {
  let removed = 0
  let reassembled = 1
  for (let offset = 0; offset <= 1; offset += 0.01) {
    const removal = kitchenTimeline(1 + offset).separated
    const reassembly = kitchenTimeline(8 + offset).separated
    assert.ok(removal >= removed)
    assert.ok(reassembly <= reassembled)
    removed = removal
    reassembled = reassembly
  }
  assert.equal(kitchenTimeline(0).separated, 0)
  assert.equal(kitchenTimeline(2).separated, 1)
  const complete = kitchenTimeline(9)
  assert.equal(complete.separated, 0)
  assert.equal(complete.masking, 0)
  assert.equal(complete.closeup, 0)
  assert.equal(complete.patch, 0)
  assert.equal(complete.cure, 0)
  assert.equal(complete.firstCoat, 1)
  assert.equal(complete.secondCoat, 1)
})

test('closeups use a restrained amplitude and broad entry/return intervals', () => {
  let previous = kitchenTimeline(0).closeup
  let steepest = 0
  let maximum = 0
  for (let index = 1; index <= 900; index += 1) {
    const closeup = kitchenTimeline(index / 100).closeup
    steepest = Math.max(steepest, Math.abs(closeup - previous) / 0.01)
    maximum = Math.max(maximum, closeup)
    previous = closeup
  }
  assert.ok(maximum <= 0.76)
  assert.ok(maximum >= 0.7, 'preparation must still expose the same working surface')
  assert.ok(steepest < 1.35, 'shorter chapters must not cause the old abrupt zoom')
  assert.ok(kitchenTimeline(2.6).closeup > 0)
  assert.ok(kitchenTimeline(4.3).closeup > 0)
})
