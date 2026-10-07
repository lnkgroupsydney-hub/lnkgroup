import test from 'node:test';
import assert from 'node:assert/strict';
import { PrivateRequestLifetime, PrivateRequestFailure, StalePrivateRequest } from './request-lifetime.ts';

function deferred<T>() {
  let resolve!: (value:T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('401 and 403 clear the lifetime once and prevent a late successful response from restoring private data', async () => {
  for (const status of [401, 403]) {
    const delayed = deferred<Response>();
    let lateSignal: AbortSignal | null | undefined;
    const fetcher: typeof fetch = async (path, init) => {
      if (path === '/private/slow') { lateSignal = init?.signal; return delayed.promise; }
      return Response.json({error: 'Access changed'}, {status});
    };
    const scope = new PrivateRequestLifetime(fetcher);
    let accessLost = 0;
    const onAccessLost = () => { accessLost++; };
    const slow = scope.request('/private/slow', undefined, onAccessLost);
    const rejection = assert.rejects(slow, StalePrivateRequest);
    await assert.rejects(scope.request('/private/denied', undefined, onAccessLost), StalePrivateRequest);
    assert.equal(accessLost, 1);
    assert.equal(lateSignal?.aborted, true);
    delayed.resolve(Response.json({privateName: 'Must never reach the view'}));
    await rejection;
    assert.equal(accessLost, 1);
  }
});

test('unmount aborts requests and rejects responses even when the transport ignores cancellation', async () => {
  const delayed = deferred<Response>();
  let signal: AbortSignal | null | undefined;
  const scope = new PrivateRequestLifetime(async (_path, init) => { signal = init?.signal; return delayed.promise; });
  let lost = false;
  const pending = scope.request('/private', undefined, () => { lost = true; });
  const rejection = assert.rejects(pending, StalePrivateRequest);
  scope.dispose();
  assert.equal(signal?.aborted, true);
  delayed.resolve(Response.json({error: 'late denial'}, {status: 403}));
  await rejection;
  assert.equal(lost, false);
  await assert.rejects(scope.request('/private', undefined, () => {}), StalePrivateRequest);
});

test('react effect reactivation cannot accept a response from the disposed generation', async () => {
  const old = deferred<Response>();
  let calls = 0;
  const scope = new PrivateRequestLifetime(async () => ++calls === 1 ? old.promise : Response.json({revision: 2}));
  const pending = scope.request('/private', undefined, () => {});
  const rejection = assert.rejects(pending, StalePrivateRequest);
  scope.dispose(); scope.activate();
  assert.deepEqual(await scope.request('/private', undefined, () => {}), {revision: 2});
  old.resolve(Response.json({revision: 1}));
  await rejection;
});

test('business errors retain their status without clearing the workspace, and a failed legacy sign in keeps its form', async () => {
  const scope = new PrivateRequestLifetime(async path => Response.json({error: 'Synthetic failure'}, {status: path === '/login' ? 401 : 409}));
  let lost = false;
  await assert.rejects(scope.request('/revision-conflict', undefined, () => { lost = true; }), (error: unknown) => error instanceof PrivateRequestFailure && error.status === 409);
  await assert.rejects(scope.request('/login', undefined), (error: unknown) => error instanceof PrivateRequestFailure && error.status === 401);
  assert.equal(lost, false);
});


test('native browser fetch is invoked without the request lifetime as its receiver', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async function (this: unknown, _path, init) {
    if (this !== undefined) throw new TypeError('Illegal invocation');
    calls++;
    assert.equal(init?.credentials, 'same-origin');
    return Response.json({revision: 8});
  };
  const scope = new PrivateRequestLifetime(fetcher);
  assert.deepEqual(await scope.request('/private', undefined, () => {}), {revision: 8});
  assert.equal(calls, 1);
});
