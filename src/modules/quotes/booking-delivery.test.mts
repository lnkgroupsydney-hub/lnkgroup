import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import { BOOKING_ACKNOWLEDGMENT_TEXT, BOOKING_ACKNOWLEDGMENT_VERSION, BOOKING_SIMPLE_ACK_VERSION, bookingAcknowledgment, type LiveBookingDeliveryClaim, type LiveBookingSubmission } from './domain/booking-flow.ts'
import { PREVIOUS_QUOTE_PRICING_VERSION as QUOTE_PRICING_VERSION, QUOTE_PRICING_VERSION as NO_GST_PRICING_VERSION } from './domain/pricing.ts'
import { createBookingReceiptPdf, createFrozenBookingReceipt, validFrozenBookingReceipt, type FrozenBookingReceipt } from './infrastructure/booking-receipt.ts'
import { processLiveBookingDelivery, processLiveBookingDeliveryBatch, LIVE_BOOKING_EMAIL_RETRY_WINDOW_MS, type LiveBookingDeliveryDependencies, type LiveBookingDeliveryResult } from './booking-delivery.ts'

const now = Date.parse('2026-10-12T04:00:00.000Z')
const sender = { from: 'L&K Group <quotes@lnkgroupsydney.com.au>', replyTo: 'lnkgroupsydney@gmail.com' }
function submission(): LiveBookingSubmission {
  const id = randomUUID(), requestId = randomUUID(), analysisId = randomUUID()
  const snapshot: LiveBookingSubmission['snapshot'] = {
    mode: 'live', kind: 'nonbinding_booking_request', version: BOOKING_ACKNOWLEDGMENT_VERSION, requestId, reference: 'LQ-TEST1234', inputRevision: 3, analysisId,
    payload: { contact: { name: '김 Customer', email: 'verified@example.invalid', phone: '0400000000', siteAddress: '1 Synthetic Street', suburb: 'Test', postcode: '2000', details: 'Saved details', consent: true }, service: { serviceId: 'cabinet-painting', intent: 'full-repainting', surfaces: ['doors'], doorCount: null, drawerCount: null, material: 'Painted timber', colourPreference: 'White' } },
    verifiedEmail: 'verified@example.invalid', analysis: { estimateScope: { assumptions: ['Exact dimensions require confirmation.'], description: 'Main kitchen fronts' } }, inputSnapshot: { sourceHash: 'c'.repeat(64) },
    pricing: { status: 'provisional_estimate', currency: 'AUD', pricingVersion: QUOTE_PRICING_VERSION, amountUnit: 'cents', minimumSubtotal: 150000, gstRateBps: 1000, lineItems: [{ code: 'doors', label: 'Estimated cabinet door preparation and painting', quantity: 10, unitAmount: 15000, amount: 150000 }], subtotal: 150000, tax: 15000, total: 165000, reviewReasons: ['Confirm quantities on site.'], notice: 'Provisional photo-based estimate. Final price requires site confirmation.', amountScope: 'painting_only', siteConfirmationRequired: true, basis: { type: 'ai_estimated_quantities', extent: 'whole_project', anchorPhotoId: 'photo-1', doors: 10, drawers: 0 }, exclusions: [] },
    photos: [{ id: 'photo-1', role: 'overview', contentHash: 'b'.repeat(64), objectPath: 'PRIVATE-OBJECT-PATH-MUST-NOT-EXPORT', width: 1000, height: 700, storedBytes: 10000 }],
    acknowledgment: { version: BOOKING_ACKNOWLEDGMENT_VERSION, text: BOOKING_ACKNOWLEDGMENT_TEXT }, calendarTarget: { accountSub: 'company-sub', calendarId: 'company-calendar' }, preferredDate: '2026-11-01',
  }
  return { id, reference: snapshot.reference, requestId, approvalId: randomUUID(), submittedAt: new Date(now).toISOString(), preferredDate: '2026-11-01', snapshot, snapshotHash: 'a'.repeat(64), signedContentHash: 'd'.repeat(64), signature: { name: '김 Customer', method: 'typed', acknowledged: true, strokes: [] }, emailStatus: 'pending', calendarStatus: 'blocked', error: null, receiptReady: false, providerMessageId: null, calendarEventId: null }
}
let realReceipt: FrozenBookingReceipt | undefined
async function fixtureReceipt() { return realReceipt ??= await createFrozenBookingReceipt(submission(), sender) }
function harness(options: { source?: LiveBookingSubmission; request?: typeof fetch; calendarError?: Error; storageFail?: string; firstAttempt?: string; frozen?: FrozenBookingReceipt; clock?: number } = {}) {
  const source = options.source ?? submission()
  let claim: LiveBookingDeliveryClaim | null = null, frozen = options.frozen ?? null
  let busy = false, calls = 0, calendarCalls = 0, receiptCalls = 0
  const commands: string[] = [], payloads: string[] = [], keys: string[] = []
  let firstAttempt = options.firstAttempt ?? null
  const deps: LiveBookingDeliveryDependencies = {
    config: { enabled: true, apiKey: 'synthetic-api-key', sender }, now: () => options.clock ?? now,
    async command<T>(command: string, args: Record<string, unknown>): Promise<T> {
      commands.push(command)
      if (options.storageFail === command) throw new Error('Synthetic storage failure')
      if (command === 'delivery_claim') {
        if (busy || source.calendarStatus === 'synced' || source.calendarStatus === 'not_required' && source.emailStatus === 'provider_accepted' || args.id && args.id !== source.id) return null as T
        busy = true
        claim = { submission: structuredClone(source), leaseToken: String(args.leaseToken), leaseExpiresAt: new Date(now + 240000).toISOString(), emailIdempotencyKey: `live-booking-email:${source.id}:v1`, emailFirstAttemptAt: firstAttempt, frozenReceipt: frozen }
        return structuredClone(claim) as T
      }
      assert.equal(args.leaseToken, claim!.leaseToken)
      assert.equal(args.id, source.id)
      if (command === 'delivery_freeze') { frozen ??= { pdfBase64: String(args.pdfBase64), pdfHash: String(args.pdfHash), payload: args.payload as FrozenBookingReceipt['payload'] }; source.receiptReady = true }
      if (command === 'delivery_email_attempt') { firstAttempt ??= new Date(now).toISOString(); source.emailStatus = 'sending' }
      if (command === 'delivery_email_accepted') { source.emailStatus = 'provider_accepted'; source.providerMessageId = String(args.providerMessageId); if(source.calendarStatus !== 'not_required') source.calendarStatus = 'pending' }
      if (command === 'delivery_request_complete') { assert.equal(source.snapshot.version, BOOKING_SIMPLE_ACK_VERSION); assert.equal(source.emailStatus, 'provider_accepted'); source.calendarStatus = 'not_required'; busy = false }
      if (command === 'delivery_calendar_synced') { assert.ok(args.eventEtag); source.calendarStatus = 'synced'; source.calendarEventId = String(args.eventId); busy = false }
      if (command === 'delivery_failed') { source.error = String(args.error); if (args.stage === 'email') source.emailStatus = args.outcome as LiveBookingSubmission['emailStatus']; else source.calendarStatus = args.outcome as LiveBookingSubmission['calendarStatus']; busy = false }
      claim = { ...claim!, submission: structuredClone(source), frozenReceipt: frozen, emailFirstAttemptAt: firstAttempt }
      return structuredClone(command === 'delivery_freeze' || command === 'delivery_email_attempt' ? claim : source) as T
    },
    async createReceipt(s) { receiptCalls++; const base = structuredClone(await fixtureReceipt()); base.payload.to = [s.snapshot.verifiedEmail]; return base },
    request: (async (url, init) => { calls++; payloads.push(String(init?.body)); keys.push(new Headers(init?.headers).get('Idempotency-Key')!); return options.request ? options.request(url, init) : Response.json({ id: 'provider-123' }) }) as typeof fetch,
    async calendar(input) { calendarCalls++; assert.equal(source.emailStatus, 'provider_accepted'); assert.equal(input.calendarId, source.snapshot.calendarTarget.calendarId); if (options.calendarError) throw options.calendarError; return { eventId: 'event-123', etag: '"etag-readback"', eventUrl: null } },
  }
  return { deps, commands, payloads, keys, source: () => source, metrics: () => ({ calls, calendarCalls, receiptCalls }), unlock: () => { busy = false } }
}

