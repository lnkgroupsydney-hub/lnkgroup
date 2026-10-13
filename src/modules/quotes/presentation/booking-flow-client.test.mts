import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BookingResponseLifetime, bookingMonthDates, shiftBookingMonth, sydneyToday, parseBookingAvailability, parseBookingReview, parseBookingState, bookingRequest, pendingBookingAttemptAfterRead, bookingPreparationAttempt, bookingPreparationNext, bookingTimeValid, parseBookingSubmission } from './booking-flow-client.ts';
import { BOOKING_ACKNOWLEDGMENT_TEXT, BOOKING_ACKNOWLEDGMENT_VERSION, BOOKING_SIMPLE_ACK_VERSION, BOOKING_SIMPLE_ACK_TEXT, type LiveBookingState } from '../domain/booking-flow.ts';

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

import { bookingFlowGuidance, shouldRefreshBookingAvailability, isSavedBookingDateRequestable } from './booking-flow-guidance.ts';
test('booking guidance separates photo, numeric estimate, email binding and booking stages', () => {
  const ready = { latest: { status: 'succeeded', stale: false, pricing: { status: 'provisional_estimate', total: 165000 } }, verified: true, needsLink: false, loaded: true, approved: false, submitted: false, calendarError: '', calendarBusy: false, availabilityExpired: false };
  assert.equal(bookingFlowGuidance({ ...ready, latest: null }).target, 'photos');
  assert.equal(bookingFlowGuidance({ ...ready, latest: { ...ready.latest, stale: true } }).target, 'photos');
  assert.equal(bookingFlowGuidance({ ...ready, latest: { ...ready.latest, pricing: null } }).target, 'photos');
  assert.equal(bookingFlowGuidance({ ...ready, verified: false }).target, 'email');
  assert.equal(bookingFlowGuidance({ ...ready, needsLink: true }).target, 'email');
  assert.equal(bookingFlowGuidance({ ...ready, loaded: false }).target, 'status');
  assert.equal(bookingFlowGuidance(ready).target, null);
  assert.equal(bookingFlowGuidance({ ...ready, approved: true, calendarError: 'Network failure' }).target, 'calendar');
  assert.equal(bookingFlowGuidance({ ...ready, approved: true, availabilityExpired: true }).target, 'calendar');
  assert.equal(bookingFlowGuidance({ ...ready, submitted: true }).target, null);
});
test('calendar TTL refresh never interrupts a pending write, signature review or other in-flight work', () => {
  const idle = { expired: true, showCalendar: true, disabled: false, busy: false, calendarBusy: false, pending: false, reviewing: false, calendarError: '' };
  assert.equal(shouldRefreshBookingAvailability(idle), true);
  for (const flag of ['disabled', 'busy', 'calendarBusy', 'pending', 'reviewing'] as const) assert.equal(shouldRefreshBookingAvailability({ ...idle, [flag]: true }), false);
  assert.equal(shouldRefreshBookingAvailability({ ...idle, expired: false }), false);
  assert.equal(shouldRefreshBookingAvailability({ ...idle, showCalendar: false }), false);
  assert.equal(shouldRefreshBookingAvailability({ ...idle, calendarError: 'Unavailable' }), false, 'failed reads require an explicit retry rather than a request loop');
});

test('restored preferred dates allow review only when that exact saved date is freshly requestable', () => {
  const approval = { stale: false, preferredDate: '2026-10-22' };
  const days = [{ date: '2026-10-21', selectable: false }, { date: '2026-10-22', selectable: true }];
  assert.equal(isSavedBookingDateRequestable(approval, '2026-10-22', days), true);
  assert.equal(isSavedBookingDateRequestable(approval, '2026-10-22', undefined), false);
  assert.equal(isSavedBookingDateRequestable(approval, '2026-10-22', [{ date: '2026-10-22', selectable: false }]), false);
  assert.equal(isSavedBookingDateRequestable(approval, '2026-10-22', [{ date: '2026-11-22', selectable: true }]), false);
  assert.equal(isSavedBookingDateRequestable({ ...approval, stale: true }, '2026-10-22', days), false);
  assert.equal(isSavedBookingDateRequestable(approval, '2026-10-23', days), false);
});

