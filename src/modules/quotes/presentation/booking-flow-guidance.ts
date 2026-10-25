interface BookingGuidanceInput {
  latest: { status: string; stale: boolean; pricing: { status: string; total: number | null } | null } | null;
  verified: boolean; needsLink: boolean; loaded: boolean; approved: boolean; submitted: boolean;
  calendarError: string; calendarBusy: boolean; availabilityExpired: boolean;
}
export function bookingFlowGuidance(input: BookingGuidanceInput): { message: string; target: 'photos' | 'email' | 'status' | 'calendar' | null } {
  if (input.submitted) return { message: 'Your signed request is saved. The company will review your door-removal visit, assign the installation visit and email your booking confirmation.', target: null };
  if (!input.latest) return { message: 'Dates open after a current photo estimate is saved. Upload the required cabinet views and analyse the saved photos first.', target: 'photos' };
  if (input.latest.stale) return { message: 'The service details or photos changed after this analysis. Reopen the photo workspace if needed, then analyse the current saved photos before approving a date.', target: 'photos' };
  if (['queued', 'running'].includes(input.latest.status)) return { message: 'Your saved photo analysis is still processing. Date selection opens after a numeric estimate is ready.', target: 'photos' };
  if (input.latest.status !== 'succeeded') return { message: 'The photo analysis did not produce a current estimate. Check its saved status and retry the analysis before choosing a date.', target: 'photos' };
  if (input.latest.pricing?.status !== 'provisional_estimate' || input.latest.pricing.total == null) return { message: 'This analysis needs company review before it can provide a numeric estimate. Ask the company to review the estimate below. A preferred date cannot yet be approved.', target: 'photos' };
  if (!input.verified || input.needsLink) return { message: 'Verify the email saved on this specific quote and keep this quote first. Email verification protects your saved estimate; it does not make a booking.', target: 'email' };
  if (!input.loaded) return { message: 'Checking this quote’s saved approval and reservation status before opening dates.', target: 'status' };
  if (input.calendarError) return { message: 'The company calendar could not be fully checked. Refresh availability below to retry; unchecked dates stay unavailable.', target: 'calendar' };
  if (input.availabilityExpired) return { message: 'The calendar check has expired. Refresh availability before choosing a new date. An existing signature review keeps its own expiry and is checked again on submission.', target: 'calendar' };
  if (input.calendarBusy) return { message: 'Checking the complete company calendar. Available dates will open when this check finishes.', target: null };
  return { message: 'Choose an available door-removal date and Sydney time, continue to sign, then submit once. The company assigns the installation visit and sends booking confirmation.', target: null };
}
export function shouldRefreshBookingAvailability(input: { expired: boolean; showCalendar: boolean; disabled: boolean; busy: boolean; calendarBusy: boolean; pending: boolean; reviewing: boolean; calendarError: string }) {
  return input.expired && input.showCalendar && !input.disabled && !input.busy && !input.calendarBusy && !input.pending && !input.reviewing && !input.calendarError;
}
export function isSavedBookingDateRequestable(approval: { stale: boolean; preferredDate: string | null } | null | undefined, localDate: string, days: { date: string; selectable: boolean }[] | undefined) {
  return Boolean(approval && !approval.stale && approval.preferredDate && approval.preferredDate === localDate && days?.some(day => day.date === approval.preferredDate && day.selectable));
}
