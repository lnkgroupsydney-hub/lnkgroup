import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BookingResponseLifetime, bookingMonthDates, shiftBookingMonth, sydneyToday, parseBookingAvailability, parseBookingReview, parseBookingState, bookingRequest, pendingBookingAttemptAfterRead } from './booking-flow-client.ts';
import { BOOKING_ACKNOWLEDGMENT_TEXT, BOOKING_ACKNOWLEDGMENT_VERSION } from '../domain/booking-flow.ts';

const requestId = 'dc242c35-55ba-443d-bdbe-5a77eea3ff07';
const acknowledgment = { version: BOOKING_ACKNOWLEDGMENT_VERSION, text: BOOKING_ACKNOWLEDGMENT_TEXT };
const snapshot = { requestId, mode: 'live', kind: 'nonbinding_booking_request', version: BOOKING_ACKNOWLEDGMENT_VERSION, acknowledgment, pricing: {currency:'AUD',amountUnit:'cents',total:165000},photos:[],payload:{} };
const state = { requestId, verified: true, canEdit: true, approval: null, submission: null, acknowledgment };

test('Sydney date uses the local civil day and month helpers handle leap years', () => {
  assert.equal(sydneyToday(new Date('2026-10-11T14:30:00Z')), '2026-10-12');
  assert.equal(shiftBookingMonth('2026-12', 1), '2027-01');
  assert.equal(bookingMonthDates('2028-02').length, 29);
  assert.equal(bookingMonthDates('2026-02').at(-1), '2026-02-28');
});
test('identity reset and newer responses reject stale booking results', () => {
  const lifetime = new BookingResponseLifetime(); const old = lifetime.begin(), current = lifetime.begin();
  assert.equal(lifetime.accepts(old), false); assert.equal(lifetime.accepts(current), true);
  lifetime.close(); assert.equal(lifetime.accepts(current), false);
  lifetime.reopen(); assert.equal(lifetime.accepts(current), false); assert.equal(lifetime.accepts(lifetime.begin()), true);
});
test('booking reads and writes carry the visible quote identity with private cache settings', async () => {
  const original = globalThis.fetch; const calls: RequestInit[] = [];
  globalThis.fetch = async (_input, init) => { calls.push(init!); return new Response(JSON.stringify({state}), {status:200,headers:{'content-type':'application/json'}}); };
  try {
    await bookingRequest('/api/quote/requests/booking', requestId);
    await bookingRequest('/api/quote/requests/booking/date', requestId, {method:'PUT',headers:{'content-type':'application/json'},body:'{}'});
    assert.equal(calls[0].cache, 'no-store'); assert.equal(calls[0].credentials, 'same-origin');
    for (const call of calls) assert.equal(new Headers(call.headers).get('x-lk-quote-request-id'), requestId);
    assert.equal(new Headers(calls[1].headers).get('content-type'), 'application/json');
  } finally { globalThis.fetch = original; }
});
test('an empty, partial, mismatched or expired calendar cannot enable date selection', () => {
  const month = '2026-10';
  const availability = {month,minMonth:'2026-10',maxMonth:'2027-01',revision:'server-v1',checkedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60_000).toISOString(),days:bookingMonthDates(month).map(date => ({date,selectable:true,reason:'requestable'}))};
  assert.equal(parseBookingAvailability({availability},month).days.length,31);
  for (const candidate of [{...availability,days:[]},{...availability,days:availability.days.slice(1)},{...availability,expiresAt:'2000-01-01T00:00:00Z'},{...availability,days:availability.days.map((day,i)=>i===0?{...day,date:'2026-11-01'}:day)}]) assert.throws(()=>parseBookingAvailability({availability:candidate},month));
});
test('recovery rejects another quote, unverified responses and changed acknowledgment versions', () => {
  assert.equal(parseBookingState({state},requestId).requestId,requestId);
  assert.equal(parseBookingState({state:{...state,verified:false}},requestId,false).verified,false);
  for(const candidate of [{...state,requestId:'other'},{...state,verified:false},{...state,acknowledgment:{...acknowledgment,text:'invented terms'}}]) assert.throws(()=>parseBookingState({state:candidate},requestId));
});
test('review proof must match the current approved estimate and selected date version', () => {
  const review = {snapshot,snapshotHash:'hash',reviewProof:'signed-proof',expiresAt:new Date(Date.now()+60_000).toISOString(),approvalId:'approval',selectionRevision:2};
  assert.equal(parseBookingReview({review},requestId,'approval',2).reviewProof,'signed-proof');
  assert.throws(()=>parseBookingReview({review},requestId,'other-approval',2));
  assert.throws(()=>parseBookingReview({review},requestId,'approval',3));
  assert.throws(()=>parseBookingReview({review:{...review,expiresAt:'2000-01-01T00:00:00Z'}},requestId,'approval',2));
});

test('successful status recovery preserves the exact unconfirmed approve, date and review attempts for retry', () => {
  const recovered = parseBookingState({ state }, requestId);
  for (const action of ['approve', 'date', 'review']) {
    const attempt = { path: `/api/quote/requests/booking/${action}`, method: action === 'date' ? 'PUT' : 'POST', body: JSON.stringify({ idempotencyKey: 'same-attempt-key', approvalId: 'original-approval', selectionRevision: 2 }) };
    const pending = pendingBookingAttemptAfterRead(attempt, recovered);
    assert.equal(pending, attempt, 'a successful GET must preserve the original command and retry body');
    assert.equal(pendingBookingAttemptAfterRead(pending, recovered), attempt, 'repeat status checks must not make recovery unreachable');
  }
  assert.equal(pendingBookingAttemptAfterRead(null, recovered), null);
  const immutable = { submission: { id: 'saved-submission' } } as Pick<import('../domain/booking-flow.ts').LiveBookingState, 'submission'>;
  assert.equal(pendingBookingAttemptAfterRead({ body: 'old-command' }, immutable), null, 'a frozen submitted request replaces command recovery with its immutable receipt');
});
