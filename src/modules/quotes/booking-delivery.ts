import { randomUUID } from 'node:crypto'
import { staffMailSender, type CompanyMailSender } from '../../shared/email/company-sender.ts'
import { BOOKING_SIMPLE_ACK_VERSION, type LiveBookingDeliveryClaim, type LiveBookingSubmission } from './domain/booking-flow.ts'
import { createFrozenBookingReceipt, validFrozenBookingReceipt, validateReceiptSource, type FrozenBookingReceipt } from './infrastructure/booking-receipt.ts'
import { ensureLivePendingCalendar } from './booking-calendar.ts'

export interface LiveBookingDeliveryDependencies {
  command: <T>(name: string, args: Record<string, unknown>) => Promise<T>
  request: typeof fetch; now: () => number
  config: { enabled: boolean; apiKey: string; sender: CompanyMailSender | null }
  createReceipt?: typeof createFrozenBookingReceipt
  calendar: typeof ensureLivePendingCalendar
}
export interface LiveBookingDeliveryResult {
  disabled: boolean; claimed: number; accepted: number; calendarSynced: number
  retrying: number; failed: number; reviewRequired: number; storageErrors: number; configurationMissing: boolean
}
const EMAIL_TIMEOUT_MS = 15_000
// The provider's 24-hour deduplication guarantee is bounded conservatively for clock/timeout uncertainty.
export const LIVE_BOOKING_EMAIL_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000
const CALENDAR_BUDGET_MS = 110_000
async function command<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { liveBookingStore } = await import('./infrastructure/booking-flow-store.ts')
  return liveBookingStore.command<T>(name, args)
}
function configuration(): LiveBookingDeliveryDependencies['config'] {
  let sender: CompanyMailSender | null = null
  try {
    if (process.env.COMPANY_EMAIL_FROM) sender = staffMailSender({ companyFrom: process.env.COMPANY_EMAIL_FROM, companyReplyTo: process.env.COMPANY_EMAIL_REPLY_TO })
  } catch { /* Invalid live configuration never falls back to a demo sender. */ }
  return { enabled: process.env.QUOTE_LIVE_ENABLED === 'true', apiKey: process.env.RESEND_API_KEY || '', sender }
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function validClaim(value: unknown, leaseToken: string): value is LiveBookingDeliveryClaim {
  if (!object(value) || value.leaseToken !== leaseToken || typeof value.leaseExpiresAt !== 'string' || !Number.isFinite(Date.parse(value.leaseExpiresAt)) || !object(value.submission) || typeof value.submission.id !== 'string') return false
  return value.emailIdempotencyKey === `live-booking-email:${value.submission.id}:v1` && /^[a-f0-9-]{36}$/i.test(value.submission.id)
}
async function providerJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []; let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > 16_384) { await reader.cancel(); return null }
      chunks.push(next.value)
    }
    return JSON.parse(Buffer.concat(chunks, length).toString('utf8')) as unknown
  } catch { return null }
  finally { reader.releaseLock() }
}
function safeFirstAttempt(value: string | null, now: number) {
  if (value === null) return true
  const started = Date.parse(value)
  return Number.isFinite(started) && started <= now + 60_000 && now - started < LIVE_BOOKING_EMAIL_RETRY_WINDOW_MS
}

