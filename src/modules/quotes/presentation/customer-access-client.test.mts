import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CustomerAccessLifetime, consumeQuoteHandoff, parseCustomerAccess, parseCustomerChallenge, readCurrentCustomerRequest } from './customer-access-client.ts';
import { parseQuoteContactPrefill, startNewQuote, checkNewQuoteSession, resumeBrowserDraft, QuoteEntryTransitionError, isPendingFirstSave, pendingFirstSaveMatches } from './customer-access-client.ts';
const id = 'b65b5359-f90d-45be-b4b9-c249aa7f6daf';
const summary = { id, reference: 'RQ-1234567890ABCDEF1234567890ABCDEF', status: 'draft', savedAt: '2026-10-12T00:00:00Z', revision: 2 };
const state = { customer: { email: 'fixture@example.test', expiresAt: '2026-10-12T01:00:00Z' }, requests: [summary], currentRequestId: id };
test('customer access validates email, owner-scoped summaries and selected membership before rendering', () => {
  assert.deepEqual(parseCustomerAccess(state), state);
  assert.deepEqual(parseCustomerAccess({ customer: null, requests: [], currentRequestId: null }), { customer: null, requests: [], currentRequestId: null });
  for (const invalid of [null, {}, { ...state, customer: { email: '', expiresAt: 'bad' } }, { ...state, currentRequestId: '9c26b6f4-3f62-4a68-95ab-fbf3f64231a6' }, { ...state, requests: [summary, summary] }, { ...state, requests: [{ ...summary, status: 'confirmed' }] }, { ...state, customer: null }]) assert.throws(() => parseCustomerAccess(invalid));
  const parsed = parseCustomerAccess({ ...state, requests: [{ ...summary, payload: { contact: { email: 'other@example.test' } }, token: 'private' }] });
  assert.deepEqual(parsed.requests, [summary]);
});
test('verification countdown accepts bounded provider durations and rejects impossible timing', () => {
  assert.deepEqual(parseCustomerChallenge({ sent: true, retryAfterSeconds: 60, expiresInSeconds: 900 }), { sent: true, retryAfterSeconds: 60, expiresInSeconds: 900 });
  for (const invalid of [{ sent: false, retryAfterSeconds: 60, expiresInSeconds: 900 }, { sent: true, retryAfterSeconds: -1, expiresInSeconds: 900 }, { sent: true, retryAfterSeconds: 60, expiresInSeconds: 0 }, { sent: true, retryAfterSeconds: 60, expiresInSeconds: Infinity }]) assert.throws(() => parseCustomerChallenge(invalid));
});
test('late quote results after session changes or logout cannot restore private views', async () => {
  const lifetime = new CustomerAccessLifetime();
  let release!: (value: string) => void;
  const slow = new Promise<string>(resolve => { release = resolve; });
  let displayed: string | null = null;
  const version = lifetime.begin();
  const loading = slow.then(result => { if (lifetime.accepts(version)) displayed = result; });
  lifetime.invalidate(); release('private quote from prior account'); await loading;
  assert.equal(displayed, null);
  const latest = lifetime.begin(); assert.equal(lifetime.accepts(latest), true);
  lifetime.close(); assert.equal(lifetime.accepts(latest), false);
  lifetime.reopen(); assert.equal(lifetime.accepts(latest), false);
});
test('previous-domain recovery consumes a short-lived token from the fragment and removes it from history', () => {
  const token = 'a'.repeat(64); const replacements: string[] = [];
  assert.equal(consumeQuoteHandoff({ hash: `#restore=${token}`, pathname: '/quote/start', search: '?service=cabinet-painting' }, url => replacements.push(url)), token);
  assert.deepEqual(replacements, ['/quote/start?service=cabinet-painting']);
  assert.throws(() => consumeQuoteHandoff({ hash: '#restore=invalid-secret', pathname: '/quote/start', search: '' }, url => replacements.push(url)), /invalid/);
  assert.equal(replacements.at(-1), '/quote/start');
  assert.equal(consumeQuoteHandoff({ hash: '#other', pathname: '/quote/start', search: '' }, url => replacements.push(url)), null);
});
test('recovery rejects a selected quote changed by another tab instead of displaying a different record', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get('x-lk-quote-request-id'), id);
    return Response.json({ request: { ...summary, id: '9c26b6f4-3f62-4a68-95ab-fbf3f64231a6', mode: 'live', companyId: 'lk-group', createdAt: summary.savedAt, consentVersion: 'quote-storage-review-v1', customerId: null, reviewRequestedAt: null, payload: { contact: { name: 'Fixture', email: 'fixture@example.test', phone: '', siteAddress: 'Fixture street', suburb: 'Sydney', postcode: '2000', details: '', consent: true }, service: null } } });
  };
  try { await assert.rejects(readCurrentCustomerRequest(id), /changed in another tab/); } finally { globalThis.fetch = original; }
});

