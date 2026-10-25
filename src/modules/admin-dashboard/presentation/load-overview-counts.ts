import type { LiveQuoteRequestPage } from '../../quotes/domain/contracts.ts';
import { isRecord, liveRequest, LiveRequestError, parseLiveRequest } from '../../quotes/presentation/request-client.ts';
import { companyBookingRequest, currentAcceptance, LiveCompanyRequestError, parseCompanyState, usesSignedRequestBooking } from '../../bookings/presentation/live-booking-client.ts';
import { buildOverviewCounts, countBookings, countQuotesAwaitingReview } from '../application/overview-counts.ts';
import type { OverviewCountsState } from '../application/overview-counts-contract.ts';

type LoadResult = { state: Exclude<OverviewCountsState, { status: 'loading' }>; accessLost: boolean };
const retryMessage = 'Overview counts could not be loaded. Please retry.';

function parsePage(body: Record<string, unknown>, page: number): LiveQuoteRequestPage {
  if (!Array.isArray(body.requests) || body.requests.length > 50 || !Number.isSafeInteger(body.total) || Number(body.total) < 0 || body.page !== page || body.pageSize !== 50) throw new Error(retryMessage);
  return { requests: body.requests.map(parseLiveRequest), total: Number(body.total), page, pageSize: 50 };
}

export async function loadOverviewCounts(signal: AbortSignal, fetchers = { quotes: liveRequest, bookings: companyBookingRequest }): Promise<LoadResult> {
  signal.throwIfAborted();
  const quotesSignal = AbortSignal.any([signal, AbortSignal.timeout(25_000)]);
  const bookingsSignal = AbortSignal.any([signal, AbortSignal.timeout(35_000)]);
  const results = await Promise.allSettled([
    (async () => {
      const pages: LiveQuoteRequestPage[] = [];
      let scanned = 0;
      for (let page = 1; page <= 10; page++) {
        quotesSignal.throwIfAborted();
        const body = await fetchers.quotes(`/api/admin/quote-requests?page=${page}&pageSize=50`, { signal: quotesSignal });
        quotesSignal.throwIfAborted();
        const current = parsePage(body, page);
        pages.push(current);
        scanned += current.requests.length;
        if (scanned >= current.total || current.requests.length === 0) break;
      }
      return countQuotesAwaitingReview(pages);
    })(),
    (async () => {
      bookingsSignal.throwIfAborted();
      const body = await fetchers.bookings('/api/admin/live-bookings', '', { signal: bookingsSignal });
      bookingsSignal.throwIfAborted();
      if (!Array.isArray(body.states)) throw new Error(retryMessage);
      const states = body.states.map(value => {
        if (!isRecord(value) || typeof value.requestId !== 'string' || !value.requestId) throw new Error(retryMessage);
        const state = parseCompanyState({ state: value }, value.requestId);
        if (!state) throw new Error(retryMessage);
        return state;
      });
      return countBookings(states, state => usesSignedRequestBooking(state) || currentAcceptance(state) || state.proposal === null || state.proposal.status === 'draft');
    })(),
  ]);
  signal.throwIfAborted();
  const failures = results.filter(result => result.status === 'rejected');
  const accessLost = failures.some(({ reason }) => (reason instanceof LiveRequestError || reason instanceof LiveCompanyRequestError) && [401, 403].includes(reason.status));
  if (accessLost) return { state: { status: 'error', message: 'Your company access has ended. Please sign in again.' }, accessLost: true };
  const aborted = failures.find(({ reason }) => reason instanceof Error && reason.name === 'AbortError');
  if (aborted) throw aborted.reason;
  const [quotes, bookings] = results;
  if (quotes.status === 'rejected' || bookings.status === 'rejected') return { state: { status: 'error', message: retryMessage }, accessLost: false };
  return { state: { status: 'ready', counts: buildOverviewCounts(quotes.value, bookings.value), loadedAt: new Date().toISOString() }, accessLost: false };
}
