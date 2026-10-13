import type { QuoteDraftInput } from './contracts.ts'
import { QuoteRequestError } from './contracts.ts'
import type { ProvisionalEstimatePricing } from './pricing.ts'

export const BOOKING_ACKNOWLEDGMENT_VERSION = 'live-booking-request-ack-v1'
export const BOOKING_ACKNOWLEDGMENT_TEXT = 'I acknowledge the provisional photo-based painting estimate and request the preferred start date shown here. Exact quantities, materials, repairs, scope, final price and work duration require company review and site confirmation. This request does not reserve a date, confirm a booking, authorise work, create a contract or require payment. Final terms and any confirmed booking require a separate company proposal and my acceptance.'
export const BOOKING_SIMPLE_ACK_VERSION = 'live-booking-request-ack-v2'
export const BOOKING_SIMPLE_ACK_TEXT = 'I acknowledge the provisional photo-based painting estimate and request the take-off date and Sydney time shown here. I agree that the company may assign the installation date and time and notify me in the booking confirmation email. Additional damage found on site may increase the price; any additional work and cost will be discussed before proceeding. No date is held until company confirmation. This request is not a contract, work authorisation or payment obligation.'
export type BookingAcknowledgmentVersion = typeof BOOKING_ACKNOWLEDGMENT_VERSION | typeof BOOKING_SIMPLE_ACK_VERSION
export const BOOKING_ACKNOWLEDGMENTS = {
  [BOOKING_ACKNOWLEDGMENT_VERSION]: BOOKING_ACKNOWLEDGMENT_TEXT,
  [BOOKING_SIMPLE_ACK_VERSION]: BOOKING_SIMPLE_ACK_TEXT,
} as const
export function bookingAcknowledgment(version: BookingAcknowledgmentVersion = BOOKING_SIMPLE_ACK_VERSION) {
  return { version, text: BOOKING_ACKNOWLEDGMENTS[version] }
}
export function isBookingAcknowledgment(version: unknown, text: unknown): boolean {
  return typeof version === 'string' && Object.hasOwn(BOOKING_ACKNOWLEDGMENTS, version) && BOOKING_ACKNOWLEDGMENTS[version as BookingAcknowledgmentVersion] === text
}
export interface LiveCalendarTarget { accountSub: string; calendarId: string }
export interface LiveBookingAvailability extends LiveCalendarTarget {
  month: string; minMonth: string; maxMonth: string
  days: { date: string; selectable: boolean; reason?: string }[]
  revision: string; checkedAt: string; expiresAt: string
}
export interface LiveBookingDateCheck extends LiveCalendarTarget { revision: string; checkedAt: string; expiresAt: string }
export interface LiveBookingPhoto { id: string; role: string; contentHash: string; objectPath?: string; width: number; height: number; storedBytes: number }
export interface LiveBookingSnapshot {
  mode: 'live'; kind: 'nonbinding_booking_request'; version: BookingAcknowledgmentVersion
  requestId: string; reference: string; inputRevision: number; analysisId: string
  payload: QuoteDraftInput; verifiedEmail: string; analysis: Record<string, unknown>; inputSnapshot?: Record<string, unknown>
  pricing: ProvisionalEstimatePricing; photos: LiveBookingPhoto[]
  acknowledgment: { version: BookingAcknowledgmentVersion; text: string }
  calendarTarget: LiveCalendarTarget; preferredDate?: string; preferredTime?: string | null
}
export interface LiveBookingSignature { name: string; method?: 'typed' | 'drawn'; strokes: { x: number; y: number }[][]; acknowledged: true }
export interface LiveBookingApproval {
  id: string; version: number; analysisId: string; inputRevision: number; approvedAt: string
  snapshot: LiveBookingSnapshot; snapshotHash: string; stale: boolean
  preferredDate: string | null; preferredTime?: string | null; selectionRevision: number; availabilityRevision: string | null
}
export type LiveEmailStatus = 'pending' | 'sending' | 'provider_accepted' | 'retrying' | 'failed' | 'outcome_unknown' | 'manual_review'
export type LiveCalendarStatus = 'not_required' | 'blocked' | 'pending' | 'syncing' | 'synced' | 'retrying' | 'conflict' | 'manual_review'
export interface LiveBookingSubmission {
  id: string; reference: string; requestId: string; approvalId: string; submittedAt: string; preferredDate: string; preferredTime?: string | null
  snapshot: LiveBookingSnapshot; snapshotHash: string; signedContentHash: string; signature: LiveBookingSignature
  emailStatus: LiveEmailStatus; calendarStatus: LiveCalendarStatus; error: string | null
  receiptReady: boolean; providerMessageId: string | null; calendarEventId: string | null
}
export interface LiveBookingState {
  requestId: string; verified: boolean; canEdit: boolean; approval: LiveBookingApproval | null
  submission: LiveBookingSubmission | null
  acknowledgment: { version: BookingAcknowledgmentVersion; text: string }
}
export interface LiveBookingApproveInput { analysisId: string; expectedRevision: number; idempotencyKey: string }
export interface LiveBookingDateInput { approvalId: string; preferredDate: string; preferredTime?: string | null; availabilityRevision: string; idempotencyKey: string }
export interface LiveBookingReviewInput { approvalId: string; selectionRevision: number }
export interface LiveBookingReview { snapshot: LiveBookingSnapshot; snapshotHash: string; reviewProof: string; expiresAt: string; approvalId: string; selectionRevision: number }
export interface LiveBookingSubmitInput { reviewProof: string; signature: LiveBookingSignature; idempotencyKey: string }
export interface LiveBookingReceipt { submission: LiveBookingSubmission; pdfBase64: string; pdfHash: string; payload: Record<string, unknown> }
export interface LiveBookingDeliveryClaim {
  submission: LiveBookingSubmission; leaseToken: string; leaseExpiresAt: string
  emailIdempotencyKey: string; emailFirstAttemptAt: string | null
  frozenReceipt: { pdfBase64: string; pdfHash: string; payload: Record<string, unknown> } | null
}
export interface LiveBookingReviewClaims {
  ownerHash: string; authUserId: string; requestId: string; approvalId: string
  selectionRevision: number; snapshotHash: string; expiresAt: string
}
export function bookingUuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) throw new QuoteRequestError(400, 'Invalid booking request identifier.')
  return value
}
export function bookingObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new QuoteRequestError(400, 'Booking request details required.')
  return value as Record<string, unknown>
}
export function bookingRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 2147483646) throw new QuoteRequestError(400, 'Invalid booking request revision.')
  return value as number
}
export function bookingDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new QuoteRequestError(400, 'Choose a valid preferred start date.')
  return value
}
export function bookingTime(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new QuoteRequestError(400, 'Choose a valid Sydney take-off time.')
  return value
}
export function validateBookingSignature(value: unknown): LiveBookingSignature {
  const row = bookingObject(value), method = row.method ?? 'drawn'
  if (Object.keys(row).some(key => !['name', 'method', 'strokes', 'acknowledged'].includes(key)) || typeof row.name !== 'string' || !row.name.trim() || row.name.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(row.name) || row.acknowledged !== true || !['typed', 'drawn'].includes(method as string) || !Array.isArray(row.strokes) || row.strokes.length > 100) throw new QuoteRequestError(400, 'Enter your name and acknowledge the booking request summary.')
  let points = 0, visible = false, minX = 1, maxX = 0, minY = 1, maxY = 0
  for (const stroke of row.strokes) {
    if (!Array.isArray(stroke) || stroke.length < 2) throw new QuoteRequestError(400, 'Complete your signature before submitting.')
    points += stroke.length
    for (const point of stroke) {
      const p = bookingObject(point)
      if (Object.keys(p).length !== 2 || !['x', 'y'].every(key => typeof p[key] === 'number' && Number.isFinite(p[key]) && (p[key] as number) >= 0 && (p[key] as number) <= 1)) throw new QuoteRequestError(400, 'Invalid signature points.')
      minX = Math.min(minX, p.x as number); maxX = Math.max(maxX, p.x as number); minY = Math.min(minY, p.y as number); maxY = Math.max(maxY, p.y as number)
    }
    if (stroke.some(point => point.x !== stroke[0].x || point.y !== stroke[0].y)) visible = true
  }
  if (points > 2000 || method === 'typed' && points !== 0 || method === 'drawn' && (!visible || points < 4 || Math.max(maxX - minX, maxY - minY) < .02)) throw new QuoteRequestError(400, 'Complete your signature before submitting.')
  return { name: row.name.trim(), method: method as 'typed' | 'drawn', strokes: row.strokes, acknowledged: true }
}
