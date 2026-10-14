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

import { BOOKING_SIMPLE_ACK_VERSION, isBookingAcknowledgment, parseBookingSignature, type LiveBookingAvailability, type LiveBookingReview, type LiveBookingSnapshot, type LiveBookingState, type LiveBookingSubmission } from '../domain/booking-flow.ts';
import { isRecord } from './request-client.ts';

function acknowledgmentMatches(value: unknown) {
  if (!isRecord(value) || typeof value.version !== 'string') return false;
  return isBookingAcknowledgment(value.version, value.text);
}
export function bookingTimeValid(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}
function dateValid(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function snapshotMatches(value: unknown, requestId: string): value is LiveBookingSnapshot {
  if (!isRecord(value) || value.requestId !== requestId || value.mode !== 'live' || value.kind !== 'nonbinding_booking_request' || !acknowledgmentMatches(value.acknowledgment) || !isRecord(value.acknowledgment) || value.version !== value.acknowledgment.version || !isRecord(value.pricing) || value.pricing.currency !== 'AUD' || value.pricing.amountUnit !== 'cents' || !Number.isSafeInteger(value.pricing.total) || Number(value.pricing.total) <= 0 || !Array.isArray(value.photos) || !isRecord(value.payload)) return false;
  if (value.preferredDate !== undefined && (!dateValid(value.preferredDate) || value.version === BOOKING_SIMPLE_ACK_VERSION && !bookingTimeValid(value.preferredTime))) return false;
  return true;
}
export function parseBookingSubmission(value: unknown, requestId: string): LiveBookingSubmission {
  if (!isRecord(value) || value.requestId !== requestId || typeof value.id !== 'string' || typeof value.reference !== 'string' || !dateValid(value.preferredDate) || typeof value.submittedAt !== 'string' || !Number.isFinite(Date.parse(value.submittedAt)) || typeof value.receiptReady !== 'boolean' || !['pending','sending','provider_accepted','retrying','failed','outcome_unknown','manual_review'].includes(String(value.emailStatus)) || !['not_required','blocked','pending','syncing','synced','retrying','conflict','manual_review'].includes(String(value.calendarStatus)) || !snapshotMatches(value.snapshot, requestId)) throw new Error('The saved booking request receipt could not be verified. Check its saved status.');
  if (value.snapshot.preferredDate !== undefined && value.snapshot.preferredDate !== value.preferredDate || value.snapshot.version === BOOKING_SIMPLE_ACK_VERSION && (!bookingTimeValid(value.preferredTime) || value.preferredTime !== value.snapshot.preferredTime || value.calendarStatus !== 'not_required')) throw new Error('The saved take-off date and time did not match the signed request.');
  parseBookingSignature(value.signature);
  return value as unknown as LiveBookingSubmission;
}
export function parseBookingState(body: Record<string, unknown>, requestId: string, requireVerified = true): LiveBookingState {
  const value = body.state;
  if (!isRecord(value) || value.requestId !== requestId || (typeof value.verified !== 'boolean' || requireVerified && value.verified !== true) || typeof value.canEdit !== 'boolean' || !acknowledgmentMatches(value.acknowledgment)) throw new Error('The saved estimate approval could not be verified. Reload its status.');
  if (value.approval !== null && (!isRecord(value.approval) || typeof value.approval.id !== 'string' || typeof value.approval.stale !== 'boolean' || !Number.isSafeInteger(value.approval.selectionRevision) || !snapshotMatches(value.approval.snapshot, requestId) || value.approval.preferredDate !== null && (!dateValid(value.approval.preferredDate) || value.approval.snapshot.version === BOOKING_SIMPLE_ACK_VERSION && !bookingTimeValid(value.approval.preferredTime)))) throw new Error('The saved estimate approval did not match this quote.');
  const submission = value.submission === null ? null : parseBookingSubmission(value.submission, requestId);
  if (submission && value.canEdit) throw new Error('The submitted request was not marked read only. Reload its status.');
  return { ...value, submission } as unknown as LiveBookingState;
}
export function parseBookingReview(body: Record<string, unknown>, requestId: string, approvalId: string, selectionRevision: number, selection?: { date: string; time: string }): LiveBookingReview {
  const value = body.review;
  if (!isRecord(value) || value.approvalId !== approvalId || value.selectionRevision !== selectionRevision || typeof value.reviewProof !== 'string' || !value.reviewProof || typeof value.snapshotHash !== 'string' || !snapshotMatches(value.snapshot, requestId) || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now() || selection && (value.snapshot.preferredDate !== selection.date || value.snapshot.preferredTime !== selection.time || value.snapshot.version !== BOOKING_SIMPLE_ACK_VERSION)) throw new Error('The review expired or no longer matches this request. Check your date and time again.');
  return value as unknown as LiveBookingReview;
}
export type BookingPreparationSelection = { date: string; time: string; availabilityRevision: string };
export type BookingAttempt = { path: string; method: string; body: string; review?: { approvalId: string; selectionRevision: number; selection?: { date: string; time: string } }; preparation?: BookingPreparationSelection & { analysisId: string; expectedRevision: number } };
/** The visible Continue button chains the existing safe commands. Each uncertain
 * write keeps its own original idempotency key; only its confirmed result advances. */
export function bookingPreparationAttempt(state: LiveBookingState, analysisId: string, expectedRevision: number, selection: BookingPreparationSelection, key: string): BookingAttempt {
  if (!dateValid(selection.date) || !bookingTimeValid(selection.time) || !selection.availabilityRevision || state.submission) throw new Error('Choose an available take-off date and enter a valid Sydney time.');
  const approval = state.approval;
  if (!approval || approval.stale || approval.analysisId !== analysisId || approval.inputRevision !== expectedRevision || approval.snapshot.version !== BOOKING_SIMPLE_ACK_VERSION) return { path: '/api/quote/requests/booking/approve', method: 'POST', body: JSON.stringify({ analysisId, expectedRevision, idempotencyKey: key }), preparation: { ...selection, analysisId, expectedRevision } };
  return bookingDateAttempt(approval.id, { ...selection, analysisId, expectedRevision }, key);
}
function bookingDateAttempt(approvalId: string, selection: BookingPreparationSelection & { analysisId: string; expectedRevision: number }, key: string): BookingAttempt {
  return { path: '/api/quote/requests/booking/date', method: 'PUT', body: JSON.stringify({ approvalId, preferredDate: selection.date, preferredTime: selection.time, availabilityRevision: selection.availabilityRevision, idempotencyKey: key }), preparation: selection };
}
export function bookingPreparationNext(attempt: BookingAttempt, state: LiveBookingState, key: string): BookingAttempt | null {
  if (!attempt.preparation || state.submission) return null;
  const approval = state.approval, selection = attempt.preparation;
  if (!approval || approval.stale || approval.snapshot.version !== BOOKING_SIMPLE_ACK_VERSION || approval.analysisId !== selection.analysisId || approval.inputRevision !== selection.expectedRevision) throw new Error('The saved estimate changed. Refresh its status before signing.');
  if (attempt.path.endsWith('/approve')) return bookingDateAttempt(approval.id, selection, key);
  if (!attempt.path.endsWith('/date') || approval.preferredDate !== selection.date || approval.preferredTime !== selection.time) throw new Error('Your saved take-off date and time did not match this selection. Refresh before signing.');
  return { path: '/api/quote/requests/booking/review', method: 'POST', body: JSON.stringify({ approvalId: approval.id, selectionRevision: approval.selectionRevision }), review: { approvalId: approval.id, selectionRevision: approval.selectionRevision, selection: { date: selection.date, time: selection.time } } };
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
  not_required: 'Calendar visits are managed through company booking confirmation; see the booking status below', blocked: 'Pending calendar entry waits for receipt email acceptance', pending: 'Pending calendar entry waiting to sync', syncing: 'Syncing pending calendar entry', synced: 'Pending confirmation entry synced to the company calendar; no date is reserved', retrying: 'Retrying pending calendar entry', conflict: 'Calendar conflict requires company review', manual_review: 'Calendar entry requires company review',
};

/** A successful status read cannot confirm an earlier approval/date/review command.
 * The original attempt stays retryable until its command responds or an immutable
 * submission proves that this quote is now read only. */
export function pendingBookingAttemptAfterRead<T>(attempt: T | null, state: Pick<LiveBookingState, 'submission'>): T | null {
  return state.submission ? null : attempt;
}
