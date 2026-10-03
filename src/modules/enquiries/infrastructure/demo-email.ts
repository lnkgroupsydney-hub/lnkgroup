import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { DEMO_RECIPIENT, type DemoDocumentSource, type DemoEmailPayload } from './demo-documents.ts'
import { createDemoPdfEmailPayload } from './demo-pdf.ts'

export interface DemoEmailJob extends DemoDocumentSource {
  lease_generation: number
  lease_until: string
  email_status: string
  email_payload: DemoEmailPayload | null
  email_first_attempt_at: string | null
  email_attempts: number
  email_provider_id: string | null
}
export type DemoDeliveryCommand = (command: string, args: Record<string, unknown>) => Promise<unknown>
export interface DemoDeliveryConfig { enabled: boolean; apiKey: string; from: string; recipient: string }
export interface DemoDeliveryDependencies {
  command: DemoDeliveryCommand
  request: typeof fetch
  now: () => number
  config: DemoDeliveryConfig
  createPayload?: (job: DemoEmailJob, from: string, recipient: string) => Promise<DemoEmailPayload>
  idempotencyPrefix?: 'demo-quote' | 'demo-booking'
}
export interface DemoDeliveryResult {
  disabled: boolean
  claimed: number
  accepted: number
  retrying: number
  failed: number
  reviewRequired: number
  calendarQueued: number
  storageErrors: number
  configurationMissing: boolean
}
// Resend guarantees 24 hours. Stop one hour early, allowing for clocks and delayed requests.
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 15_000
const COMPANY_FROM = /^(?:onboarding@resend\.dev|[^<>\r\n]{1,100}<onboarding@resend\.dev>)$/i

async function command(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (typeof window !== 'undefined') throw new Error('Demonstration delivery is server-only')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, secret = process.env.SUPABASE_SECRET_KEY
  if (process.env.OPERATIONS_STORE !== 'supabase' || !url || !secret) throw new Error('Demonstration delivery storage is unavailable')
  const db = createClient(url, secret, { auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}, global:{fetch:(url,init)=>fetch(url,{...init,cache:'no-store',signal:AbortSignal.timeout(20_000)})} })
  const result = await db.rpc('lk_quote_submission', { command:name, args })
  if (result.error) throw new Error('Demonstration delivery storage operation failed')
  return result.data
}
function configuration(): DemoDeliveryConfig {
  return { enabled:process.env.QUOTE_DEMO_ENABLED === 'true', apiKey:process.env.RESEND_API_KEY || '', from:process.env.RESEND_FROM_EMAIL || '', recipient:process.env.QUOTE_DEMO_RECIPIENT_EMAIL || '' }
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function isJob(value: unknown): value is DemoEmailJob {
  return record(value) && typeof value.id === 'string' && /^[a-f0-9-]{36}$/i.test(value.id) && Number.isSafeInteger(value.lease_generation) && Number(value.lease_generation) >= 1 && typeof value.lease_until === 'string' && typeof value.email_status === 'string'
}
export function validFrozenDemoPayload(payload: unknown): payload is DemoEmailPayload {
  if (!record(payload) || Object.keys(payload).some(key => !['from','to','subject','html','text','attachments'].includes(key)) ||
      typeof payload.from !== 'string' || !COMPANY_FROM.test(payload.from) || !Array.isArray(payload.to) || payload.to.length !== 1 || payload.to[0] !== DEMO_RECIPIENT ||
      typeof payload.subject !== 'string' || !payload.subject.startsWith('[DEMO]') || /[\r\n]/.test(payload.subject) || payload.subject.length > 200 ||
      typeof payload.html !== 'string' || typeof payload.text !== 'string' || payload.html.length > 200_000 || payload.text.length > 200_000 ||
      !Array.isArray(payload.attachments) || payload.attachments.length !== 2) return false
  return payload.attachments.every(item => record(item) && Object.keys(item).every(key => ['filename','content'].includes(key)) &&
    typeof item.filename === 'string' && /^[A-Za-z0-9-]{1,100}\.(?:html|pdf)$/.test(item.filename) && typeof item.content === 'string' &&
    item.content.length > 0 && item.content.length < 1_000_000 && /^[A-Za-z0-9+/]*={0,2}$/.test(item.content))
}
async function providerJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) return null
  let length = 0
  const chunks: Uint8Array[] = []
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