import { canStartAnotherQuote, canRecoverExpiredCustomerAccess, EMPTY_CUSTOMER_ACCESS, customerMutation } from './customer-access-client.ts';
test('another quote can start only after the exact saved quote is linked and current', () => {
  const request = { id: 'b65b5359-f90d-45be-b4b9-c249aa7f6daf', email: 'fixture@example.test' };
  const access = { customer: { email: request.email, expiresAt: '2026-10-13T23:00:00Z' }, currentRequestId: request.id, requests: [{ id: request.id, reference: 'RQ-1234567890ABCDEF1234567890ABCDEF', status: 'draft' as const, savedAt: '2026-10-13T00:00:00Z', revision: 1 }] };
  assert.equal(canStartAnotherQuote(request, access, false), true);
  assert.equal(canStartAnotherQuote(request, access, true), false);
  assert.equal(canStartAnotherQuote(null, access, false), false);
  assert.equal(canStartAnotherQuote(request, { ...access, requests: [] }, false), false);
  assert.equal(canStartAnotherQuote(request, { ...access, currentRequestId: null }, false), false);
  assert.equal(canStartAnotherQuote(request, { ...access, customer: null }, false), false);
  assert.equal(canStartAnotherQuote(request, { ...access, customer: { ...access.customer, email: 'other@example.test' } }, false), false);
});

test('expired-access recovery is limited to an empty unchanged form and never replaces the linked-quote requirement', () => {
  assert.equal(canRecoverExpiredCustomerAccess(null, EMPTY_CUSTOMER_ACCESS, false, true), true);
  assert.equal(canRecoverExpiredCustomerAccess(null, EMPTY_CUSTOMER_ACCESS, false, false), false);
  assert.equal(canRecoverExpiredCustomerAccess(null, EMPTY_CUSTOMER_ACCESS, true, true), false);
  assert.equal(canRecoverExpiredCustomerAccess({ id }, EMPTY_CUSTOMER_ACCESS, false, true), false);
  assert.equal(canRecoverExpiredCustomerAccess(null, state, false, true), false);
  assert.equal(canRecoverExpiredCustomerAccess(null, { ...EMPTY_CUSTOMER_ACCESS, requests: [summary] }, false, true), false);
  assert.equal(canRecoverExpiredCustomerAccess(null, { ...EMPTY_CUSTOMER_ACCESS, currentRequestId: id }, false, true), false);
  assert.equal(canStartAnotherQuote({ id, email: 'fixture@example.test' }, EMPTY_CUSTOMER_ACCESS, false), false);
});

test('explicit expired-access recovery preserves writing capability and invalidates older private responses', async () => {
  const originalFetch = globalThis.fetch;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let writes = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (name: string, options: { mode: string }, action: () => Promise<unknown>) => {
    assert.equal(name, 'lk-live-quote-session'); assert.equal(options.mode, 'exclusive'); return action();
  } } } });
  globalThis.fetch = async (url, init) => {
    writes++;
    assert.equal(url, '/api/quote/requests/customer/logout');
    assert.equal(init?.method, 'POST'); assert.equal(init?.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(String(init?.body)), { preserveWritingSession: true });
    return Response.json({ signedOut: true, writingSessionPreserved: true });
  };
  try {
    const lifetime = new CustomerAccessLifetime();
    const oldRead = lifetime.begin();
    assert.equal(writes, 0);
    const recovery = lifetime.begin();
    const result = await customerMutation('logout', { preserveWritingSession: true });
    assert.equal(result.signedOut, true); assert.equal(result.writingSessionPreserved, true);
    assert.equal(writes, 1); assert.equal(lifetime.accepts(oldRead), false); assert.equal(lifetime.accepts(recovery), true);
    lifetime.invalidate(); assert.equal(lifetime.accepts(recovery), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});

test('fresh contact prefill whitelists three validated fields and rejects invalid legacy contact', () => {
  const contact = { name: 'Fixture Customer', email: 'fixture@example.test', phone: '0491 570 159' };
  assert.deepEqual(parseQuoteContactPrefill({ ...contact, siteAddress: 'Old site', consent: true, service: { doors: 7 }, token: 'private' }), contact);
  assert.deepEqual(parseQuoteContactPrefill({ name: '', email: contact.email, phone: '' }), { name: '', email: contact.email, phone: '' });
  for (const value of [null, {}, { ...contact, name: '123' }, { ...contact, email: 'bad@@example.test' }, { ...contact, phone: '+1 202 555 0123' }]) assert.equal(parseQuoteContactPrefill(value), null);
});

