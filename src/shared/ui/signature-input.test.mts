import test from 'node:test';
import assert from 'node:assert/strict';
import { createSignatureInput, signaturePoint, type SignaturePoint } from './signature-input.ts';

const a = { x: .1, y: .1 }, b = { x: .2, y: .3 }, c = { x: .4, y: .2 };
const foreign = { x: .9, y: .9 };

test('only the initiating finger can move, cancel or finish its stroke', () => {
  const input = createSignatureInput();
  assert.equal(input.begin(1, a, []), true);
  assert.equal(input.move(1, b, []), true);
  assert.equal(input.begin(2, foreign, []), false);
  assert.equal(input.move(2, foreign, []), false);
  assert.equal(input.cancel(2), false);
  assert.equal(input.finish(2, foreign, []), null);
  assert.deepEqual(input.preview(), [a, b]);
  assert.deepEqual(input.finish(1, c, []), [a, b, c]);
  assert.equal(input.finish(1, c, []), null);
});

test('capture loss or cancellation discards the unfinished stroke and ignores late events', () => {
  const input = createSignatureInput();
  input.begin(1, a, []);
  input.move(1, b, []);
  assert.equal(input.cancel(1), true);
  assert.equal(input.move(1, c, []), false);
  assert.equal(input.finish(1, c, []), null);
  assert.equal(input.begin(2, a, []), true);
  assert.equal(input.cancel(1), false);
  assert.deepEqual(input.finish(2, b, []), [a, b]);
});

test('disabling while drawing cannot save the active stroke or resurrect it after re-enabling', () => {
  for (const action of ['move', 'finish', 'begin'] as const) {
    const input = createSignatureInput();
    input.begin(1, a, []);
    input.move(1, b, []);
    input[action](1, c, [], true);
    assert.equal(input.source(), null);
    assert.equal(input.finish(1, c, []), null);
    assert.equal(input.begin(2, a, [], true), false);
    assert.equal(input.begin(2, a, []), true);
    assert.deepEqual(input.finish(2, b, []), [a, b]);
  }
});

test('clear, blur or external value replacement cancel pending input without mutating stored strokes', () => {
  const saved = [[{ ...a }, { ...b }]];
  const before = structuredClone(saved);
  const input = createSignatureInput();
  input.begin(1, c, saved);
  input.move(1, foreign, saved);
  input.cancel();
  assert.equal(input.finish(1, foreign, []), null);
  assert.deepEqual(saved, before);
  input.begin(2, a, []);
  assert.deepEqual(input.finish(2, b, []), [a, b]);
});

test('keyboard and pointer inputs cannot append to or finish each other', () => {
  const input = createSignatureInput();
  input.begin('keyboard', a, []);
  assert.equal(input.begin(1, foreign, []), false);
  assert.equal(input.move(1, foreign, []), false);
  assert.equal(input.finish(1, foreign, []), null);
  input.move('keyboard', b, []);
  input.move('keyboard', c, []);
  assert.deepEqual(input.finish('keyboard', null, []), [a, b, c]);
  input.begin(1, a, []);
  assert.equal(input.move('keyboard', foreign, []), false);
  assert.equal(input.finish('keyboard', null, []), null);
  assert.deepEqual(input.finish(1, b, []), [a, b]);
});

test('point and stroke limits preserve the last allowed stroke without accepting overflow', () => {
  const input = createSignatureInput();
  const saved: SignaturePoint[][] = [Array.from({ length: 1998 }, () => ({ ...a }))];
  assert.equal(input.begin(1, b, saved), true);
  assert.equal(input.move(1, c, saved), true);
  assert.equal(input.move(1, foreign, saved), false);
  const last = input.finish(1, foreign, saved);
  assert.deepEqual(last, [b, c]);
  assert.equal(input.begin(2, a, [...saved, last!]), false);
  assert.equal(input.begin(2, a, Array.from({ length: 100 }, () => [a, b])), false);
});

test('a one-point keyboard gesture or cancelled gesture is not committed as a stroke', () => {
  const input = createSignatureInput();
  input.begin('keyboard', a, []);
  assert.equal(input.finish('keyboard', null, []), null);
  input.begin(1, a, []);
  input.cancel();
  assert.deepEqual(input.preview(), []);
});

test('invalid coordinates cannot corrupt a stroke and input values are copied', () => {
  const input = createSignatureInput();
  for (const invalid of [{ x: NaN, y: 0 }, { x: 1.1, y: 0 }, { x: 0, y: -1 }]) assert.equal(input.begin(1, invalid, []), false);
  const start = { ...a };
  input.begin(1, start, []);
  start.x = .8;
  assert.equal(input.move(1, { x: Infinity, y: .5 }, []), false);
  assert.deepEqual(input.finish(1, b, []), [a, b]);
});

test('resized mobile pads use normalized coordinates and clamp captured movement outside edges', () => {
  assert.deepEqual(signaturePoint(90, 60, { left: 10, top: 20, width: 320, height: 160 }), { x: .25, y: .25 });
  assert.deepEqual(signaturePoint(170, 100, { left: 10, top: 20, width: 640, height: 320 }), { x: .25, y: .25 });
  assert.deepEqual(signaturePoint(-10, 500, { left: 10, top: 20, width: 320, height: 160 }), { x: 0, y: 1 });
  assert.equal(signaturePoint(10, 10, { left: 0, top: 0, width: 0, height: 100 }), null);
  assert.equal(signaturePoint(Infinity, 10, { left: 0, top: 0, width: 100, height: 100 }), null);
});