const simpleAck = { version: BOOKING_SIMPLE_ACK_VERSION, text: BOOKING_SIMPLE_ACK_TEXT };
const simpleSnapshot = { ...snapshot, version: BOOKING_SIMPLE_ACK_VERSION, acknowledgment: simpleAck, preferredDate: '2026-10-29', preferredTime: '10:30' };
const simpleApproval = { id: 'simple-approval', analysisId: 'analysis-current', inputRevision: 5, selectionRevision: 3, stale: false, preferredDate: '2026-10-29', preferredTime: '10:30', snapshot: simpleSnapshot };
const simpleState = { ...state, acknowledgment: simpleAck, approval: simpleApproval } as unknown as LiveBookingState;
const simpleSelection = { date: '2026-10-29', time: '10:30', availabilityRevision: 'fresh-calendar' };
test('one continue operation chains the confirmed approval, exact date/time save and review while preserving each uncertain write key', () => {
  const first = bookingPreparationAttempt({ ...simpleState, approval: null }, 'analysis-current', 5, simpleSelection, 'approve-key');
  assert.equal(first.path, '/api/quote/requests/booking/approve');
  assert.equal(JSON.parse(first.body).idempotencyKey, 'approve-key');
  const second = bookingPreparationNext(first, simpleState, 'date-key')!;
  assert.equal(second.path, '/api/quote/requests/booking/date');
  assert.deepEqual(JSON.parse(second.body), { approvalId: simpleApproval.id, preferredDate: '2026-10-29', preferredTime: '10:30', availabilityRevision: 'fresh-calendar', idempotencyKey: 'date-key' });
  assert.equal(pendingBookingAttemptAfterRead(second, simpleState), second, 'GET cannot replace an uncertain date write or its original idempotency key');
  const last = bookingPreparationNext(second, simpleState, 'unused')!;
  assert.equal(last.path, '/api/quote/requests/booking/review');
  assert.deepEqual(last.review, { approvalId: simpleApproval.id, selectionRevision: 3, selection: { date: '2026-10-29', time: '10:30' } });
  assert.equal(bookingPreparationNext(last, simpleState, 'unused'), null);
});
test('an unsubmitted old acknowledgment is upgraded through a fresh approve command without rewriting its saved signature wording', () => {
  const old = { ...simpleState, approval: { ...simpleApproval, snapshot } } as unknown as LiveBookingState;
  assert.equal(bookingPreparationAttempt(old, 'analysis-current', 5, simpleSelection, 'new-v2-key').path, '/api/quote/requests/booking/approve');
  assert.equal(snapshot.acknowledgment.text, BOOKING_ACKNOWLEDGMENT_TEXT);
  assert.equal(bookingPreparationAttempt(simpleState, 'analysis-current', 5, simpleSelection, 'date-key').path, '/api/quote/requests/booking/date');
});
test('missing, impossible or second-resolution times and changed save responses cannot open the signature step', () => {
  for (const time of ['', '24:00', '09:60', '9:30', '10:30:00', null]) assert.equal(bookingTimeValid(time), false);
  assert.equal(bookingTimeValid('00:00'), true); assert.equal(bookingTimeValid('23:59'), true);
  for (const selection of [{ ...simpleSelection, time: '' }, { ...simpleSelection, date: '2026-02-30' }]) assert.throws(() => bookingPreparationAttempt(simpleState, 'analysis-current', 5, selection, 'key'));
  const command = bookingPreparationAttempt(simpleState, 'analysis-current', 5, simpleSelection, 'key');
  for (const approval of [{ ...simpleApproval, preferredTime: '11:00' }, { ...simpleApproval, preferredDate: '2026-10-30' }, { ...simpleApproval, analysisId: 'another-analysis' }]) assert.throws(() => bookingPreparationNext(command, { ...simpleState, approval } as unknown as LiveBookingState, 'next'));
});
test('v2 review and immutable receipt reject a changed selected time, calendar claim or acknowledgment while old receipts remain readable', () => {
  const review = { snapshot: simpleSnapshot, snapshotHash: 'hash', reviewProof: 'proof', expiresAt: new Date(Date.now() + 60_000).toISOString(), approvalId: simpleApproval.id, selectionRevision: 3 };
  assert.equal(parseBookingReview({ review }, requestId, simpleApproval.id, 3, simpleSelection).snapshot.preferredTime, '10:30');
  assert.throws(() => parseBookingReview({ review: { ...review, snapshot: { ...simpleSnapshot, preferredTime: '11:00' } } }, requestId, simpleApproval.id, 3, simpleSelection));
  const receipt = { id: 'submitted', reference: 'REQUEST-QA', requestId, approvalId: simpleApproval.id, preferredDate: simpleSelection.date, preferredTime: simpleSelection.time, submittedAt: new Date().toISOString(), receiptReady: true, emailStatus: 'provider_accepted', calendarStatus: 'not_required', snapshot: simpleSnapshot, signature: { name: 'QA Customer', method: 'typed', strokes: [], acknowledged: true } };
  assert.equal(parseBookingSubmission(receipt, requestId).preferredTime, '10:30');
  for (const value of [{ ...receipt, preferredTime: '11:00' }, { ...receipt, calendarStatus: 'synced' }, { ...receipt, snapshot: { ...simpleSnapshot, acknowledgment: { ...simpleAck, text: 'invented price acceptance' } } }]) assert.throws(() => parseBookingSubmission(value, requestId));
  assert.equal(parseBookingSubmission({ ...receipt, preferredTime: null, calendarStatus: 'synced', snapshot: { ...snapshot, preferredDate: receipt.preferredDate } }, requestId).snapshot.version, BOOKING_ACKNOWLEDGMENT_VERSION);
});
