import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LiveQuoteRequest, LiveQuoteRequestPage } from '../../quotes/domain/contracts.ts';
import type { LiveCompanyBookingState } from '../../bookings/domain/live-contracts.ts';
import { buildOverviewCounts, countBookings, countQuotesAwaitingReview } from './overview-counts.ts';

const page = (statuses: LiveQuoteRequest['status'][], total = statuses.length): LiveQuoteRequestPage => ({ requests: statuses.map(status => ({ status }) as LiveQuoteRequest), total, page: 1, pageSize: 50 });
const proposal = { id: 'current-proposal', hash: 'current-hash', status: 'published' } as NonNullable<LiveCompanyBookingState['proposal']>;
const acceptance = { id: 'acceptance', proposalId: proposal.id, proposalHash: proposal.hash, acceptedAt: '2026-10-25T00:00:00Z', signature: { name: 'Synthetic customer' }, acknowledgmentVersion: 'company-price-schedule-ack-v1', acknowledgmentText: 'Synthetic acknowledgment', emailStatus: 'pending', receiptReady: false } as NonNullable<LiveCompanyBookingState['acceptance']>;
const bookingState = (booking: LiveCompanyBookingState['booking'], accepted: LiveCompanyBookingState['acceptance'] = null) => ({ booking, acceptance: accepted, proposal, submission: { snapshot: { version: 'live-booking-request-ack-v1' } } }) as LiveCompanyBookingState;
const noAction = () => false;

test('empty lists produce zero complete counts', () => {
  assert.deepEqual(countQuotesAwaitingReview([]), { count: 0, partial: false });
  assert.deepEqual(countBookings([], noAction), { needingAction: 0, confirmed: 0 });
  assert.deepEqual(buildOverviewCounts(countQuotesAwaitingReview([]), countBookings([], noAction)), { quotesAwaitingReview: 0, quotesAwaitingReviewIsPartial: false, bookingsNeedingAction: 0, bookingsConfirmed: 0 });
});
test('quote counts include only review requests across all scanned pages and use the last total', () => {
  assert.deepEqual(countQuotesAwaitingReview([page(['draft', 'review_requested'], 8), page(['review_requested'], 3)]), { count: 2, partial: false });
  assert.deepEqual(countQuotesAwaitingReview([page(['review_requested'], 3), page(['draft'], 5)]), { count: 1, partial: true });
  assert.deepEqual(countQuotesAwaitingReview([page([], 1)]), { count: 0, partial: true });
});
test('the injected action rule decides every booking and only confirmed bookings count as confirmed', () => {
  for (const status of ['confirming', 'review_required', 'confirmed', 'cancel_pending', 'cancelled'] as const) {
    const state = bookingState({ status } as NonNullable<LiveCompanyBookingState['booking']>, acceptance);
    for (const action of [true, false]) {
      let calls = 0;
      assert.deepEqual(countBookings([state], value => { calls++; assert.equal(value, state); return action; }), { needingAction: Number(action), confirmed: status === 'confirmed' ? 1 : 0 }, `${status} ${action}`);
      assert.equal(calls, 1);
    }
  }
});
test('unbooked company-action fixtures use the injected decision; stale published and customer waits do not count', () => {
  const signed = { ...bookingState(null), submission: { snapshot: { version: 'live-booking-request-ack-v2' } } } as LiveCompanyBookingState;
  const cases = [
    { name: 'signed request without acceptance', state: signed, action: true },
    { name: 'current acceptance', state: bookingState(null, acceptance), action: true },
    { name: 'stale proposal ID', state: bookingState(null, { ...acceptance, proposalId: 'older-proposal' }), action: false },
    { name: 'stale proposal hash', state: bookingState(null, { ...acceptance, proposalHash: 'older-hash' }), action: false },
    { name: 'legacy published request without acceptance', state: bookingState(null), action: false },
    { name: 'legacy request without a company proposal', state: { ...bookingState(null), proposal: null }, action: true },
    { name: 'legacy company draft', state: { ...bookingState(null), proposal: { ...proposal, status: 'draft' as const } }, action: true },
  ];
  for (const fixture of cases) {
    let calls = 0;
    assert.deepEqual(countBookings([fixture.state], state => { calls++; assert.equal(state, fixture.state); return fixture.action; }), { needingAction: Number(fixture.action), confirmed: 0 }, fixture.name);
    assert.equal(calls, 1);
  }
});
test('mixed bookings build the shared overview contract without changing partial counts', () => {
  const accepted = bookingState(null, acceptance);
  const confirmed = bookingState({ status: 'confirmed' } as NonNullable<LiveCompanyBookingState['booking']>);
  const processing = bookingState({ status: 'confirming' } as NonNullable<LiveCompanyBookingState['booking']>);
  const waiting = bookingState(null);
  const actionable = new Set<LiveCompanyBookingState>([accepted, processing]);
  const bookings = countBookings([waiting, accepted, processing, confirmed], state => actionable.has(state));
  assert.deepEqual(buildOverviewCounts({ count: 4, partial: true }, bookings), { quotesAwaitingReview: 4, quotesAwaitingReviewIsPartial: true, bookingsNeedingAction: 2, bookingsConfirmed: 1 });
});
