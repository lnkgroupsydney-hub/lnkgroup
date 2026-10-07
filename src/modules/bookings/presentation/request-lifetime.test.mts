import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingRequestLifetime, StaleBookingRequest } from './request-lifetime.ts';

function deferred<T>() {
  let resolve!: (value:T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('booking denial aborts all list/detail/change/save requests and suppresses every stale completion', async () => {
  for (const status of [401, 403]) {
    const scope = new BookingRequestLifetime();
    let lost = 0;
    const completed = deferred<object>();
    const signals: AbortSignal[] = [];
    const pending = Array.from({length: 4}, () => scope.run(signal => { signals.push(signal); return completed.promise; }, () => { lost++; }));
    const rejections = pending.map(request => assert.rejects(request, StaleBookingRequest));
    await assert.rejects(scope.run(async () => { throw {status}; }, () => { lost++; }), StaleBookingRequest);
    assert.equal(lost, 1);
    assert.ok(signals.every(signal => signal.aborted));
    completed.resolve({privateDetail: 'Suppressed'});
    await Promise.all(rejections);
    await assert.rejects(scope.run(async () => ({notRequested: true}), () => { lost++; }), StaleBookingRequest);
    assert.equal(lost, 1);
  }
});

test('booking view unmount invalidates slow commands without confusing cancellation with access loss', async () => {
  const scope = new BookingRequestLifetime();
  const deferredCommand = deferred<object>();
  let lost = false;
  const pending = scope.run(() => deferredCommand.promise, () => { lost = true; });
  const rejection = assert.rejects(pending, StaleBookingRequest);
  scope.dispose(); scope.activate();
  assert.deepEqual(await scope.run(async () => ({revision: 3}), () => {}), {revision: 3});
  deferredCommand.resolve({revision: 2});
  await rejection;
  assert.equal(lost, false);
});

test('booking revision conflicts and response loss stay available to the same mutation retry', async () => {
  const scope = new BookingRequestLifetime();
  let lost = false;
  await assert.rejects(scope.run(async () => { throw Object.assign(new Error('Revision changed'), {status: 409}); }, () => { lost = true; }), /Revision changed/);
  await assert.rejects(scope.run(async () => { throw new Error('Response lost'); }, () => { lost = true; }), /Response lost/);
  assert.deepEqual(await scope.run(async () => ({sameKey: 'preserved'}), () => { lost = true; }), {sameKey: 'preserved'});
  assert.equal(lost, false);
});
