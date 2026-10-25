import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { sydneyLocalToInstant, AppError } from '../../operations/access.ts'
import { after } from 'next/server.js'
import { AdminAccessError } from '../../admin-access/index.ts'
import { QuoteRequestError, type QuoteRequestActor, type QuoteRequestOwner } from '../domain/contracts.ts'
import { BOOKING_SIMPLE_ACK_VERSION, bookingDate, bookingTime, bookingObject, bookingRevision, bookingUuid, validateBookingSignature, type LiveBookingApproveInput, type LiveBookingDateCheck, type LiveBookingAvailability, type LiveBookingReceipt, type LiveBookingReview, type LiveBookingReviewClaims, type LiveBookingState, type LiveCalendarTarget } from '../domain/booking-flow.ts'
import type { QuoteRequestStore } from '../application/requests.ts'
import { liveBookingFlow, verifiedBookingOwnerArgs } from '../application/booking-flow.ts'
import { quoteRequestAccess } from './api.ts'
import { liveBookingStore } from './booking-flow-store.ts'
import { assertLiveBookingDate, readLiveBookingAvailability, resolveLiveCalendarTarget } from '../booking-calendar.ts'

interface BookingAccess {
  readOwner(req: Request): Promise<QuoteRequestOwner>; writeOwner(req: Request): Promise<QuoteRequestOwner>
  staff(req: Request): Promise<QuoteRequestActor>
}
export interface LiveBookingApiDependencies {
  access: BookingAccess; store: QuoteRequestStore; now(): number; reviewKey(): string | undefined
  calendarTarget(): Promise<LiveCalendarTarget>
  availability(month: string): Promise<LiveBookingAvailability>
  dateCheck(date: string, expectedRevision?: string): Promise<LiveBookingDateCheck>
  enqueue(submissionId: string): void
}
function publicValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['objectPath', 'inputSnapshot'].includes(key)).map(([key, item]) => [key, publicValue(item)]))
}
const json = (value: unknown, status = 200) => Response.json(publicValue(value), { status, headers: { 'cache-control': 'private, no-store', vary: 'Cookie', 'x-content-type-options': 'nosniff' } })
function exact(row: Record<string, unknown>, keys: string[]) {
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) throw new QuoteRequestError(400, 'Invalid booking request details.')
}
async function input(req: Request) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') ?? '')) throw new QuoteRequestError(415, 'JSON required.')
  const max = 180000, length = req.headers.get('content-length')
  if (length && (!/^\d+$/.test(length) || Number(length) > max)) throw new QuoteRequestError(413, 'The signature request is too large.')
  const reader = req.body?.getReader()
  if (!reader) throw new QuoteRequestError(400, 'Booking request details required.')
  const chunks: Uint8Array[] = []; let size = 0
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > max) { await reader.cancel(); throw new QuoteRequestError(413, 'The signature request is too large.') }; chunks.push(value) }
  try { return bookingObject(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))) } catch (error) { if (error instanceof QuoteRequestError) throw error; throw new QuoteRequestError(400, 'Invalid booking request details.') }
}
export function createLiveBookingApi(deps: LiveBookingApiDependencies) {
  const flow = liveBookingFlow(deps.store)
  function key() {
    const value = deps.reviewKey()
    if (!value || !/^[a-f0-9]{64}$/i.test(value)) throw new QuoteRequestError(503, 'Private booking review is unavailable. Your saved details are retained.')
    return createHash('sha256').update('live-booking-review-v1').update(Buffer.from(value, 'hex')).digest()
  }
  function proof(claims: LiveBookingReviewClaims) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv)
    cipher.setAAD(Buffer.from('live-booking-review-v1'))
    return Buffer.concat([iv, cipher.update(JSON.stringify(claims)), cipher.final(), cipher.getAuthTag()]).toString('base64url')
  }
  function claims(value: unknown, owner: QuoteRequestOwner): LiveBookingReviewClaims {
    if (typeof value !== 'string' || value.length < 80 || value.length > 2400 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new QuoteRequestError(400, 'Review the saved booking request summary before signing.')
    let row: Record<string, unknown>
    try {
      const bytes = Buffer.from(value, 'base64url'), decipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12))
      decipher.setAAD(Buffer.from('live-booking-review-v1')); decipher.setAuthTag(bytes.subarray(-16))
      row = bookingObject(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8')))
    } catch (error) { if (error instanceof QuoteRequestError && error.status === 503) throw error; throw new QuoteRequestError(409, 'Your booking request review changed. Review the summary again.') }
    if (row.ownerHash !== owner.hash || row.authUserId !== owner.customer?.authUserId || row.requestId !== owner.customer?.requestId || typeof row.snapshotHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.snapshotHash) || typeof row.expiresAt !== 'string' || !Number.isFinite(Date.parse(row.expiresAt))) throw new QuoteRequestError(403, 'This reviewed summary belongs to a different saved quote.')
    bookingUuid(row.approvalId); bookingRevision(row.selectionRevision)
    // SQL checks expiry for new submissions; successful response-loss replay may use its original proof.
    return row as unknown as LiveBookingReviewClaims
  }
  async function owner(req: Request, write = false) {
    const value = await (write ? deps.access.writeOwner(req) : deps.access.readOwner(req))
    verifiedBookingOwnerArgs(value)
    return value
  }
  const safe = (handler: (req: Request, id?: string) => Promise<Response>) => async (req: Request, id?: string) => {
    try { return await handler(req, id) } catch (error) {
      if (error instanceof QuoteRequestError || error instanceof AdminAccessError || error instanceof AppError) return json({ error: error.message, code: ({ 400: 'validation', 401: 'unauthorized', 403: 'forbidden', 404: 'notfound', 409: 'conflict', 413: 'validation', 415: 'validation', 429: 'rate_limit' } as Record<number, string>)[error.status] ?? 'unavailable' }, error.status)
      return json({ error: 'Your private booking request is temporarily unavailable. Saved details are retained; retry shortly.', code: 'unavailable' }, 503)
    }
  }
  return {
    state: safe(async req => json({ state: await flow.state(await owner(req)) })),
    availability: safe(async req => { await flow.state(await owner(req)); const month = new URL(req.url).searchParams.get('month'); if (!month || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new QuoteRequestError(400, 'Choose a valid calendar month.'); return json({ availability: await deps.availability(month) }) }),
    approve: safe(async req => {
      const current = await owner(req, true), row = await input(req); exact(row, ['analysisId', 'expectedRevision', 'idempotencyKey'])
      const value: LiveBookingApproveInput = { analysisId: bookingUuid(row.analysisId), expectedRevision: bookingRevision(row.expectedRevision), idempotencyKey: bookingUuid(row.idempotencyKey) }
      const replay = await flow.command<LiveBookingState | null>(current, 'replay', { operation: 'approve', ...value, acknowledgmentVersion: BOOKING_SIMPLE_ACK_VERSION })
      if (replay) return json({ state: replay })
      return json({ state: await flow.command<LiveBookingState>(current, 'approve', { ...value, acknowledgmentVersion: BOOKING_SIMPLE_ACK_VERSION, calendarTarget: await deps.calendarTarget() }) })
    }),
    date: safe(async req => {
      const current = await owner(req, true), row = await input(req); exact(row, ['approvalId', 'preferredDate', 'availabilityRevision', 'idempotencyKey', ...(Object.hasOwn(row, 'preferredTime') ? ['preferredTime'] : [])])
      const approvalId = bookingUuid(row.approvalId), preferredDate = bookingDate(row.preferredDate), idempotencyKey = bookingUuid(row.idempotencyKey)
      if (typeof row.availabilityRevision !== 'string' || !row.availabilityRevision || row.availabilityRevision.length > 256) throw new QuoteRequestError(400, 'Refresh the calendar before selecting a date.')
      const previous = await flow.state(current)
      const simple = previous.approval?.snapshot.version === BOOKING_SIMPLE_ACK_VERSION
      const preferredTime = simple ? bookingTime(row.preferredTime) : undefined
      if (!simple && Object.hasOwn(row, 'preferredTime') && row.preferredTime !== null) throw new QuoteRequestError(400, 'This existing acknowledgment supports a preferred date only.')
      const timeArgs = simple ? { preferredTime } : {}
      const replay = await flow.command<LiveBookingState | null>(current, 'replay', { operation: 'date', approvalId, preferredDate, ...timeArgs, idempotencyKey, availabilityRevision: row.availabilityRevision })
      if (replay) return json({ state: replay })
      if (simple && Date.parse(sydneyLocalToInstant(`${preferredDate}T${preferredTime}`)) <= deps.now()) throw new QuoteRequestError(409, 'Choose a future Sydney door-removal date and time.')
      const dateCheck = await deps.dateCheck(preferredDate, row.availabilityRevision)
      return json({ state: await flow.command<LiveBookingState>(current, 'date', { approvalId, preferredDate, ...timeArgs, idempotencyKey, availabilityRevision: row.availabilityRevision, dateCheck }) })
    }),
    review: safe(async req => {
      const current = await owner(req, true), row = await input(req); exact(row, ['approvalId', 'selectionRevision'])
      const approved = await flow.command<Omit<LiveBookingReview, 'reviewProof' | 'expiresAt'>>(current, 'review', { approvalId: bookingUuid(row.approvalId), selectionRevision: bookingRevision(row.selectionRevision) })
      const target = await deps.calendarTarget()
      if (target.calendarId !== approved.snapshot.calendarTarget.calendarId || target.accountSub !== approved.snapshot.calendarTarget.accountSub) throw new QuoteRequestError(409, 'The company calendar changed. Review and approve the estimate again.')
      const expiresAt = new Date(deps.now() + 15 * 60000).toISOString()
      return json({ review: { ...approved, expiresAt, reviewProof: proof({ ownerHash: current.hash, authUserId: current.customer!.authUserId, requestId: current.customer!.requestId, approvalId: approved.approvalId, selectionRevision: approved.selectionRevision, snapshotHash: approved.snapshotHash, expiresAt }) } })
    }),
    submit: safe(async req => {
      const current = await owner(req, true), row = await input(req); exact(row, ['reviewProof', 'signature', 'idempotencyKey'])
      const reviewed = claims(row.reviewProof, current), signature = validateBookingSignature(row.signature), idempotencyKey = bookingUuid(row.idempotencyKey)
      const previous = await flow.state(current)
      const dateCheck = previous.submission ? undefined : await deps.dateCheck(previous.approval?.preferredDate ?? '')
      const state = await flow.command<LiveBookingState>(current, 'submit', { approvalId: reviewed.approvalId, selectionRevision: reviewed.selectionRevision, snapshotHash: reviewed.snapshotHash, reviewExpiresAt: reviewed.expiresAt, signature, idempotencyKey, ...(dateCheck ? { dateCheck } : {}) })
      if (state.submission) deps.enqueue(state.submission.id)
      return json({ state })
    }),
    retry: safe(async req => { const current = await owner(req, true), row = await input(req); exact(row, []); const state = await flow.command<LiveBookingState>(current, 'retry', {}); if (state.submission && state.submission.calendarStatus !== 'synced') deps.enqueue(state.submission.id); return json({ state }) }),
    receipt: safe(async req => {
      const receipt = await flow.command<LiveBookingReceipt>(await owner(req), 'receipt', {})
      return new Response(Buffer.from(receipt.pdfBase64, 'base64'), { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${receipt.submission.reference}.pdf"`, 'cache-control': 'private, no-store', vary: 'Cookie', 'x-content-type-options': 'nosniff' } })
    }),
    staff: safe(async (req, id) => { const actor = await deps.access.staff(req); if (actor.companyId !== 'lk-group') throw new QuoteRequestError(403, 'Company access denied.'); return json({ state: await deps.store.command<LiveBookingState>('staff_state', { companyId: actor.companyId, actorUserId: actor.userId, actorSessionId: actor.sessionId, id: bookingUuid(id) }) }) }),
  }
}
const api = createLiveBookingApi({ access: quoteRequestAccess, store: liveBookingStore, now: Date.now, reviewKey: () => process.env.GOOGLE_TOKEN_ENCRYPTION_KEY, calendarTarget: resolveLiveCalendarTarget, availability: readLiveBookingAvailability, dateCheck: assertLiveBookingDate,
  enqueue: id => after(async () => { try { const { processLiveBookingDelivery } = await import('../booking-delivery.ts'); await processLiveBookingDelivery(id) } catch { /* Frozen submission and its durable outbox remain available for retry. */ } }),
})
export const liveBookingGet = api.state, liveBookingApprovePost = api.approve, liveBookingDatePut = api.date, liveBookingReviewPost = api.review, liveBookingSubmitPost = api.submit, liveBookingRetryPost = api.retry, liveBookingReceiptGet = api.receipt, liveBookingAvailabilityGet = api.availability, adminLiveBookingGet = api.staff
