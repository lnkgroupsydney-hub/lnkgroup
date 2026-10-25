import type { LiveQuoteRequestPage } from '../../quotes/domain/contracts.ts';
import type { LiveCompanyBookingState } from '../../bookings/domain/live-contracts.ts';
import type { OverviewCounts } from './overview-counts-contract.ts';

export function countQuotesAwaitingReview(pages: LiveQuoteRequestPage[]): { count: number; partial: boolean } {
  let count = 0, scanned = 0;
  for (const page of pages) {
    scanned += page.requests.length;
    count += page.requests.filter(request => request.status === 'review_requested').length;
  }
  return { count, partial: (pages.at(-1)?.total ?? 0) > scanned };
}

export function countBookings(states: LiveCompanyBookingState[], needsAction: (state: LiveCompanyBookingState) => boolean): { needingAction: number; confirmed: number } {
  let needingAction = 0, confirmed = 0;
  for (const state of states) {
    const { booking } = state;
    // The caller identifies pending review, company drafts and current acceptance; stale published acceptance awaits the customer.
    if (booking === null && needsAction(state) || booking?.status === 'confirming' || booking?.status === 'review_required') needingAction++;
    if (booking?.status === 'confirmed') confirmed++;
  }
  return { needingAction, confirmed };
}

export function buildOverviewCounts(quotes: ReturnType<typeof countQuotesAwaitingReview>, bookings: ReturnType<typeof countBookings>): OverviewCounts {
  return { quotesAwaitingReview: quotes.count, quotesAwaitingReviewIsPartial: quotes.partial, bookingsNeedingAction: bookings.needingAction, bookingsConfirmed: bookings.confirmed };
}
