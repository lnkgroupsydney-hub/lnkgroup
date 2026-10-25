import type { LiveCompanyBookingState } from '../domain/live-contracts';

export type ScheduleStatus = 'requested' | 'draft' | 'published' | 'confirming' | 'confirmed' | 'review_required' | 'cancel_pending' | 'cancelled';
export const scheduleStatusLabels: Record<ScheduleStatus, string> = {
  requested: 'Awaiting company review', draft: 'Company draft saved', published: 'Company proposal published',
  confirming: 'Confirmation processing', confirmed: 'Confirmed', review_required: 'Review required', cancel_pending: 'Cancellation pending · periods held', cancelled: 'Cancelled · periods released',
};

export function scheduleStatus(state: LiveCompanyBookingState): ScheduleStatus {
  if (state.booking) return state.booking.status;
  if (state.simpleDraft) return 'draft';
  if (state.proposal) return state.proposal.status;
  return 'requested';
}

// These are filters over the current loaded result, not full-company metrics.
export function matchesSchedule(state: LiveCompanyBookingState, query: string, status: string, day: string): boolean {
  if (status && scheduleStatus(state) !== status) return false;
  const contact = state.submission.snapshot.payload.contact;
  const text = [state.submission.reference, contact.name, contact.email, contact.phone, contact.siteAddress, contact.suburb, contact.postcode].join(' ').toLocaleLowerCase('en-AU');
  if (query.trim() && !text.includes(query.trim().toLocaleLowerCase('en-AU'))) return false;
  if (!day) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const dayValue = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(dayValue.getTime()) || dayValue.toISOString().slice(0, 10) !== day) return false;
  if (!state.proposal) return state.submission.preferredDate === day;
  return state.proposal.segments.some(segment => {
    if (segment.kind === 'all_day') return segment.startDate <= day && day < segment.endDate;
    // Timed end dates are inclusive unless the final Sydney time is midnight.
    const endDay = segment.endLocal?.slice(0, 10) ?? segment.endDate;
    return segment.startDate <= day && (day < endDay || day === endDay && !/T00:00(?::00(?:\.0+)?)?$/.test(segment.endLocal ?? ''));
  });
}
