import { runDemoDelivery, type DemoDeliveryDependencies, type DemoEmailJob, type DemoDeliveryCommand, type DemoDeliveryConfig } from '../../enquiries/delivery.ts'
import { createDemoPdfEmailPayload, type DemoEmailPayload } from '../../enquiries/documents.ts'
import type { BookingEmailWork } from '../domain/contracts.ts'
import { bookingCommand } from '../server.ts'

export interface BookingDeliveryDependencies {
  command: DemoDeliveryCommand
  request: typeof fetch
  now: () => number
  config: DemoDeliveryConfig
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
function configuration(): DemoDeliveryConfig {
  let local = false
  try { const url = new URL(process.env.APP_BASE_URL || ''); local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) } catch { /* Disabled without approved local origin. */ }
  return { enabled: process.env.QUOTE_DEMO_ENABLED === 'true' && local, apiKey: process.env.RESEND_API_KEY || '', from: process.env.RESEND_FROM_EMAIL || '', recipient: process.env.QUOTE_DEMO_RECIPIENT_EMAIL || '' }
}

/** Shares the quote queue's frozen-payload, fenced-lease and bounded retry rules. */
export async function runBookingDelivery(options: { id?: string; limit?: number } = {}, injected?: BookingDeliveryDependencies) {
  const deps = injected ?? { command: bookingCommand, request: fetch, now: Date.now, config: configuration() }
  const claimed = new Map<string, BookingEmailWork>()
  const convert = (value: unknown): unknown => {
    if (!object(value) || !object(value.snapshot) || value.snapshot.mode !== 'demo' || value.snapshot.version !== 'booking-demo-v1') return null
    const job = value as unknown as BookingEmailWork
    claimed.set(job.id, job)
    return {
      ...job, reference: job.snapshot.reference, submitted_at: job.consented_at,
      snapshot: job.snapshot.submission, email_attempts: 0, email_payload: job.email_payload as unknown as DemoEmailPayload | null,
    } satisfies DemoEmailJob
  }
  const adapter: DemoDeliveryDependencies = {
    ...deps, idempotencyPrefix: 'demo-booking',
    command: async (name, args) => {
      const result = await deps.command(name === 'claim' ? 'email_claim' : name, args)
      if (name === 'claim') return Array.isArray(result) ? result.map(convert) : result
      if (name === 'email_attempt' && object(result) && result.email_status !== 'outcome_unknown') return convert(result)
      return result
    },
    createPayload: async (source, from, recipient): Promise<DemoEmailPayload> => {
      const job = claimed.get(source.id)
      if (!job || job.snapshot.proposalId !== job.id || job.snapshot.submissionId !== job.booking_id || !job.consented_at) throw new Error('Invalid signed proposal')
      return createDemoPdfEmailPayload(source, from, recipient, {
        proposalId: job.id, revision: job.snapshot.proposalRevision, segments: job.snapshot.segments, notes: job.snapshot.notes,
      })
    },
  }
  return runDemoDelivery(options, adapter)
}
