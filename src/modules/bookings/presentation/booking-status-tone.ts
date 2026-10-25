import type { LiveCompanyBookingState } from '../domain/live-contracts.ts';
import type { StatusTone } from '@/shared/ui/status-badge';
import { currentAcceptance, usesSignedRequestBooking } from './live-booking-client.ts';

export function companyBookingTone(state: LiveCompanyBookingState): { tone: StatusTone; label: string } {
  const { booking, proposal } = state;
  if (booking) {
    const status = booking.status;
    switch (status) {
      case 'confirmed': return { tone: 'success', label: 'Confirmed and Google verified' };
      case 'confirming': return { tone: 'info', label: 'Confirmation processing' };
      case 'review_required': return { tone: 'danger', label: 'Company review required' };
    }
    const exhaustive: never = status;
    return exhaustive;
  }
  if (usesSignedRequestBooking(state)) return { tone: 'warning', label: 'Awaiting company review' };
  if (currentAcceptance(state)) return { tone: 'warning', label: 'Awaiting company confirmation' };
  if (proposal === null) return { tone: 'warning', label: 'Awaiting company review' };
  const status = proposal.status;
  switch (status) {
    case 'draft': return { tone: 'warning', label: 'Company draft' };
    case 'published': return { tone: 'info', label: 'Awaiting customer' };
  }
  const exhaustive: never = status;
  return exhaustive;
}
