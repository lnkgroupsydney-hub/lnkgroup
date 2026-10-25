import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPANY_BOOKING_ACK_TEXT, COMPANY_BOOKING_ACK_VERSION } from '../../bookings/domain/live-contracts.ts';
import { LiveCompanyRequestError, parseCompanyState } from '../../bookings/presentation/live-booking-client.ts';
import { LiveRequestError } from '../../quotes/presentation/request-client.ts';
import { BOOKING_SIMPLE_ACK_TEXT, BOOKING_SIMPLE_ACK_VERSION } from '../../quotes/domain/booking-flow.ts';
import { companyBookingTone } from '../../bookings/presentation/booking-status-tone.ts';
import { loadOverviewCounts } from './load-overview-counts.ts';
import { useOverviewCounts } from './use-overview-counts.ts';

const requestId = 'b65b5359-f90d-45be-b4b9-c249aa7f6daf';
const request = { id: requestId, reference: 'RQ-1234567890ABCDEF1234567890ABCDEF', mode: 'live', companyId: 'lk-group', revision: 1, status: 'review_requested', savedAt: '2026-10-08T00:00:00Z', createdAt: '2026-10-08T00:00:00Z', consentVersion: 'quote-storage-review-v1', reviewRequestedAt: '2026-10-08T00:00:00Z', customerId: null, payload: { contact: { name: 'Synthetic client', email: 'client@example.test', phone: '', siteAddress: 'Test address', suburb: 'Test suburb', postcode: '2000', details: '', consent: true }, service: null } };
const state = { requestId, revision: 1, submission: { requestId, snapshot: { version: 'live-booking-request-ack-v1' } }, proposal: null, proposals: [], acceptance: null, booking: null, acknowledgment: { version: COMPANY_BOOKING_ACK_VERSION, text: COMPANY_BOOKING_ACK_TEXT } };
const page = (requests = [request], total = requests.length, current = 1) => ({ requests, total, page: current, pageSize: 50 });
const signal = () => new AbortController().signal;
const defaults = { quotes: async () => page(), bookings: async () => ({ states: [state] }) };

