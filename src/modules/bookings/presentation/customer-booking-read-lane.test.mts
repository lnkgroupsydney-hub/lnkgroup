import test from 'node:test';
import assert from 'node:assert/strict';
import { CustomerBookingReadLane } from './customer-booking-read-lane.ts';
import { BookingRequestLifetime, StaleBookingRequest } from './request-lifetime.ts';

function deferred<T>() {
  let resolve!: (value:T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('slow customer reads survive repeated polling and manual refresh without starting overlapping requests', async () => {
  const lane = new CustomerBookingReadLane();
  const response = deferred<number>();
  let started = 0, active = 0, maxActive = 0, shown = 0;
  const read = () => lane.run(async () => {
    started++; active++; maxActive = Math.max(maxActive, active);
    try { shown = await response.promise; } finally { active--; }
  });
  const initial = read();
  // Interval and manual refresh occur before the original slow response arrives.
  const poll = read(), manual = read(), nextPoll = read();
  assert.equal(poll, initial); assert.equal(manual, initial); assert.equal(nextPoll, initial);
  assert.equal(started, 1); assert.equal(shown, 0);
  response.resolve(7);
  await Promise.all([initial, poll, manual, nextPoll]);
  assert.equal(shown, 7); assert.equal(maxActive, 1);
  await read();
  assert.equal(started, 2); assert.equal(maxActive, 1);
});

test('failed reads release the lane so a later retry can run', async () => {
  const lane = new CustomerBookingReadLane();
  await assert.rejects(lane.run(async () => { throw Object.assign(new Error('Temporary outage'), {status:503}); }), /Temporary outage/);
  let retried = false;
  await lane.run(async () => { retried = true; });
  assert.equal(retried, true);
});

test('an old read finishing after cleanup cannot release the next mounted read', async () => {
  const lane = new CustomerBookingReadLane();
  const old = deferred<void>(), current = deferred<void>();
  const oldRead = lane.run(() => old.promise);
  lane.clear();
  const currentRead = lane.run(() => current.promise);
  old.resolve(); await oldRead;
  let duplicateStarted = false;
  const duplicate = lane.run(async () => { duplicateStarted = true; });
  assert.equal(duplicate, currentRead); assert.equal(duplicateStarted, false);
  current.resolve(); await currentRead;
});

test('GET or consent denial fences all pending customer reads and consent responses and prevents further reads', async () => {
  for (const status of [401,403]) for (const deniedEndpoint of ['read','consent']) {
    const lane = new CustomerBookingReadLane(), lifetime = new BookingRequestLifetime();
    const slowRead = deferred<object>(), slowConsent = deferred<object>();
    const signals: AbortSignal[] = [];
    let accessLost = 0, readsShown = 0, consentsSaved = 0, laterReads = 0;
    const lost = () => { accessLost++; };
    const read = lane.run(async () => {
      await lifetime.run(signal => { signals.push(signal); return slowRead.promise; },lost);
      readsShown++;
    });
    const consent = lifetime.run(signal => { signals.push(signal); return slowConsent.promise; },lost).then(() => { consentsSaved++; });
    const pending = [assert.rejects(read,StaleBookingRequest),assert.rejects(consent,StaleBookingRequest)];
    await assert.rejects(lifetime.run(async () => { throw Object.assign(new Error(`${deniedEndpoint} access denied`),{status}); },lost),StaleBookingRequest);
    assert.equal(accessLost,1); assert.ok(signals.every(signal=>signal.aborted));
    slowRead.resolve({detail:'late private GET'}); slowConsent.resolve({detail:'late saved consent'});
    await Promise.all(pending);
    assert.equal(readsShown,0); assert.equal(consentsSaved,0);
    await assert.rejects(lane.run(async () => { await lifetime.run(async () => { laterReads++; },lost); }),StaleBookingRequest);
    assert.equal(laterReads,0); assert.equal(accessLost,1);
  }
});

test('temporary read and consent failures keep the request scope active for retries', async () => {
  for (const failure of [Object.assign(new Error('Temporary outage'),{status:503}),new DOMException('Timed out','TimeoutError')]) {
    const lane = new CustomerBookingReadLane(), lifetime = new BookingRequestLifetime();
    let accessLost = false;
    const lost = () => { accessLost = true; };
    await assert.rejects(lane.run(async () => { await lifetime.run(async () => { throw failure; },lost); }));
    await assert.rejects(lifetime.run(async () => { throw failure; },lost));
    const saved = await lifetime.run(async () => ({saved:true}),lost);
    assert.deepEqual(saved,{saved:true}); assert.equal(accessLost,false);
    await lane.run(async () => { await lifetime.run(async () => ({detail:'still available'}),lost); });
  }
});
