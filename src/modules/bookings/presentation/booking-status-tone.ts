import type { LiveCompanyBookingState } from '../domain/live-contracts.ts';
import type { StatusTone } from '@/shared/ui/admin';
import { scheduleStatus, scheduleStatusLabels, type ScheduleStatus } from './admin-schedule-view.ts';
import { currentAcceptance } from './live-booking-client.ts';

// Colour only. Labels and the status itself come from scheduleStatus so the list badge, the
// status filter and the overview count describe a booking the same way.
const tones: Record<ScheduleStatus, StatusTone> = {
  requested: 'warning', draft: 'warning', published: 'info',
  confirming: 'info', confirmed: 'success', review_required: 'danger',
  cancel_pending: 'info', cancelled: 'neutral',
};

/** True when the next step belongs to the company (review, draft, accepted proposal, processing or review-required booking). */
export function needsCompanyAction(state: LiveCompanyBookingState): boolean {
  const status = scheduleStatus(state);
  if (status === 'published') return currentAcceptance(state);
  return status === 'requested' || status === 'draft' || status === 'confirming' || status === 'review_required' || status === 'cancel_pending';
}

export function companyBookingTone(state: LiveCompanyBookingState): { tone: StatusTone; label: string } {
  const status = scheduleStatus(state);
  // A published proposal the customer has accepted for its current hash waits on company confirmation.
  const tone = status === 'published' && currentAcceptance(state) ? 'warning' : tones[status];
  return { tone, label: scheduleStatusLabels[status] };
}
