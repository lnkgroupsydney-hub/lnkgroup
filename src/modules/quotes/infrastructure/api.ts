import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { requireStaffAdmin } from '../../admin-access/server.ts'
import { AdminAccessError } from '../../admin-access/index.ts'
import { quoteRequests, type QuoteRequestStore } from '../application/requests.ts'
import { QuoteRequestError, type LiveQuoteRequestDetail, type LiveQuoteRequestPage, type QuoteRequestActor, type QuoteRequestOwner } from '../domain/contracts.ts'
import { requestId, requestSearch, validateReviewRequest, validateSaveRequest } from '../domain/validation.ts'
import { quoteRequestStore } from './store.ts'
import { quoteRequestTransport } from '../domain/transport.ts'
import { customerRequestOwner } from './customer-auth-runtime.ts'
const COOKIE = 'lk_quote_request', TTL = 86400
export interface QuoteRequestApiDependencies {
  store: QuoteRequestStore
  authorize(req: Request, permission: 'operations.read'): Promise<QuoteRequestActor>
  baseUrl(): string | undefined
  enabled(): boolean
  sessionKey(): string | undefined
  now(): number
  customerOwner?(req: Request): Promise<QuoteRequestOwner | null>
  legacyUrl?(): string | undefined
}
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'cache-control': 'private, no-store', vary: 'Cookie', 'x-content-type-options': 'nosniff' } }) }
export function createQuoteRequestApi(deps: QuoteRequestApiDependencies) {
  const requests = quoteRequests(deps.store)
  function base(req: Request) {
    return quoteRequestTransport(req, deps.baseUrl())
  }
  function writable() {
    if (!deps.enabled()) throw new QuoteRequestError(503, 'New live quote changes are paused. Saved company records are retained.')
  }
  function origin(req: Request) {
    const url = base(req)
    if (req.headers.get('origin') !== url.origin) throw new QuoteRequestError(403, 'Same-origin request required.')
    return url
  }
  function mac(value: string, address: URL) {
    const key = deps.sessionKey()
    if (!key || !/^[a-f0-9]{64}$/i.test(key)) throw new QuoteRequestError(503, 'Private request sessions are not configured.')
    return createHmac('sha256', Buffer.from(key, 'hex')).update(`live-quote-request-session-v1:${address.origin}:${value}`).digest('hex')
  }
  function owner(req: Request, address: URL): QuoteRequestOwner | null {
    const header = req.headers.get('cookie') ?? ''
    if (header.length > 32768) throw new QuoteRequestError(413, 'Private session details are too large.')
    const cookies = header.split(';').map(item => item.trim()).filter(item => item.startsWith(`${COOKIE}=`))
    if (cookies.length > 1) throw new QuoteRequestError(400, 'Ambiguous private request session.')
    if (!cookies.length) return null
    const value = cookies[0].slice(COOKIE.length + 1)
    if (!/^\d{10}\.[a-f0-9]{64}\.[a-f0-9]{64}$/.test(value)) throw new QuoteRequestError(401, 'Your private request session is invalid. Reopen your original request page.')
    const [expiry, nonce, signature] = value.split('.')
    const now = deps.now() / 1000
    if (Number(expiry) <= now || Number(expiry) > now + TTL + 60 || !timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(mac(`${expiry}.${nonce}`, address), 'hex'))) throw new QuoteRequestError(401, 'Your private request session expired. Saved company records are retained.')
    return { hash: createHash('sha256').update(value).digest('hex'), expiresAt: new Date(Number(expiry) * 1000).toISOString() }
  }
  async function currentOwner(req: Request, address: URL) {
    return await deps.customerOwner?.(req) ?? owner(req, address)
  }
  async function expectedRequest(req: Request, current: QuoteRequestOwner, write: boolean) {
    const id = req.headers.get('x-lk-quote-request-id')
    if (write && current.customer && !id) throw new QuoteRequestError(409, 'The selected quote changed. Reload before saving.')
    if (id) {
      requestId(id)
      const selectedId = current.customer?.requestId ?? (await requests.read(current))?.id
      if (selectedId !== id) throw new QuoteRequestError(409, 'The selected quote changed. Reload before saving.')
    }
    return id ? { ...current, expectedRequestId: id } : current
  }
  function legacyAddress(req: Request) {
    const legacy = deps.legacyUrl?.()
    if (legacy && new URL(req.url).origin === new URL(legacy).origin) return quoteRequestTransport(req, legacy)
    return base(req)
  }
  async function input(req: Request) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') ?? '')) throw new QuoteRequestError(415, 'JSON required.')
    const length = req.headers.get('content-length'), max = 16000
    if (length && (!/^\d+$/.test(length) || Number(length) > max)) throw new QuoteRequestError(413, 'Request details are too large.')
    const reader = req.body?.getReader()
    if (!reader) throw new QuoteRequestError(400, 'Request details required.')
    let size = 0
    const chunks: Uint8Array[] = []
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > max) { await reader.cancel(); throw new QuoteRequestError(413, 'Request details are too large.') }; chunks.push(value) }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as unknown } catch { throw new QuoteRequestError(400, 'Invalid request details.') }
  }
  const baseOrigin = () => deps.baseUrl() ? new URL(deps.baseUrl()!).origin : ''
  const safe = (handler: (req: Request, id?: string) => Promise<Response>) => async (req: Request, id?: string) => {
    try { return await handler(req, id) } catch (error) {
      if (error instanceof QuoteRequestError || error instanceof AdminAccessError) return json({ error: error.message, code: ({ 400: 'validation', 401: 'unauthorized', 403: 'forbidden', 404: 'notfound', 409: 'conflict', 413: 'validation', 415: 'validation', 429: 'rate_limit' } as Record<number, string>)[error.status] ?? 'unavailable' }, error.status)
      return json({ error: 'Private quote requests are temporarily unavailable. Keep your entries and retry.', code: 'unavailable' }, 503)
    }
  }
  return {
    access: {
      readOwner: async (req: Request) => { const address = base(req); const value = await currentOwner(req, address); if (!value) throw new QuoteRequestError(401, 'Open your saved request or verify your email.'); return expectedRequest(req, value, false) },
      writeOwner: async (req: Request) => { writable(); const address = origin(req); const value = await currentOwner(req, address); if (!value) throw new QuoteRequestError(401, 'Open your saved request or verify your email.'); return expectedRequest(req, value, true) },
      guestOwner: (req: Request, legacy = false) => owner(req, legacy ? legacyAddress(req) : base(req)),
      staff: async (req: Request) => { base(req); return deps.authorize(req, 'operations.read') },
      input,
    },
    session: safe(async req => {
      const address = origin(req)
      if (await currentOwner(req, address)) return json({ ready: true })
      writable()
      const value = `${Math.floor(deps.now() / 1000) + TTL}.${randomBytes(32).toString('hex')}`
      const response = json({ ready: true })
      response.headers.set('set-cookie', `${COOKIE}=${value}.${mac(value, address)}; Path=/api/quote/requests; HttpOnly; SameSite=Lax; Max-Age=${TTL}${address.protocol === 'https:' ? '; Secure' : ''}`)
      return response
    }),
    read: safe(async req => { const address = legacyAddress(req), current = address.origin === baseOrigin() ? await currentOwner(req, address) : owner(req, address); return json({ request: current ? await requests.read(current) : null }) }),
    save: safe(async req => { writable(); const address = origin(req), current = await currentOwner(req, address); if (!current) throw new QuoteRequestError(401, 'Start a private request session before saving.'); return json({ request: await requests.save(await expectedRequest(req, current, true), validateSaveRequest(await input(req))) }) }),
    review: safe(async req => { writable(); const address = origin(req), current = await currentOwner(req, address); if (!current) throw new QuoteRequestError(401, 'Start a private request session before saving.'); return json({ request: await requests.review(await expectedRequest(req, current, true), validateReviewRequest(await input(req))) }) }),
    list: safe(async req => { base(req); const actor = await deps.authorize(req, 'operations.read'); return json(await requests.staff<LiveQuoteRequestPage>(actor, 'list', requestSearch(new URL(req.url).searchParams))) }),
    detail: safe(async (req, id) => { base(req); const actor = await deps.authorize(req, 'operations.read'); return json(await requests.staff<LiveQuoteRequestDetail>(actor, 'detail', { id: requestId(id) })) }),
  }
}
const api = createQuoteRequestApi({ store: quoteRequestStore, authorize: requireStaffAdmin, baseUrl: () => process.env.APP_BASE_URL, enabled: () => process.env.QUOTE_LIVE_ENABLED === 'true', sessionKey: () => process.env.GOOGLE_TOKEN_ENCRYPTION_KEY, now: Date.now, customerOwner: customerRequestOwner, legacyUrl: () => process.env.QUOTE_LEGACY_BASE_URL })
export const quoteRequestAccess = api.access
export const liveQuoteSessionPost = api.session, liveQuoteGet = api.read, liveQuotePut = api.save, liveQuoteReviewPost = api.review, adminQuoteRequestsGet = api.list, adminQuoteRequestGet = api.detail
