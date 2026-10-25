// Shared contract between the overview count calculation (application/presentation hook)
// and the overview cards (presentation). Counts come from existing authorised admin reads only.
export interface OverviewCounts {
  /** Live quote requests with status 'review_requested', counted across the pages scanned. */
  quotesAwaitingReview: number
  /** True when the list had more pages than the scan limit, so quotesAwaitingReview is a lower bound. */
  quotesAwaitingReviewIsPartial: boolean
  /** Company booking states that still need a company action (confirmation or review). */
  bookingsNeedingAction: number
  /** Company booking states whose booking is confirmed. */
  bookingsConfirmed: number
}

export type OverviewCountsState =
  | { status: 'loading' }
  | { status: 'ready'; counts: OverviewCounts; loadedAt: string }
  | { status: 'error'; message: string }

export interface OverviewCountsHook { state: OverviewCountsState; refresh: () => void }