/** Bounded durable queue work. No GET route should call this function. */
export async function runDemoDelivery(options: { id?: string; limit?: number } = {}, injected?: DemoDeliveryDependencies): Promise<DemoDeliveryResult> {
  const deps = injected ?? { command, request:fetch, now:Date.now, config:configuration() }
  const result: DemoDeliveryResult = {disabled:!deps.config.enabled,claimed:0,accepted:0,retrying:0,failed:0,reviewRequired:0,calendarQueued:0,storageErrors:0,configurationMissing:false}
  if (!deps.config.enabled) return result
  if (!deps.config.apiKey || !COMPANY_FROM.test(deps.config.from) || deps.config.recipient.toLowerCase() !== DEMO_RECIPIENT) {
    result.failed = 1; result.configurationMissing = true; return result
  }
  const limit = Math.min(3, Math.max(1, Number.isInteger(options.limit) ? options.limit! : 1))
  const acceptance = (value: unknown) => {
    if (!record(value) || value.emailStatus !== 'provider_accepted') { result.failed++; result.storageErrors++; return false }
    if (value.calendarStatus === 'pending') result.calendarQueued++
    else if (value.calendarStatus === 'blocked') result.reviewRequired++
    return true
  }
  for (let index = 0; index < limit; index++) {
    const holder = randomUUID()
    let jobs: unknown
    try { jobs = await deps.command('claim', {holder,limit:1,...(options.id ? {id:options.id} : {})}) }
    catch { result.failed++; result.storageErrors++; break }
    if (!Array.isArray(jobs)) { result.failed++; result.storageErrors++; break }
    if (jobs.length === 0) break
    const job = jobs[0]
    if (!isJob(job)) { result.failed++; result.storageErrors++; break }
    result.claimed++
    const lease = {id:job.id,holder,generation:job.lease_generation}
    const fail = async (outcome: 'retrying'|'failed'|'outcome_unknown', error_code: string) => {
      if (outcome === 'retrying') result.retrying++
      else if (outcome === 'outcome_unknown') result.reviewRequired++
      else result.failed++
      try { await deps.command('email_failed', {...lease,outcome,error_code}) }
      catch { result.storageErrors++; result.failed++ }
    }
    if (!Number.isFinite(Date.parse(job.lease_until)) || Date.parse(job.lease_until) <= deps.now() + REQUEST_TIMEOUT_MS) {
      result.retrying++; continue
    }
    if (job.email_status === 'provider_accepted') {
      // A stored provider acceptance can enqueue Calendar again, never send again.
      if (!job.email_provider_id) { result.failed++; result.storageErrors++; continue }
      try {
        const accepted = await deps.command('email_accepted', {...lease,provider_id:job.email_provider_id})
        acceptance(accepted)
      } catch { result.failed++; result.storageErrors++ }
      continue
    }
    if (job.email_first_attempt_at && (!Number.isFinite(Date.parse(job.email_first_attempt_at)) || deps.now() - Date.parse(job.email_first_attempt_at) >= RETRY_WINDOW_MS)) {
      await fail('outcome_unknown','email_retry_window_expired'); continue
    }
    let payload: DemoEmailPayload
    try { payload = job.email_payload ?? await (deps.createPayload ?? createDemoPdfEmailPayload)(job,deps.config.from,deps.config.recipient) }
    catch { await fail('failed','email_document_invalid'); continue }
    if (!validFrozenDemoPayload(payload)) { await fail('failed','email_payload_conflict'); continue }
    let attempt: unknown
    try { attempt = await deps.command('email_attempt', {...lease,payload}) }
    catch { result.failed++; result.storageErrors++; continue }
    if (record(attempt) && attempt.email_status === 'outcome_unknown') { result.reviewRequired++; continue }
    if (!isJob(attempt) || attempt.id !== job.id || attempt.lease_generation !== job.lease_generation || !validFrozenDemoPayload(attempt.email_payload) || !attempt.email_first_attempt_at ||
        !Number.isFinite(Date.parse(attempt.email_first_attempt_at)) || deps.now()-Date.parse(attempt.email_first_attempt_at) >= RETRY_WINDOW_MS ||
        Date.parse(attempt.lease_until) <= deps.now()+REQUEST_TIMEOUT_MS) {
      await fail('outcome_unknown','email_retry_window_expired'); continue
    }
    // First send and every retry use the database-frozen request, including sender and attachments.
    let response: Response
    try {
      response = await deps.request('https://api.resend.com/emails', {
        method:'POST', headers:{Authorization:`Bearer ${deps.config.apiKey}`,'Content-Type':'application/json','Idempotency-Key':`${deps.idempotencyPrefix ?? 'demo-quote'}:${job.id}`},
        body:JSON.stringify(attempt.email_payload), signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch { await fail('retrying','email_outcome_unknown'); continue }
    const provider = await providerJson(response)
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500 || (response.status === 409 && record(provider) && provider.name === 'concurrent_idempotent_requests')) await fail('retrying','email_transient')
      else if (response.status === 409) await fail('outcome_unknown','email_payload_conflict')
      else await fail('failed', response.status === 401 || response.status === 403 ? 'email_configuration' : 'email_rejected')
      continue
    }
    if (!record(provider) || typeof provider.id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(provider.id)) {
      await fail('retrying','email_outcome_unknown'); continue
    }
    try {
      const accepted = await deps.command('email_accepted', {...lease,provider_id:provider.id})
      if (acceptance(accepted)) result.accepted++
    } catch {
      // The provider may have accepted the message. Preserve the original key/payload for recovery.
      result.failed++; result.storageErrors++
    }
  }
  return result
}
