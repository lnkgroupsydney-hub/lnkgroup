import { liveRequest } from './request-client.ts';

/** Every request remains bound to the quote visible in this tab, including reads. */
export function bookingRequest(path: string, requestId: string, init: RequestInit = {}) {
  return liveRequest(path, { ...init, headers: { ...init.headers, 'x-lk-quote-request-id': requestId } });
}

export function sydneyToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function shiftBookingMonth(month: string, delta: number): string {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}
export function bookingMonthDates(month: string): string[] {
  const end = Number(new Date(`${shiftBookingMonth(month, 1)}-01T12:00:00Z`).getTime() - new Date(`${month}-01T12:00:00Z`).getTime()) / 86_400_000;
  return Array.from({ length: end }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
export function bookingDateLabel(date: string): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', dateStyle: 'full' }).format(new Date(`${date}T12:00:00Z`));
}
/** Clearing an identity or quote invalidates every pending read and write response. */
export class BookingResponseLifetime {
  private version = 0;
  private open = true;
  begin() { return ++this.version; }
  accepts(version: number) { return this.open && version === this.version; }
  close() { this.open = false; this.version++; }
  reopen() { this.open = true; this.version++; }
}

import { BOOKING_ACKNOWLEDGMENT_TEXT, BOOKING_ACKNOWLEDGMENT_VERSION, validateBookingSignature, type LiveBookingAvailability, type LiveBookingReview, type LiveBookingSnapshot, type LiveBookingState, type LiveBookingSubmission } from '../domain/booking-flow.ts';
import { isRecord } from './request-client.ts';

function snapshotMatches(value: unknown, requestId: string): value is LiveBookingSnapshot {
  if (!isRecord(value) || value.requestId !== requestId || value.mode !== 'live' || value.kind !== 'nonbinding_booking_request' || value.version !== BOOKING_ACKNOWLEDGMENT_VERSION || !isRecord(value.acknowledgment) || value.acknowledgment.version !== BOOKING_ACKNOWLEDGMENT_VERSION || value.acknowledgment.text !== BOOKING_ACKNOWLEDGMENT_TEXT || !isRecord(value.pricing) || value.pricing.currency !== 'AUD' || value.pricing.amountUnit !== 'cents' || !Number.isSafeInteger(value.pricing.total) || Number(value.pricing.total) <= 0 || !Array.isArray(value.photos) || !isRecord(value.payload)) return false;
  return true;
}
export function parseBookingSubmission(value: unknown, requestId: string): LiveBookingSubmission {
  if (!isRecord(value) || value.requestId !== requestId || typeof value.id !== 'string' || typeof value.reference !== 'string' || typeof value.preferredDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.preferredDate) || typeof value.submittedAt !== 'string' || !Number.isFinite(Date.parse(value.submittedAt)) || typeof value.receiptReady !== 'boolean' || !['pending','sending','provider_accepted','retrying','failed','outcome_unknown','manual_review'].includes(String(value.emailStatus)) || !['blocked','pending','syncing','synced','retrying','conflict','manual_review'].includes(String(value.calendarStatus)) || !snapshotMatches(value.snapshot, requestId)) throw new Error('The saved booking request receipt could not be verified. Check its saved status.');
  validateBookingSignature(value.signature);
  return value as unknown as LiveBookingSubmission;
}
export function parseBookingState(body: Record<string, unknown>, requestId: string, requireVerified = true): LiveBookingState {
  const value = body.state;
  if (!isRecord(value) || value.requestId !== requestId || (typeof value.verified !== 'boolean' || requireVerified && value.verified !== true) || typeof value.canEdit !== 'boolean' || !isRecord(value.acknowledgment) || value.acknowledgment.version !== BOOKING_ACKNOWLEDGMENT_VERSION || value.acknowledgment.text !== BOOKING_ACKNOWLEDGMENT_TEXT) throw new Error('The saved estimate approval could not be verified. Reload its status.');
  if (value.approval !== null && (!isRecord(value.approval) || typeof value.approval.id !== 'string' || typeof value.approval.stale !== 'boolean' || !Number.isSafeInteger(value.approval.selectionRevision) || !snapshotMatches(value.approval.snapshot, requestId))) throw new Error('The saved estimate approval did not match this quote.');
  const submission = value.submission === null ? null : parseBookingSubmission(value.submission, requestId);
  if (submission && value.canEdit) throw new Error('The submitted request was not marked read only. Reload its status.');
  return { ...value, submission } as unknown as LiveBookingState;
}
export function parseBookingReview(body: Record<string, unknown>, requestId: string, approvalId: string, selectionRevision: number): LiveBookingReview {
  const value = body.review;
  if (!isRecord(value) || value.approvalId !== approvalId || value.selectionRevision !== selectionRevision || typeof value.reviewProof !== 'string' || !value.reviewProof || typeof value.snapshotHash !== 'string' || !snapshotMatches(value.snapshot, requestId) || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) throw new Error('The review expired or no longer matches this request. Check your date again.');
  return value as unknown as LiveBookingReview;
}
export function parseBookingAvailability(body: Record<string, unknown>, month: string): LiveBookingAvailability {
  const value = body.availability, dates = bookingMonthDates(month);
  if (!isRecord(value) || value.month !== month || typeof value.minMonth !== 'string' || !/^\d{4}-\d{2}$/.test(value.minMonth) || typeof value.maxMonth !== 'string' || !/^\d{4}-\d{2}$/.test(value.maxMonth) || month < value.minMonth || month > value.maxMonth || typeof value.revision !== 'string' || !value.revision || typeof value.checkedAt !== 'string' || !Number.isFinite(Date.parse(value.checkedAt)) || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now() || !Array.isArray(value.days) || value.days.length !== dates.length || value.days.some((day, i) => !isRecord(day) || day.date !== dates[i] || typeof day.selectable !== 'boolean' || day.reason !== undefined && typeof day.reason !== 'string')) throw new Error('Company availability could not be verified. Refresh the calendar before choosing a date.');
  return value as unknown as LiveBookingAvailability;
}
export const bookingEmailLabels: Record<LiveBookingSubmission['emailStatus'], string> = {
  pending: 'Receipt email waiting to send', sending: 'Sending receipt email', provider_accepted: 'Receipt email accepted by the email provider (inbox delivery is not confirmed)', retrying: 'Retrying receipt email', failed: 'Receipt email failed', outcome_unknown: 'Receipt email outcome is uncertain; company review required', manual_review: 'Receipt email requires company review',
};
export const bookingCalendarLabels: Record<LiveBookingSubmission['calendarStatus'], string> = {
  blocked: 'Pending calendar entry waits for receipt email acceptance', pending: 'Pending calendar entry waiting to sync', syncing: 'Syncing pending calendar entry', synced: 'Pending confirmation entry synced to the company calendar; no date is reserved', retrying: 'Retrying pending calendar entry', conflict: 'Calendar conflict requires company review', manual_review: 'Calendar entry requires company review',
};

/** A successful status read cannot confirm an earlier approval/date/review command.
 * The original attempt stays retryable until its command responds or an immutable
 * submission proves that this quote is now read only. */
export function pendingBookingAttemptAfterRead<T>(attempt: T | null, state: Pick<LiveBookingState, 'submission'>): T | null {
  return state.submission ? null : attempt;
}
