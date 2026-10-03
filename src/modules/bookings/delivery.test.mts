import test from 'node:test'
import assert from 'node:assert/strict'
import { pdfFixture } from '../enquiries/infrastructure/demo-document.fixture.mts'
import { runBookingDelivery, type BookingDeliveryDependencies } from './delivery.ts'
import type { BookingEmailWork } from './domain/contracts.ts'

const NOW = Date.parse('2026-10-03T12:00:00Z')
function harness(responses: (Response | Error)[]) {
  const original = pdfFixture(), id = '11111111-2222-4333-8444-999999999999'
  const job: BookingEmailWork = {
    id, booking_id: original.id, created_at: original.submitted_at, consented_at: original.submitted_at,
    snapshot: { mode: 'demo', version: 'booking-demo-v1', submissionId: original.id, reference: original.reference, submission: original.snapshot, proposalId: id, proposalRevision: 1, resource: 'demo-single-resource', segments: [{ id: 'segment-one', startAt: '2026-10-12T22:00:00Z', endAt: '2026-10-13T00:00:00Z' }], notes: 'DEMO - new work times acknowledged.' },
    snapshot_hash: 'b'.repeat(64), signature: original.signature, email_status: 'pending', email_payload: null, email_first_attempt_at: null, email_provider_id: null, lease_generation: 1, lease_until: new Date(NOW + 120_000).toISOString(),
  }
  const events: string[] = [], sends: { key: string; body: string }[] = []
  let available = true, frozenFailure = false
  const deps: BookingDeliveryDependencies = {
    now: () => NOW, config: { enabled: true, apiKey: 'fake-key', from: 'L&K Demo <onboarding@resend.dev>', recipient: 'lnkgroupsydney@gmail.com' },
    command: async (command, args) => {
      events.push(command)
      if (command === 'email_claim') { if (!available) return []; available = false; return [structuredClone(job)] }
      if (command === 'email_attempt') {
        if (frozenFailure) throw new Error('Proposal superseded')
        if (job.email_payload) assert.deepEqual(args.payload, job.email_payload)
        job.email_payload ??= structuredClone(args.payload) as Record<string, unknown>
        job.email_first_attempt_at ??= new Date(NOW).toISOString()
        job.email_status = 'sending'; return structuredClone(job)
      }
      if (command === 'email_accepted') { job.email_status = 'provider_accepted'; job.email_provider_id = String(args.provider_id); return { emailStatus: 'provider_accepted' } }
      if (command === 'email_failed') { job.email_status = args.outcome as BookingEmailWork['email_status']; return {} }
      throw new Error('Unexpected command')
    },
    request: async (_url, init) => {
      events.push('provider_send')
      sends.push({ key: new Headers(init?.headers).get('Idempotency-Key')!, body: String(init?.body) })
      const response = responses.shift(); if (response instanceof Error) throw response
      return response!
    },
  }
  return { job, deps, events, sends, requeue: () => { available = true; job.lease_generation++ }, blockFreeze: () => { frozenFailure = true } }
}
test('signed schedule PDFs are frozen before company email acceptance, which does not confirm or enqueue a booking', async () => {
  const h = harness([Response.json({ id: 'schedule-mail-1' })])
  const result = await runBookingDelivery({}, h.deps)
  assert.deepEqual(h.events, ['email_claim', 'email_attempt', 'provider_send', 'email_accepted'])
  assert.equal(result.accepted, 1); assert.equal(result.calendarQueued, 0)
  assert.equal(h.sends[0].key, `demo-booking:${h.job.id}`)
  const payload = JSON.parse(h.sends[0].body)
  assert.deepEqual(payload.to, ['lnkgroupsydney@gmail.com'])
  assert.ok(payload.attachments.every((a: { filename: string; content: string }) => /schedule-1.*\.pdf$/.test(a.filename) && Buffer.from(a.content, 'base64').subarray(0, 5).toString() === '%PDF-'))
  assert.match(payload.text, /confirmation is still required/)
})
test('unknown booking send retries identical PDF bytes and provider key and stops after the bounded retry window', async () => {
  const h = harness([new Error('network timeout'), Response.json({ id: 'same-mail' })])
  assert.equal((await runBookingDelivery({}, h.deps)).retrying, 1)
  h.requeue(); h.deps.config.from = 'Updated <onboarding@resend.dev>'
  assert.equal((await runBookingDelivery({}, h.deps)).accepted, 1)
  assert.deepEqual(h.sends[0], h.sends[1])
  h.requeue(); h.job.email_status = 'retrying'; h.job.email_first_attempt_at = new Date(NOW - 23 * 3600_000).toISOString()
  assert.equal((await runBookingDelivery({}, h.deps)).reviewRequired, 1)
  assert.equal(h.sends.length, 2)
})
test('superseded proposal freeze failure, expired lease and unintended recipient cannot send mail', async () => {
  const h = harness([]); h.blockFreeze()
  assert.equal((await runBookingDelivery({}, h.deps)).storageErrors, 1); assert.equal(h.sends.length, 0)
  const expired = harness([]); expired.job.lease_until = new Date(NOW).toISOString()
  assert.equal((await runBookingDelivery({}, expired.deps)).retrying, 1); assert.equal(expired.sends.length, 0)
  const recipient = harness([]); recipient.deps.config.recipient = 'elsewhere@example.com'
  assert.equal((await runBookingDelivery({}, recipient.deps)).configurationMissing, true); assert.equal(recipient.events.length, 0)
})