/** One lease-backed delivery attempt. A queue/cron or explicit customer retry resumes interrupted work. */
export async function processLiveBookingDelivery(submissionId?: string, injected?: LiveBookingDeliveryDependencies): Promise<LiveBookingDeliveryResult> {
  if (typeof window !== 'undefined') throw new Error('Live booking delivery is server-only')
  const deps = injected ?? { command, request: fetch, now: Date.now, config: configuration(), calendar: ensureLivePendingCalendar }
  const result: LiveBookingDeliveryResult = { disabled: !deps.config.enabled, claimed: 0, accepted: 0, calendarSynced: 0, retrying: 0, failed: 0, reviewRequired: 0, storageErrors: 0, configurationMissing: false }
  if (!deps.config.enabled) return result
  if (submissionId !== undefined && !/^[a-f0-9-]{36}$/i.test(submissionId)) throw new Error('Invalid booking submission identifier')
  const leaseToken = randomUUID()
  let claim: LiveBookingDeliveryClaim | null
  try { claim = await deps.command<LiveBookingDeliveryClaim | null>('delivery_claim', { ...(submissionId ? { id: submissionId } : {}), leaseToken }) }
  catch { result.storageErrors++; result.failed++; return result }
  if (claim === null) return result
  if (!validClaim(claim, leaseToken)) { result.storageErrors++; result.failed++; return result }
  result.claimed++
  const lease = { id: claim.submission.id, leaseToken }
  const fail = async (stage: 'email' | 'calendar', outcome: 'retrying' | 'manual_review' | 'failed', error: string) => {
    try {
      const row = await deps.command<LiveBookingSubmission>('delivery_failed', { ...lease, stage, outcome, error })
      const status = stage === 'email' ? row?.emailStatus : row?.calendarStatus
      if (row?.id !== lease.id || status !== outcome) throw new Error('Delivery failure was not stored')
      if (outcome === 'retrying') result.retrying++
      else if (outcome === 'manual_review') result.reviewRequired++
      else result.failed++
    } catch { result.storageErrors++; result.failed++ }
  }
  let source = claim.submission
  try { validateReceiptSource(source) } catch { await fail('email', 'manual_review', 'booking_snapshot_invalid'); return result }
  if (source.emailStatus !== 'provider_accepted') {
    if (!safeFirstAttempt(claim.emailFirstAttemptAt, deps.now())) { await fail('email', 'manual_review', 'email_retry_window_expired'); return result }
    if (!deps.config.apiKey || !deps.config.sender) {
      result.configurationMissing = true; await fail('email', 'retrying', 'email_configuration_missing'); return result
    }
    let frozen: FrozenBookingReceipt
    try {
      frozen = claim.frozenReceipt as FrozenBookingReceipt ?? await (deps.createReceipt ?? createFrozenBookingReceipt)(source, deps.config.sender)
      if (!validFrozenBookingReceipt(frozen, source)) throw new Error('Invalid frozen receipt')
    } catch { await fail('email', 'manual_review', 'booking_receipt_invalid'); return result }
    if (Date.parse(claim.leaseExpiresAt) <= deps.now() + EMAIL_TIMEOUT_MS + 5_000) { await fail('email', 'retrying', 'delivery_lease_expiring'); return result }
    try {
      if (!claim.frozenReceipt) claim = await deps.command<LiveBookingDeliveryClaim>('delivery_freeze', { ...lease, ...frozen })
      if (!validClaim(claim, leaseToken) || !validFrozenBookingReceipt(claim.frozenReceipt, source)) throw new Error('Frozen receipt was not stored')
      claim = await deps.command<LiveBookingDeliveryClaim>('delivery_email_attempt', lease)
    } catch { result.storageErrors++; result.failed++; return result }
    if (!validClaim(claim, leaseToken) || !claim.frozenReceipt || !validFrozenBookingReceipt(claim.frozenReceipt, source) || claim.submission.id !== source.id || claim.submission.snapshotHash !== source.snapshotHash || !claim.emailFirstAttemptAt) {
      result.storageErrors++; result.failed++; return result
    }
    if (claim.submission.emailStatus === 'manual_review' || !safeFirstAttempt(claim.emailFirstAttemptAt, deps.now())) {
      await fail('email', 'manual_review', 'email_retry_window_expired'); return result
    }
    if (claim.submission.emailStatus !== 'sending' || Date.parse(claim.leaseExpiresAt) <= deps.now() + EMAIL_TIMEOUT_MS + 5_000) {
      await fail('email', 'retrying', 'delivery_lease_expiring'); return result
    }
    let response: Response
    try {
      response = await deps.request('https://api.resend.com/emails', {
        method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${deps.config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': claim.emailIdempotencyKey },
        // Use only the payload returned by the database after the lease-CAS attempt mutation.
        body: JSON.stringify(claim.frozenReceipt.payload),
      })
    } catch { await fail('email', 'retrying', 'email_outcome_unknown'); return result }
    const provider = await providerJson(response)
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500 || response.status === 409 && object(provider) && provider.name === 'concurrent_idempotent_requests') await fail('email', 'retrying', 'email_transient')
      else if (response.status === 409) await fail('email', 'manual_review', 'email_payload_conflict')
      else await fail('email', 'failed', response.status === 401 || response.status === 403 ? 'email_configuration' : 'email_rejected')
      return result
    }
    if (!object(provider) || typeof provider.id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(provider.id)) {
      await fail('email', 'retrying', 'email_outcome_unknown'); return result
    }
    try {
      source = await deps.command<LiveBookingSubmission>('delivery_email_accepted', { ...lease, providerMessageId: provider.id })
      if (source.id !== lease.id || source.emailStatus !== 'provider_accepted' || source.providerMessageId !== provider.id) throw new Error('Email acceptance was not stored')
      result.accepted++
    } catch { result.storageErrors++; result.failed++; return result }
  }
  // Provider acceptance means queued by Resend, not customer mailbox delivery. Never send again after acceptance.
  if (!source.providerMessageId) { await fail('calendar', 'manual_review', 'email_acceptance_invalid'); return result }
  if (source.snapshot.version === BOOKING_SIMPLE_ACK_VERSION) {
    try {
      const stored = await deps.command<LiveBookingSubmission>('delivery_request_complete', lease)
      if (stored.id !== source.id || stored.emailStatus !== 'provider_accepted' || stored.calendarStatus !== 'not_required' || stored.calendarEventId !== null) throw new Error('Receipt completion was not stored')
    } catch { result.storageErrors++; result.failed++ }
    return result
  }
  if (source.calendarStatus === 'synced') return result
  if (!['pending', 'syncing', 'retrying'].includes(source.calendarStatus)) { result.reviewRequired++; return result }
  if (Date.parse(claim.leaseExpiresAt) <= deps.now() + CALENDAR_BUDGET_MS) { await fail('calendar', 'retrying', 'delivery_lease_expiring'); return result }
  try {
    const event = await deps.calendar({ id: source.id, reference: source.reference, preferredDate: source.preferredDate, snapshotHash: source.snapshotHash, ...source.snapshot.calendarTarget, leaseExpiresAt: claim.leaseExpiresAt })
    if (!event.eventId || !event.etag) throw new Error('Calendar readback evidence missing')
    const stored = await deps.command<LiveBookingSubmission>('delivery_calendar_synced', { ...lease, eventId: event.eventId, eventEtag: event.etag })
    if (stored.id !== source.id || stored.emailStatus !== 'provider_accepted' || stored.calendarStatus !== 'synced' || stored.calendarEventId !== event.eventId) throw new Error('Calendar sync was not stored')
    result.calendarSynced++
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'calendar_review_required') await fail('calendar', 'manual_review', 'calendar_review_required')
    else await fail('calendar', 'retrying', 'calendar_sync_unverified')
  }
  return result
}

/** Scheduler backup: at most five sequential leases, reserving time for the final job to finish. */
export async function processLiveBookingDeliveryBatch(injected?: { processOne: () => Promise<LiveBookingDeliveryResult>; now: () => number }): Promise<LiveBookingDeliveryResult> {
  const processOne = injected?.processOne ?? (() => processLiveBookingDelivery())
  const now = injected?.now ?? Date.now, started = now()
  const total: LiveBookingDeliveryResult = { disabled: false, claimed: 0, accepted: 0, calendarSynced: 0, retrying: 0, failed: 0, reviewRequired: 0, storageErrors: 0, configurationMissing: false }
  const counters = ['claimed','accepted','calendarSynced','retrying','failed','reviewRequired','storageErrors'] as const
  for (let index = 0; index < 5 && now() - started < 120_000; index++) {
    const result = await processOne()
    for (const key of counters) total[key] += result[key]
    total.disabled ||= result.disabled
    total.configurationMissing ||= result.configurationMissing
    if (!result.claimed || result.disabled || result.storageErrors) break
  }
  return total
}