async function transitionFixture(run: (calls: Array<{ url: string; init?: RequestInit }>, locks: () => number) => Promise<void>, reply: (url: string, init?: RequestInit) => Response) {
  const oldFetch = globalThis.fetch, oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const calls: Array<{ url: string; init?: RequestInit }> = []; let lockCount = 0, held = false;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_name: string, _options: unknown, action: () => Promise<unknown>) => { assert.equal(held, false, 'No nested writing-session lock'); lockCount++; held = true; try { return await action(); } finally { held = false; } } } } });
  globalThis.fetch = async (url, init) => { assert.equal(held, true); calls.push({ url: String(url), init }); return reply(String(url), init); };
  try { await run(calls, () => lockCount); } finally { globalThis.fetch = oldFetch; if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else Reflect.deleteProperty(globalThis, 'navigator'); }
}
test('starting a new quote holds one lock through logout, session and confirmed null read', async () => {
  const contact = { name: 'Fixture', email: 'fixture@example.test', phone: '' };
  await transitionFixture(async (calls, locks) => {
    assert.deepEqual(await startNewQuote(), contact); assert.equal(locks(), 1);
    assert.deepEqual(calls.map(call => call.url), ['/api/quote/requests/customer/logout', '/api/quote/requests/session', '/api/quote/requests']);
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { intent: 'start-new' });
    for (const call of calls) { assert.equal(call.init?.credentials, 'same-origin'); assert.equal(call.init?.cache, 'no-store'); }
  }, url => Response.json(url.endsWith('/logout') ? { signedOut: true, writingSessionPreserved: false, contact: { ...contact, siteAddress: 'Old site' } } : url.endsWith('/session') ? { ready: true } : { request: null }));
});
test('an unlinked draft guard stops the new transition before session rotation', async () => {
  await transitionFixture(async (calls) => {
    await assert.rejects(startNewQuote(), cause => cause instanceof QuoteEntryTransitionError && cause.status === 409 && cause.browserDraft?.id === id);
    assert.equal(calls.length, 1);
  }, () => Response.json({ error: 'Keep the draft.', code: 'unlinked_browser_draft', browserDraft: { id, reference: summary.reference } }, { status: 409 }));
});
const savedRequest = { ...summary, mode: 'live', companyId: 'lk-group', createdAt: summary.savedAt, consentVersion: 'quote-storage-review-v1', customerId: null, reviewRequestedAt: null, payload: { contact: { name: 'Fixture', email: 'fixture@example.test', phone: '', siteAddress: 'Fixture street', suburb: 'Sydney', postcode: '2000', details: '', consent: true }, service: null } };
test('a non-null final read is a conflict, never a successful new request or prefill', async () => {
  await transitionFixture(async calls => {
    await assert.rejects(startNewQuote(), cause => cause instanceof QuoteEntryTransitionError && cause.browserDraft?.id === id);
    assert.equal(calls.length, 3);
  }, url => Response.json(url.endsWith('/logout') ? { signedOut: true, writingSessionPreserved: true, contact: null } : url.endsWith('/session') ? { ready: true } : { request: savedRequest }));
});
test('uncertain transition recovery checks a session without repeating logout', async () => {
  await transitionFixture(async (calls, locks) => {
    await checkNewQuoteSession(); assert.equal(locks(), 1);
    assert.deepEqual(calls.map(call => call.url), ['/api/quote/requests/session', '/api/quote/requests']);
  }, url => Response.json(url.endsWith('/session') ? { ready: true } : { request: null }));
});
test('browser draft resume verifies the exact request and preserves the writing session in one lock', async () => {
  await transitionFixture(async (calls, locks) => {
    assert.equal((await resumeBrowserDraft(id)).id, id); assert.equal(locks(), 1);
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { intent: 'resume-browser-draft', expectedRequestId: id });
    assert.equal(new Headers(calls[1].init?.headers).get('x-lk-quote-request-id'), id);
  }, url => Response.json(url.endsWith('/logout') ? { signedOut: true, writingSessionPreserved: true, requestId: id } : { request: savedRequest }));
});
test('a first-save association requires the original exact contact payload, revision and immutable command', () => {
  const attempt = { path: '/api/quote/requests', method: 'PUT', body: JSON.stringify({ expectedRevision: 0, idempotencyKey: id, storageConsent: true, payload: savedRequest.payload }) };
  const created = { ...savedRequest, revision: 1 } as Parameters<typeof pendingFirstSaveMatches>[1];
  assert.equal(isPendingFirstSave(attempt), true); assert.equal(pendingFirstSaveMatches(attempt, created), true);
  assert.equal(pendingFirstSaveMatches(attempt, { ...created, revision: 2 }), false);
  assert.equal(pendingFirstSaveMatches(attempt, { ...created, payload: { ...created.payload, contact: { ...created.payload.contact, siteAddress: 'Another site' } } }), false);
  assert.equal(isPendingFirstSave({ ...attempt, body: JSON.stringify({ expectedRevision: 1, payload: created.payload }) }), false);
  assert.equal(isPendingFirstSave({ ...attempt, path: '/api/quote/requests/review' }), false);
  assert.equal(isPendingFirstSave({ ...attempt, body: JSON.stringify({ expectedRevision: 0, storageConsent: true, payload: created.payload }) }), false);
  assert.equal(isPendingFirstSave({ ...attempt, body: 'invalid-json' }), false);
  assert.equal(pendingFirstSaveMatches(attempt, { ...created, status: 'review_requested' }), false);
});