test('receipt PDF is deterministic, contains frozen signature metadata and keeps photo access private', async () => {
  const source = submission()
  const a = await createBookingReceiptPdf(source), b = await createBookingReceiptPdf(source)
  assert.deepEqual(a.bytes, b.bytes); assert.equal(a.sha256, createHash('sha256').update(a.bytes).digest('hex'))
  const pdf = await PDFDocument.load(a.bytes)
  assert.match(pdf.getSubject()!, /Nonbinding/); assert.ok(pdf.getPageCount() >= 2)
  assert.equal(Buffer.from(a.bytes).includes(Buffer.from(source.snapshot.photos[0].objectPath)), false)
  const frozen = await createFrozenBookingReceipt(source, sender)
  assert.ok(validFrozenBookingReceipt(frozen, source)); assert.deepEqual(frozen.payload.to, [source.snapshot.verifiedEmail]); assert.equal(frozen.payload.attachments.length, 1)
  assert.equal(frozen.payload.reply_to, sender.replyTo); assert.match(frozen.payload.text, /nonbinding/); assert.doesNotMatch(frozen.payload.subject, /demo|contract/i)
})
test('new no-GST receipt uses the signed A$1,450 total and rejects an added tax', async () => {
  const source = submission()
  source.snapshot.pricing = { ...source.snapshot.pricing, pricingVersion: NO_GST_PRICING_VERSION, minimumSubtotal: 145000, gstRateBps: 0,
    lineItems: [{ code: 'doors', label: 'Estimated cabinet door preparation and painting', quantity: 8, unitAmount: 15000, amount: 120000 }, { code: 'minimum_adjustment', label: 'Minimum painting charge adjustment', quantity: 1, unitAmount: 25000, amount: 25000 }],
    basis: { type: 'ai_estimated_quantities', extent: 'whole_project', anchorPhotoId: 'photo-1', doors: 8, drawers: 0 }, subtotal: 145000, tax: 0, total: 145000 }
  const receipt = await createFrozenBookingReceipt(source, sender)
  assert.ok(validFrozenBookingReceipt(receipt, source))
  assert.match(receipt.payload.text, /provisional estimate: AUD 1450\.00\. No GST charged\. The supplier is not registered for GST\./)
  assert.match(receipt.payload.html, /No GST charged/)
  assert.doesNotMatch(receipt.payload.text, /incl GST|excluding GST|\+ GST/)
  assert.deepEqual(Buffer.from((await createBookingReceiptPdf(source)).bytes), Buffer.from(receipt.pdfBase64, 'base64'))
  const changed = structuredClone(source); changed.snapshot.pricing.tax = 14500; changed.snapshot.pricing.total = 159500
  await assert.rejects(createBookingReceiptPdf(changed))
})
test('drawn signature and long saved content produce a valid private receipt', async () => {
  const source = submission(); source.signature = { name: 'Drawn signer', method: 'drawn', acknowledged: true, strokes: [[{ x: .1, y: .2 }, { x: .3, y: .5 }, { x: .5, y: .3 }, { x: .9, y: .8 }]] }
  source.snapshot.payload.contact.details = 'Long project details with local characters. '.repeat(100)
  assert.ok(validFrozenBookingReceipt(await createFrozenBookingReceipt(source, sender), source))
})
test('single-signature request freezes take-off time and installation delegation without a second approval notice', async () => {
  const source = submission(); source.preferredTime = '10:30'; source.snapshot.preferredTime = '10:30'
  source.snapshot.version = BOOKING_SIMPLE_ACK_VERSION; source.snapshot.acknowledgment = bookingAcknowledgment(); source.calendarStatus = 'not_required'
  const receipt = await createFrozenBookingReceipt(source, sender)
  assert.ok(validFrozenBookingReceipt(receipt, source)); assert.match(receipt.payload.text, /Requested door-removal \(take-off\): 2026-11-01 10:30 \(Sydney/)
  assert.match(receipt.payload.text, /No further online approval/); assert.doesNotMatch(receipt.payload.text, /separate proposal and your acceptance/)
  for (const change of [s => { s.preferredTime = '11:30' }, s => { s.snapshot.preferredTime = null }, s => { s.preferredTime = '24:00'; s.snapshot.preferredTime = '24:00' }]) {
    const changed = structuredClone(source); change(changed); await assert.rejects(createBookingReceiptPdf(changed))
  }
  const legacy = submission(); legacy.preferredTime = '10:30'; await assert.rejects(createBookingReceiptPdf(legacy))
})
test('new request receipt completes without creating a provisional Google Calendar event or another email', async () => {
  const source = submission(); source.preferredTime = '10:30'; source.snapshot.preferredTime = '10:30'
  source.snapshot.version = BOOKING_SIMPLE_ACK_VERSION; source.snapshot.acknowledgment = bookingAcknowledgment(); source.calendarStatus = 'not_required'
  const h = harness({ source }); h.deps.createReceipt = s => createFrozenBookingReceipt(s, sender)
  const result = await processLiveBookingDelivery(undefined, h.deps)
  assert.equal(result.accepted, 1); assert.equal(result.calendarSynced, 0); assert.equal(result.storageErrors, 0)
  assert.equal(h.metrics().calendarCalls, 0); assert.equal(h.source().calendarStatus, 'not_required'); assert.equal(h.source().calendarEventId, null)
  assert.deepEqual(h.commands, ['delivery_claim','delivery_freeze','delivery_email_attempt','delivery_email_accepted','delivery_request_complete'])
  assert.equal((await processLiveBookingDelivery(undefined, h.deps)).claimed, 0); assert.equal(h.metrics().calls, 1)
})
test('receipt rejects mismatched verified recipient, changed money, wrong ack and altered PDF', async () => {
  for (const modify of [s => { s.snapshot.payload.contact.email = 'other@example.invalid' }, s => { s.snapshot.pricing.total!++ }, s => { s.snapshot.acknowledgment.text = 'Wrong acknowledgment' as typeof BOOKING_ACKNOWLEDGMENT_TEXT }]) {
    const s = submission(); modify(s); await assert.rejects(createBookingReceiptPdf(s))
  }
  const s = submission(), receipt = await createFrozenBookingReceipt(s, sender)
  assert.equal(validFrozenBookingReceipt({ ...receipt, pdfHash: 'f'.repeat(64) }, s), false)
  assert.equal(validFrozenBookingReceipt({ ...receipt, payload: { ...receipt.payload, to: ['other@example.invalid'] } }, s), false)
  assert.equal(validFrozenBookingReceipt({ ...receipt, payload: { ...receipt.payload, bcc: 'other@example.invalid' } }, s), false)
})
test('freeze and first attempt are persisted before send; email acceptance gates calendar and readback CAS', async () => {
  const h = harness(), result = await processLiveBookingDelivery(undefined, h.deps)
  assert.equal(result.accepted, 1); assert.equal(result.calendarSynced, 1)
  assert.deepEqual(h.commands, ['delivery_claim','delivery_freeze','delivery_email_attempt','delivery_email_accepted','delivery_calendar_synced'])
  assert.deepEqual(h.metrics(), { calls: 1, calendarCalls: 1, receiptCalls: 1 })
  assert.equal(h.source().emailStatus, 'provider_accepted'); assert.equal(h.source().calendarStatus, 'synced')
})
test('concurrent workers claim only once and a complete job never sends again', async () => {
  const h = harness(); const results = await Promise.all([processLiveBookingDelivery(undefined, h.deps), processLiveBookingDelivery(undefined, h.deps)])
  assert.equal(results.reduce((n, r) => n + r.claimed, 0), 1)
  assert.equal(h.metrics().calls, 1)
  assert.equal((await processLiveBookingDelivery(undefined, h.deps)).claimed, 0)
})
test('ambiguous response retries identical frozen payload and stable submission key', async () => {
  let attempt = 0
  const h = harness({ request: async () => { if (++attempt === 1) throw new Error('Network result unknown'); return Response.json({ id: 'provider-123' }) } })
  assert.equal((await processLiveBookingDelivery(undefined, h.deps)).retrying, 1)
  assert.equal(h.metrics().calendarCalls, 0)
  assert.equal((await processLiveBookingDelivery(undefined, h.deps)).calendarSynced, 1)
  assert.equal(h.payloads[0], h.payloads[1]); assert.equal(h.keys[0], h.keys[1]); assert.equal(h.metrics().receiptCalls, 1)
})
test('uncertain provider result beyond deduplication window requires review without a new send', async () => {
  const h = harness({ firstAttempt: new Date(now - LIVE_BOOKING_EMAIL_RETRY_WINDOW_MS).toISOString() })
  const result = await processLiveBookingDelivery(undefined, h.deps)
  assert.equal(result.reviewRequired, 1); assert.equal(h.metrics().calls, 0); assert.equal(h.metrics().calendarCalls, 0); assert.equal(h.source().emailStatus, 'manual_review')
})
test('non-JSON accepted response preserves uncertainty and never queues calendar', async () => {
  const h = harness({ request: async () => new Response('accepted but no id', { status: 200 }) })
  assert.equal((await processLiveBookingDelivery(undefined, h.deps)).retrying, 1); assert.equal(h.metrics().calendarCalls, 0); assert.equal(h.source().error, 'email_outcome_unknown')
})
test('provider failure statuses distinguish retry, failed and payload conflict, preserving mail gate', async () => {
  for (const [status, outcome] of [[429,'retrying'],[503,'retrying'],[403,'failed'],[422,'failed'],[409,'manual_review']] as const) {
    const h = harness({ request: async () => Response.json({ name: 'provider_error' }, { status }) })
    await processLiveBookingDelivery(undefined, h.deps); assert.equal(h.source().emailStatus, outcome); assert.equal(h.metrics().calendarCalls, 0)
  }
})
test('provider acceptance cannot start calendar before DB lease-CAS acceptance succeeds', async () => {
  const h = harness({ storageFail: 'delivery_email_accepted' })
  const result = await processLiveBookingDelivery(undefined, h.deps)
  assert.equal(result.storageErrors, 1); assert.equal(h.metrics().calls, 1); assert.equal(h.metrics().calendarCalls, 0); assert.equal(h.source().emailStatus, 'sending')
})
test('frozen receipt DB failure cannot make an external call', async () => {
  for (const storageFail of ['delivery_freeze','delivery_email_attempt']) {
    const h = harness({ storageFail }); assert.equal((await processLiveBookingDelivery(undefined, h.deps)).storageErrors, 1)
    assert.equal(h.metrics().calls, 0); assert.equal(h.metrics().calendarCalls, 0)
  }
})
test('stored provider acceptance reconciles calendar without regenerating or sending mail', async () => {
  const source = submission(); source.emailStatus = 'provider_accepted'; source.providerMessageId = 'provider-123'; source.calendarStatus = 'pending'
  const h = harness({ source }); h.deps.config.apiKey = ''; h.deps.config.sender = null
  const result = await processLiveBookingDelivery(undefined, h.deps)
  assert.equal(result.calendarSynced, 1); assert.equal(h.metrics().calls, 0); assert.equal(h.metrics().receiptCalls, 0)
})
test('calendar transient failure retains provider acceptance and retries only calendar', async () => {
  const h = harness({ calendarError: new Error('Readback failed') })
  assert.equal((await processLiveBookingDelivery(undefined, h.deps)).retrying, 1)
  assert.equal(h.source().emailStatus, 'provider_accepted'); assert.equal(h.source().calendarStatus, 'retrying')
  h.deps.calendar = async () => ({ eventId: 'event-123', etag: '"etag-readback"', eventUrl: null })
  assert.equal((await processLiveBookingDelivery(undefined, h.deps)).calendarSynced, 1); assert.equal(h.metrics().calls, 1)
})
test('calendar review-required evidence prevents completion', async () => {
  const error = Object.assign(new Error('Event differs from frozen request'), { code: 'calendar_review_required' })
  const h = harness({ calendarError: error })
  assert.equal((await processLiveBookingDelivery(undefined, h.deps)).reviewRequired, 1); assert.equal(h.source().calendarStatus, 'manual_review'); assert.equal(h.source().emailStatus, 'provider_accepted')
})
test('disabled or missing company configuration does not send; short leases remain recoverable', async () => {
  const disabled = harness(); disabled.deps.config.enabled = false
  assert.equal((await processLiveBookingDelivery(undefined, disabled.deps)).disabled, true); assert.equal(disabled.commands.length, 0)
  const missing = harness(); missing.deps.config.sender = null
  assert.equal((await processLiveBookingDelivery(undefined, missing.deps)).configurationMissing, true); assert.equal(missing.metrics().calls, 0)
  const expired = harness({ clock: now + 230000 })
  assert.equal((await processLiveBookingDelivery(undefined, expired.deps)).retrying, 1); assert.equal(expired.metrics().calls, 0)
})
test('daily scheduler caps its batch and reserves time for the final leased job', async () => {
  const base: LiveBookingDeliveryResult = { disabled: false, claimed: 1, accepted: 1, calendarSynced: 1, retrying: 0, failed: 0, reviewRequired: 0, storageErrors: 0, configurationMissing: false }
  let count = 0, time = now
  const capped = await processLiveBookingDeliveryBatch({ now: () => time, processOne: async () => { count++; return base } })
  assert.equal(count, 5); assert.equal(capped.accepted, 5)
  count = 0; time = now
  const bounded = await processLiveBookingDeliveryBatch({ now: () => time, processOne: async () => { count++; time += 70_000; return base } })
  assert.equal(count, 2); assert.equal(bounded.calendarSynced, 2)
  count = 0
  const empty = await processLiveBookingDeliveryBatch({ now: () => now, processOne: async () => { count++; return { ...base, claimed: 0, accepted: 0, calendarSynced: 0 } } })
  assert.equal(count, 1); assert.equal(empty.claimed, 0)
})