test('client hook can be imported by Node and real clients load ready counts with private reads', async () => {
  assert.equal(typeof useOverviewCounts, 'function');
  const original = globalThis.fetch, calls: { path: string; init: RequestInit }[] = [];
  globalThis.fetch = async (path, init) => { calls.push({ path: String(path), init: init! }); return new Response(JSON.stringify(String(path).includes('quote-requests') ? page() : { states: [state] }), { status: 200 }); };
  try {
    const result = await loadOverviewCounts(signal());
    assert.equal(result.accessLost, false);
    assert.equal(result.state.status, 'ready');
    if (result.state.status !== 'ready') assert.fail('Expected ready state');
    assert.deepEqual(result.state.counts, { quotesAwaitingReview: 1, quotesAwaitingReviewIsPartial: false, bookingsNeedingAction: 1, bookingsConfirmed: 0 });
    assert.ok(Number.isFinite(Date.parse(result.state.loadedAt)));
    assert.deepEqual(calls.map(call => call.path), ['/api/admin/quote-requests?page=1&pageSize=50', '/api/admin/live-bookings']);
    for (const { init } of calls) { assert.equal(init.credentials, 'same-origin'); assert.equal(init.cache, 'no-store'); assert.ok(init.signal instanceof AbortSignal); }
  } finally { globalThis.fetch = original; }
});
test('quotes follow the total through two pages', async () => {
  const paths: string[] = [];
  const result = await loadOverviewCounts(signal(), { ...defaults, quotes: async path => { paths.push(path); return page([request], 2, paths.length); } });
  assert.equal(paths.length, 2);
  assert.equal(paths[1], '/api/admin/quote-requests?page=2&pageSize=50');
  assert.equal(result.state.status, 'ready');
  if (result.state.status === 'ready') { assert.equal(result.state.counts.quotesAwaitingReview, 2); assert.equal(result.state.counts.quotesAwaitingReviewIsPartial, false); }
});
test('parsed unbooked states keep company-action counts and warning tones consistent', async () => {
  const proposal = { id: 'current-proposal', version: 2, revision: 2, status: 'published', hash: 'current-hash', amountExGst: 150000, gst: 15000, total: 165000, currency: 'AUD', scope: 'Cabinet repainting only', adjustmentReason: 'Updated scope', calendarTarget: { calendarId: 'calendar@example.test', accountEmail: 'calendar@example.test' }, segments: [{ kind: 'all_day', startDate: '2026-10-29', endDate: '2026-10-30', startAt: '2026-10-28T13:00:00Z', endAt: '2026-10-29T13:00:00Z' }] };
  const acceptance = { id: 'acceptance', proposalId: proposal.id, proposalHash: proposal.hash, acceptedAt: '2026-10-25T00:00:00Z', signature: { name: 'Synthetic customer' }, acknowledgmentVersion: COMPANY_BOOKING_ACK_VERSION, acknowledgmentText: COMPANY_BOOKING_ACK_TEXT, emailStatus: 'pending', receiptReady: false };
  const oldId = { ...proposal, id: 'older-proposal' }, oldHash = { ...proposal, hash: 'older-hash' };
  const published = { ...state, proposal, proposals: [proposal] };
  const signed = { ...state, submission: { requestId, id: 'signed-submission', preferredDate: '2026-10-29', preferredTime: '10:30', snapshot: { version: BOOKING_SIMPLE_ACK_VERSION, acknowledgment: { version: BOOKING_SIMPLE_ACK_VERSION, text: BOOKING_SIMPLE_ACK_TEXT }, preferredDate: '2026-10-29', preferredTime: '10:30', pricing: { total: 165000 } } } };
  const cases = [
    { name: 'signed request without acceptance', value: signed, count: 1 },
    { name: 'acceptance matches the current proposal ID and hash', value: { ...published, acceptance }, count: 1 },
    { name: 'acceptance has a stale ID linked to saved history', value: { ...published, proposals: [proposal, oldId], acceptance: { ...acceptance, proposalId: oldId.id } }, count: 0 },
    { name: 'acceptance has a stale hash linked to saved history', value: { ...published, proposals: [proposal, oldHash], acceptance: { ...acceptance, proposalHash: oldHash.hash } }, count: 0 },
    { name: 'published legacy proposal without acceptance awaits the customer', value: published, count: 0 },
    { name: 'legacy request without proposal or acceptance', value: state, count: 1 },
    { name: 'legacy company draft awaits company action', value: { ...state, proposal: { ...proposal, status: 'draft' }, proposals: [{ ...proposal, status: 'draft' }] }, count: 1 },
  ];
  for (const fixture of cases) {
    const result = await loadOverviewCounts(signal(), { ...defaults, bookings: async () => ({ states: [fixture.value] }) });
    assert.equal(result.state.status, 'ready', fixture.name);
    if (result.state.status === 'ready') { assert.equal(result.state.counts.bookingsNeedingAction, fixture.count, fixture.name); assert.equal(result.state.counts.bookingsConfirmed, 0); }
    const parsed = parseCompanyState({ state: fixture.value }, requestId);
    assert.ok(parsed);
    assert.equal(companyBookingTone(parsed).tone === 'warning', fixture.count === 1, fixture.name);
  }
  const result = await loadOverviewCounts(signal(), { ...defaults, bookings: async () => ({ states: cases.map(fixture => fixture.value) }) });
  assert.equal(result.state.status, 'ready');
  if (result.state.status === 'ready') assert.equal(result.state.counts.bookingsNeedingAction, 4);
});
test('parsed existing booking statuses keep action counts and their established tones ahead of pending review', async () => {
  const proposal = { id: 'proposal', version: 1, revision: 1, status: 'published', hash: 'proposal-hash', amountExGst: 100000, gst: 10000, total: 110000, currency: 'AUD', scope: 'Cabinet repainting', adjustmentReason: '', calendarTarget: { calendarId: 'calendar@example.test' }, segments: [{ kind: 'all_day', startDate: '2026-10-29', endDate: '2026-10-30', startAt: '2026-10-28T13:00:00Z', endAt: '2026-10-29T13:00:00Z' }] };
  for (const [status, tone, action, confirmed] of [['confirming', 'info', 1, 0], ['review_required', 'danger', 1, 0], ['confirmed', 'success', 0, 1]] as const) {
    const value = { ...state, proposal, proposals: [proposal], booking: { status, proposalId: proposal.id, proposalHash: proposal.hash, events: [] } };
    const result = await loadOverviewCounts(signal(), { ...defaults, bookings: async () => ({ states: [value] }) });
    assert.equal(result.state.status, 'ready');
    if (result.state.status === 'ready') { assert.equal(result.state.counts.bookingsNeedingAction, action); assert.equal(result.state.counts.bookingsConfirmed, confirmed); }
    const parsed = parseCompanyState({ state: value }, requestId);
    assert.ok(parsed);
    assert.equal(companyBookingTone(parsed).tone, tone);
  }
});
test('quote scans stop at ten pages and keep a lower-bound partial count', async () => {
  let calls = 0;
  const result = await loadOverviewCounts(signal(), { ...defaults, quotes: async () => page(Array(50).fill(request), 501, ++calls) });
  assert.equal(calls, 10);
  assert.equal(result.state.status, 'ready');
  if (result.state.status === 'ready') { assert.equal(result.state.counts.quotesAwaitingReview, 500); assert.equal(result.state.counts.quotesAwaitingReviewIsPartial, true); }
});
test('an empty final page stops scanning while retaining partial status', async () => {
  let calls = 0;
  const result = await loadOverviewCounts(signal(), { ...defaults, quotes: async () => { calls++; return page(calls === 1 ? [request] : [], 3, calls); } });
  assert.equal(calls, 2);
  assert.equal(result.state.status, 'ready');
  if (result.state.status === 'ready') assert.equal(result.state.counts.quotesAwaitingReviewIsPartial, true);
});
test('both existing error classes report access loss for 401 and 403, without partial counts or internal details', async () => {
  for (const status of [401, 403]) {
    for (const source of ['quotes', 'bookings'] as const) {
      const error = source === 'quotes' ? new LiveRequestError(status, 'Private internal detail') : new LiveCompanyRequestError(status, 'Private internal detail');
      const result = await loadOverviewCounts(signal(), { ...defaults, [source]: async () => { throw error; } });
      assert.equal(result.accessLost, true); assert.equal(result.state.status, 'error');
      assert.equal('counts' in result.state, false);
      if (result.state.status === 'error') { assert.match(result.state.message, /sign in again/); assert.doesNotMatch(result.state.message, /Private/); }
    }
  }
});
test('access loss is detected even when the other request fails first', async () => {
  const result = await loadOverviewCounts(signal(), { quotes: async () => { throw new Error('network'); }, bookings: async () => { await Promise.resolve(); throw new LiveCompanyRequestError(403, 'internal'); } });
  assert.equal(result.accessLost, true); assert.equal(result.state.status, 'error');
});
test('either network failure returns one safe error and no counts', async () => {
  for (const source of ['quotes', 'bookings'] as const) {
    const result = await loadOverviewCounts(signal(), { ...defaults, [source]: async () => { throw new Error('private network address'); } });
    assert.deepEqual(result, { state: { status: 'error', message: 'Overview counts could not be loaded. Please retry.' }, accessLost: false });
  }
});
test('malformed pages, quote rows and company states fail the whole count', async () => {
  for (const body of [{ ...page(), requests: null }, { ...page(), total: -1 }, { ...page(), page: 2 }, { ...page(), pageSize: 0 }, page([{ ...request, status: 'confirmed' }])]) {
    const result = await loadOverviewCounts(signal(), { ...defaults, quotes: async () => body });
    assert.equal(result.state.status, 'error'); assert.equal('counts' in result.state, false);
  }
  for (const states of [null, [null], [{}], [{ ...state, requestId: '' }], [{ ...state, acknowledgment: null }]]) {
    const result = await loadOverviewCounts(signal(), { ...defaults, bookings: async () => ({ states }) });
    assert.equal(result.state.status, 'error');
  }
});
test('already cancelled loads issue no requests', async () => {
  const abort = new AbortController(); abort.abort(); let called = false;
  await assert.rejects(loadOverviewCounts(abort.signal, { quotes: async () => { called = true; return page(); }, bookings: async () => { called = true; return { states: [] }; } }), { name: 'AbortError' });
  assert.equal(called, false);
});
test('cancellation after responses ignores late access errors and never reads another page', async () => {
  const abort = new AbortController(); let calls = 0;
  await assert.rejects(loadOverviewCounts(abort.signal, { quotes: async () => { calls++; await Promise.resolve(); abort.abort(); return page([request], 3); }, bookings: async () => { await Promise.resolve(); throw new LiveCompanyRequestError(401, 'late'); } }), { name: 'AbortError' });
  assert.equal(calls, 1);
});
test('AbortError leaves state ownership with the hook', async () => {
  await assert.rejects(loadOverviewCounts(signal(), { ...defaults, quotes: async () => { throw new DOMException('Cancelled', 'AbortError'); } }), { name: 'AbortError' });
});
