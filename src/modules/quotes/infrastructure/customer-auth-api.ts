import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { QuoteRequestError, type LiveQuoteRequest, type QuoteRequestOwner } from '../domain/contracts.ts'
import type { CustomerAuthProvider, CustomerQuoteSession, CustomerQuoteState, CustomerQuoteSummary } from '../domain/customer-auth.ts'
import type { QuoteRequestStore } from '../application/requests.ts'
import { quoteRequestTransport } from '../domain/transport.ts'
import { requestId } from '../domain/validation.ts'
const SESSION = 'lk_quote_customer_auth', CHALLENGE = 'lk_quote_customer_challenge', PATH = '/api/quote/requests'
interface Challenge { id: string; proof: string; email: string; expiresAt: number }
export interface CustomerAuthApiDependencies {
 store: QuoteRequestStore; requests: QuoteRequestStore; provider: CustomerAuthProvider
 baseUrl(): string | undefined; legacyUrl(): string | undefined; sessionKey(): string | undefined
 enabled(): boolean; now(): number; guestOwner(req: Request, legacy?: boolean): QuoteRequestOwner | null
}
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'cache-control': 'private, no-store', vary: 'Cookie', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' } }) }
function email(value: unknown) {
 if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw new QuoteRequestError(400, 'Enter a valid email address.')
 return value.trim().toLowerCase()
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export function createCustomerAuthApi(deps: CustomerAuthApiDependencies) {
 const base = (req: Request, legacy = false) => quoteRequestTransport(req, legacy ? deps.legacyUrl() : deps.baseUrl())
 function writable(req: Request, legacy = false) {
  const address = base(req, legacy)
  if (req.headers.get('origin') !== address.origin) throw new QuoteRequestError(403, 'Same-origin request required.')
  if (!deps.enabled()) throw new QuoteRequestError(503, 'Customer quote verification is temporarily paused. Your saved records are retained.')
  return address
 }
 function key() {
  const value = deps.sessionKey()
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) throw new QuoteRequestError(503, 'Customer email verification sessions are not configured.')
  return Buffer.from(value, 'hex')
 }
 function seal(name: string, value: unknown, address: URL) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv)
  cipher.setAAD(Buffer.from(`quote-customer-v1:${name}:${address.origin}`))
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64url')
 }
 function stored<T>(req: Request, name: string, address: URL): T | null {
  const header = req.headers.get('cookie') ?? ''
  if (header.length > 32768) throw new QuoteRequestError(413, 'Private session details are too large.')
  const cookies = header.split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`))
  if (cookies.length > 1) throw new QuoteRequestError(400, 'Ambiguous customer session.')
  if (!cookies.length) return null
  const value = cookies[0].slice(name.length + 1)
  if (!/^[A-Za-z0-9_-]{50,6000}$/.test(value)) throw new QuoteRequestError(401, 'Your customer session expired. Verify your email again.')
  try {
   const bytes = Buffer.from(value, 'base64url'), decipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12))
   decipher.setAAD(Buffer.from(`quote-customer-v1:${name}:${address.origin}`)); decipher.setAuthTag(bytes.subarray(12, 28))
   return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')) as T
  } catch { throw new QuoteRequestError(401, 'Your customer session expired. Verify your email again.') }
 }
 function cookie(res: Response, name: string, value: unknown, address: URL, maxAge: number) {
  res.headers.append('set-cookie', `${name}=${value === null ? '' : seal(name, value, address)}; Path=${PATH}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${address.protocol === 'https:' ? '; Secure' : ''}`)
 }
 async function input(req: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') ?? '')) throw new QuoteRequestError(415, 'JSON required.')
  const reader = req.body?.getReader(); if (!reader) throw new QuoteRequestError(400, 'Verification details required.')
  const chunks: Uint8Array[] = []; let size = 0
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2048) { await reader.cancel(); throw new QuoteRequestError(413, 'Verification details are too large.') }; chunks.push(value) }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value } catch { throw new QuoteRequestError(400, 'Invalid verification details.') }
 }
 const args = (s: CustomerQuoteSession) => ({ companyId: 'lk-group', sessionId: s.sessionId, authUserId: s.userId, email: s.email })
 async function session(req: Request): Promise<CustomerQuoteSession | null> {
  const value = stored<CustomerQuoteSession>(req, SESSION, base(req))
  if (!value) return null
  if (!value.sessionId || !value.userId || !value.accessToken || !value.email || !Number.isFinite(value.expiresAt) || value.expiresAt <= deps.now()) throw new QuoteRequestError(401, 'Your customer session expired. Verify your email to reopen saved quotes.')
  const identity = await deps.provider.identity(value.accessToken)
  if (identity.userId !== value.userId || identity.email !== value.email || identity.authSessionId !== value.authSessionId) throw new QuoteRequestError(401, 'Your customer session changed. Verify your email again.')
  // Every use checks the local session and live request-specific access in the DB.
  await deps.store.command('state', args(value))
  return value
 }
 async function state(s: CustomerQuoteSession | null): Promise<CustomerQuoteState> {
  if (!s) return { customer: null, requests: [], currentRequestId: null }
  const result = await deps.store.command<{ requests: CustomerQuoteSummary[] }>('state', args(s))
  const currentRequestId = result.requests.some(item => item.id === s.currentRequestId) ? s.currentRequestId : null
  return { customer: { email: s.email, expiresAt: new Date(s.expiresAt).toISOString() }, requests: result.requests, currentRequestId }
 }
 const safe = (fn: (req: Request) => Promise<Response>) => async (req: Request) => {
  try { return await fn(req) } catch (error) {
   if (error instanceof QuoteRequestError) return json({ error: error.message, code: ({ 400: 'validation', 401: 'unauthorized', 403: 'forbidden', 404: 'notfound', 409: 'conflict', 413: 'validation', 415: 'validation', 429: 'rate_limit' } as Record<number, string>)[error.status] ?? 'unavailable' }, error.status)
   return json({ error: 'Customer quote verification is temporarily unavailable. Your saved quote remains safe.', code: 'unavailable' }, 503)
  }
 }
 return {
  owner: async (req: Request): Promise<QuoteRequestOwner | null> => {
   const s = await session(req)
   if (!s || !s.currentRequestId) return null
   const owner = await deps.store.command<QuoteRequestOwner>('resolve', { ...args(s), requestId: s.currentRequestId })
   return { ...owner, customer: { ...args(s), requestId: s.currentRequestId } }
  },
  state: safe(async req => json(await state(await session(req)))),
  send: safe(async req => {
   const address = writable(req), values = await input(req), addressEmail = email(values.email)
   const challenge: Challenge = { id: randomUUID(), proof: randomBytes(32).toString('hex'), email: addressEmail, expiresAt: deps.now() + 900000 }
   let owner: QuoteRequestOwner | null = null
   if (values.requestId != null && values.handoff != null) throw new QuoteRequestError(400, 'Choose one saved request recovery method.')
   if (values.requestId != null) {
    requestId(values.requestId)
    if (!Number.isSafeInteger(values.expectedRevision) || Number(values.expectedRevision) < 1) throw new QuoteRequestError(400, 'Reload your saved request before verifying.')
    owner = await thisOwner(req)
    if (!owner) throw new QuoteRequestError(401, 'Open your saved request before linking this email.')
   }
   if (values.handoff != null && (typeof values.handoff !== 'string' || !/^[a-f0-9]{64}$/.test(values.handoff))) throw new QuoteRequestError(400, 'Invalid saved request transfer.')
   await deps.store.command('challenge_create', { companyId: 'lk-group', email: addressEmail, challengeId: challenge.id, proofHash: hash(challenge.proof), ...(owner ? { ownerHash: owner.hash, requestId: values.requestId, expectedRevision: values.expectedRevision } : {}), ...(values.handoff ? { handoffHash: hash(String(values.handoff)) } : {}) })
   await deps.provider.send(addressEmail)
   const res = json({ sent: true, retryAfterSeconds: 60, expiresInSeconds: 900 }); cookie(res, CHALLENGE, challenge, address, 900); return res
  }),
  verify: safe(async req => {
   const address = writable(req), values = await input(req), challenge = stored<Challenge>(req, CHALLENGE, address)
   if (!challenge || challenge.expiresAt <= deps.now()) throw new QuoteRequestError(401, 'Your verification expired. Request a new code.')
   if (typeof values.token !== 'string' || !/^\d{6,8}$/.test(values.token)) throw new QuoteRequestError(400, 'Enter the verification code from your email.')
   const proof = { companyId: 'lk-group', challengeId: challenge.id, proofHash: hash(challenge.proof) }
   const result = await deps.store.command<{ email: string }>('attempt', proof)
   const identity = await deps.provider.verify(result.email, values.token)
   if (identity.email !== result.email) throw new QuoteRequestError(403, 'Email verification could not be confirmed.')
   const s: CustomerQuoteSession = { ...identity, expiresAt: Math.min(identity.expiresAt, deps.now() + 3600000), sessionId: randomUUID(), currentRequestId: null }
   const completed = await deps.store.command<{ currentRequestId: string | null }>('complete', { ...proof, ...args(s), authSessionId: s.authSessionId, expiresAt: new Date(s.expiresAt).toISOString() })
   s.currentRequestId = completed.currentRequestId
   const res = json(await state(s)); cookie(res, SESSION, s, address, Math.max(1, Math.floor((s.expiresAt - deps.now()) / 1000))); cookie(res, CHALLENGE, null, address, 0); return res
  }),
  select: safe(async req => {
   const address = writable(req), values = await input(req), s = await session(req)
   if (!s) throw new QuoteRequestError(401, 'Verify your email to reopen saved quotes.')
   const id = requestId(values.requestId), owner = await deps.store.command<QuoteRequestOwner>('resolve', { ...args(s), requestId: id })
   const request = await deps.requests.command<LiveQuoteRequest>('read', { companyId: 'lk-group', ownerHash: owner.hash, expiresAt: owner.expiresAt, customerAccess: { ...args(s), requestId: id } })
   s.currentRequestId = id
   const res = json({ request }); cookie(res, SESSION, s, address, Math.max(1, Math.floor((s.expiresAt - deps.now()) / 1000))); return res
  }),
  logout: safe(async req => {
   const address = writable(req), values = await input(req)
   if (values.preserveWritingSession !== undefined && typeof values.preserveWritingSession !== 'boolean') throw new QuoteRequestError(400, 'Invalid customer access recovery request.')
   const preserveWritingSession = values.preserveWritingSession === true
   if (preserveWritingSession) {
    // A stale email cookie can hide an unrelated guest quote. Recover that
    // capability without rotating it, only after customer access is invalid.
    let active: CustomerQuoteSession | null = null
    try { active = await session(req) } catch (error) { if (!(error instanceof QuoteRequestError && error.status === 401)) throw error }
    if (active) throw new QuoteRequestError(409, 'Your email access is still active. Use the normal sign-out option.')
   }
   // Expired sessions can always clear their cookies; live local sessions are revoked.
   let s: CustomerQuoteSession | null = null
   try { s = stored<CustomerQuoteSession>(req, SESSION, address) } catch (error) { if (!(error instanceof QuoteRequestError && error.status === 401)) throw error }
   if (s && s.expiresAt > deps.now()) {
    try { await deps.store.command('logout', args(s)) } catch (error) { if (!(error instanceof QuoteRequestError && error.status === 401)) throw error }
   }
   const res = json({ signedOut: true, writingSessionPreserved: preserveWritingSession }); cookie(res, SESSION, null, address, 0); cookie(res, CHALLENGE, null, address, 0)
   if (!preserveWritingSession) res.headers.append('set-cookie', `lk_quote_request=; Path=${PATH}; HttpOnly; SameSite=Lax; Max-Age=0${address.protocol === 'https:' ? '; Secure' : ''}`)
   return res
  }),
  handoff: safe(async req => {
   writable(req, true)
   const values = await input(req), owner = deps.guestOwner(req, true), id = requestId(values.requestId)
   if (!owner || !Number.isSafeInteger(values.expectedRevision) || Number(values.expectedRevision) < 1) throw new QuoteRequestError(401, 'Open your original saved request first.')
   const token = randomBytes(32).toString('hex')
   await deps.store.command('handoff_create', { companyId: 'lk-group', ownerHash: owner.hash, requestId: id, expectedRevision: values.expectedRevision, email: email(values.email), tokenHash: hash(token) })
   const destination = new URL('/quote/start?service=cabinet-painting', deps.baseUrl()); destination.hash = `restore=${token}`
   return json({ url: destination.href, expiresInSeconds: 900 })
  }),
 }
 async function thisOwner(req: Request) {
  const s = await session(req)
  if (s?.currentRequestId) return deps.store.command<QuoteRequestOwner>('resolve', { ...args(s), requestId: s.currentRequestId })
  return deps.guestOwner(req)
 }
}
