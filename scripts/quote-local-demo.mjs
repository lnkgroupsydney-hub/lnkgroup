// Local-only Quote demo: the real Quote, customer, photo, analysis, booking and
// receipt APIs over an in-memory database with every migration applied. Only the
// external ports are local fakes: photo storage, OpenAI, Google Calendar and email.
// Nothing leaves this machine. Run: node --experimental-strip-types scripts/quote-local-demo.mjs
import http from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createQuoteRequestApi } from '../src/modules/quotes/infrastructure/api.ts'
import { createCustomerAuthApi } from '../src/modules/quotes/infrastructure/customer-auth-api.ts'
import { createQuoteMediaApi } from '../src/modules/quotes/infrastructure/media-api.ts'
import { createAnalysisRunner } from '../src/modules/quotes/application/photo-media.ts'
import { scheduleQueuedQuoteAnalysis } from '../src/modules/quotes/application/deferred-analysis.ts'
import { normalizeLivePhoto } from '../src/modules/quotes/infrastructure/photo-objects.ts'
import { analyzeCabinetPhotos, PhotoAnalysisError } from '../src/modules/quotes/infrastructure/openai-photo-analyzer.ts'
import { createLiveBookingApi } from '../src/modules/quotes/infrastructure/booking-flow-api.ts'
import { readLiveBookingAvailability, assertLiveBookingDate, resolveLiveCalendarTarget, livePendingEventId } from '../src/modules/quotes/booking-calendar.ts'
import { processLiveBookingDelivery } from '../src/modules/quotes/booking-delivery.ts'
import { PHOTO_ROLES } from '../src/modules/quotes/domain/analysis.ts'
import { QuoteRequestError } from '../src/modules/quotes/domain/contracts.ts'

const port = Number(process.env.QUOTE_DEMO_PORT ?? 3002)
const upstream = new URL(process.env.QUOTE_DEMO_UPSTREAM ?? 'http://127.0.0.1:3006')
const base = `http://127.0.0.1:${port}`
const VERIFICATION_CODE = '12345678'
const COMPANY_CALENDAR = 'lnkgroupsydney@gmail.com'
if (upstream.hostname !== '127.0.0.1' || Number(upstream.port) === port) throw new Error('Use a distinct loopback upstream for the Next.js app.')
const log = message => process.stdout.write(`[quote-demo] ${message}\n`)

const db = new PGlite()
await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);')
for (const name of readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'))
}
// Booking approval checks the stored company Google connection; seed a local one
// (no tokens) that matches the local calendar port below.
await db.exec("insert into public.lk_google_connection(id,account_sub,email,access_cipher,expires_at,selected_calendar_id) values(1,'local-demo-account','lnkgroupsydney@gmail.com','local-demo-no-token',0,'lnkgroupsydney@gmail.com')")
await db.exec('set role service_role')
const sqlStatus = { LK400: 400, LK401: 401, LK403: 403, LK404: 404, LK409: 409, LK429: 429 }
// Same RPC contracts as the Supabase stores; only booking adds the company scope there too.
function storeFor(fn, scope = {}) {
  return { async command(command, args) {
    try { return (await db.query(`select public.${fn}($1,$2::jsonb) result`, [command, JSON.stringify({ ...scope, ...args })])).rows[0].result }
    catch (error) { const status = sqlStatus[error.code]; throw new QuoteRequestError(status ?? 503, status ? error.message : 'Local demo storage is unavailable.') }
  } }
}
const requestStore = storeFor('lk_quote_requests_command'), customerStore = storeFor('lk_quote_customer_command')
const mediaStore = storeFor('lk_quote_media_command'), bookingStore = storeFor('lk_live_quote_booking_command', { companyId: 'lk-group' })

// Customer email verification: no email is sent; the fixed code is printed below.
const identities = new Map()
const provider = {
  async send(email) { log(`verification code for ${email}: ${VERIFICATION_CODE}`) },
  async verify(email, token) {
    if (token !== VERIFICATION_CODE) throw new QuoteRequestError(401, `Invalid code. The local demo code is ${VERIFICATION_CODE}.`)
    const hex = createHash('sha256').update(`local-demo-customer:${email}`).digest('hex')
    const identity = { userId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`, email, authSessionId: randomUUID(), accessToken: randomUUID(), expiresAt: Date.now() + 3500000 }
    identities.set(identity.accessToken, identity)
    return identity
  },
  async identity(token) {
    const identity = identities.get(token)
    if (!identity || identity.expiresAt <= Date.now()) throw new QuoteRequestError(401, 'Local demo customer access ended.')
    return identity
  },
}
const sessionKey = () => '98'.repeat(32)
const customer = createCustomerAuthApi({ store: customerStore, requests: requestStore, provider, enabled: () => true, baseUrl: () => base, legacyUrl: () => undefined, sessionKey, now: Date.now, guestOwner: (req, legacy) => requests.access.guestOwner(req, legacy) })
const requests = createQuoteRequestApi({ store: requestStore, enabled: () => true, baseUrl: () => base, sessionKey, now: Date.now, customerOwner: customer.owner,
  authorize: async () => { throw new QuoteRequestError(403, 'Staff access is not part of the local customer demo.') } })

// Photo storage: signed uploads come back to this server and stay in memory.
const staging = new Map(), stored = new Map()
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const objects = {
  async signUpload(photo) { return { signedUrl: `${base}/__demo/upload/${encodeURIComponent(photo.stagingPath)}`, token: 'local-demo-upload', path: photo.stagingPath } },
  async normalize(photo) {
    if (photo.state === 'ready' && photo.contentHash) { const bytes = await this.read(photo); return { contentHash: photo.contentHash, width: photo.width, height: photo.height, storedBytes: bytes.length } }
    const bytes = staging.get(photo.stagingPath)
    if (!bytes) throw new QuoteRequestError(409, 'The photo upload was not received. Retry the upload.')
    if (bytes.length !== photo.sizeBytes || sha256(bytes) !== photo.sourceHash) throw new QuoteRequestError(409, 'The uploaded photo did not match the selected file.')
    const result = await normalizeLivePhoto(bytes, photo.mimeType)
    stored.set(photo.objectPath, result.bytes)
    return { contentHash: result.contentHash, width: result.width, height: result.height, storedBytes: result.bytes.length }
  },
  async read(photo) { const bytes = stored.get(photo.objectPath); if (!bytes || sha256(bytes) !== photo.contentHash) throw new QuoteRequestError(409, 'Stored photo integrity check failed.'); return bytes },
  async discardStaging(photo) { staging.delete(photo.stagingPath) },
}

// OpenAI: the real analyzer and validator run against a local response.
const localAnalysisProvider = async (_url, init) => {
  const content = JSON.parse(String(init?.body)).input[0].content
  const metadata = JSON.parse(content.find(item => item.type === 'input_text').text)
  const ids = metadata.photos.map(photo => photo.id), doors = metadata.service.doorCount ?? 12, drawers = metadata.service.drawerCount ?? 4
  const quantity = (customerValue, estimate, label) => ({ observed: estimate, customer: customerValue, needsConfirmation: false, estimated: estimate, basisPhotoIds: ids, confidence: 'medium', note: `Indicative ${label} from the supplied photos.` })
  const analysis = {
    summary: 'Painted cabinet fronts appear in fair condition with light wear around handles.', outcome: 'analysis_ready',
    photoQuality: ids.map(photoId => ({ photoId, usable: true, issues: [], retakeInstruction: null })),
    coverage: PHOTO_ROLES.map(role => ({ role, covered: true, photoIds: ids, note: 'Covered by the supplied photos.' })),
    observedDamage: [],
    quantities: { doors: quantity(metadata.service.doorCount, doors, 'cabinet doors'), drawers: quantity(metadata.service.drawerCount, drawers, 'drawer fronts') },
    proposedWork: [{ id: 'work-preparation', title: 'Surface preparation', description: 'Clean, sand and prime the existing finish before painting.', photoIds: ids, repairIds: [] }],
    unknowns: ['Hidden edges and the back of each door need confirmation.'], siteChecks: ['Check coating adhesion on site.'],
    estimateScope: { status: 'estimable', extent: 'whole_project', anchorPhotoId: ids[0], scopePhotoIds: ids, contextPhotoIds: [], conflictingPhotoIds: [], description: 'Matching cabinet fronts in the supplied photos.', assumptions: ['Exact quantities are confirmed on site.'] },
  }
  return Response.json({ id: `resp_local_demo_${randomUUID()}`, status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(analysis) }] }], usage: { input_tokens: 1200, output_tokens: 300, total_tokens: 1500, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 100 } } })
}
const runAnalysis = createAnalysisRunner({ store: mediaStore, objects, analyze: input => analyzeCabinetPhotos(input, { apiKey: 'local-demo-only', request: localAnalysisProvider }),
  classify: error => error instanceof PhotoAnalysisError ? { status: error.status, message: error.message, providerResponseId: error.providerResponseId ?? undefined, usage: error.usage ?? undefined } : null })
const media = createQuoteMediaApi({ access: requests.access, store: mediaStore, objects, run: runAnalysis, aiReady: () => true })

// Google Calendar: the real availability rules run against a local company calendar
// with one booked day three weeks from now.
const busy = new Date(Date.now() + 21 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
const busyEnd = new Date(Date.parse(`${busy}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
const calendarPorts = {
  connection: async () => ({ account_sub: 'local-demo-account', email: COMPANY_CALENDAR }),
  target: () => COMPANY_CALENDAR,
  now: () => new Date(),
  confirmed: target => bookingStore.command('occupancy', { ...target }),
  request: async url => url.includes('/calendarList/') ? Response.json({ id: COMPANY_CALENDAR, accessRole: 'owner', primary: true })
    : Response.json({ accessRole: 'owner', items: [{ status: 'confirmed', start: { date: busy }, end: { date: busyEnd } }] }),
}
// Email delivery: the real receipt PDF is frozen; the provider call stays local.
const delivery = { command: bookingStore.command, now: Date.now, calendar: async input => ({ eventId: livePendingEventId(input.id), etag: 'local-demo', eventUrl: null }),
  config: { enabled: true, apiKey: 'local-demo-only', sender: { from: 'L&K Group <quotes@lnkgroupsydney.com.au>', replyTo: 'lnkgroupsydney@gmail.com' } },
  request: async (_url, init) => { log(`receipt email kept local (not sent): ${JSON.parse(String(init?.body)).subject}`); return Response.json({ id: `local-demo-${randomUUID()}` }) } }
const booking = createLiveBookingApi({ access: requests.access, store: bookingStore, now: Date.now, reviewKey: () => '9a'.repeat(32),
  calendarTarget: () => resolveLiveCalendarTarget(calendarPorts), availability: month => readLiveBookingAvailability(month, calendarPorts),
  dateCheck: (date, revision) => assertLiveBookingDate(date, revision, calendarPorts),
  enqueue: id => setTimeout(() => { processLiveBookingDelivery(id, delivery).then(result => log(`booking receipt delivery: ${JSON.stringify(result)}`)).catch(error => log(`booking delivery failed: ${error.message}`)) }, 300) })

const json = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'private, no-store' } })
async function body(req, max) {
  const chunks = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > max) throw new QuoteRequestError(413, 'The request is too large.'); chunks.push(chunk) }
  return Buffer.concat(chunks)
}
async function send(res, response) {
  const headers = Object.fromEntries(response.headers), cookies = response.headers.getSetCookie()
  if (cookies.length) headers['set-cookie'] = cookies
  res.writeHead(response.status, headers); res.end(Buffer.from(await response.arrayBuffer()))
}
const id = (path, pattern) => pattern.exec(path)?.[1]
function route(method, path, req) {
  const r = '/api/quote/requests'
  if (path === `${r}/session` && method === 'POST') return requests.session(req)
  if (path === r && method === 'GET') return requests.read(req)
  if (path === r && method === 'PUT') return requests.save(req)
  if (path === `${r}/review` && method === 'POST') return requests.review(req)
  if (path === `${r}/customer` && method === 'GET') return customer.state(req)
  if (/^\/api\/quote\/requests\/customer\/(send|verify|select|logout)$/.test(path) && method === 'POST') return customer[path.split('/').at(-1)](req)
  if (path === `${r}/photos` && method === 'GET') return media.workspace(req)
  if (path === `${r}/photos` && method === 'POST') return media.begin(req)
  let photo = id(path, /^\/api\/quote\/requests\/photos\/([^/]+)\/finalize$/); if (photo && method === 'POST') return media.finalize(req, photo)
  photo = id(path, /^\/api\/quote\/requests\/photos\/([^/]+)\/content$/); if (photo && method === 'GET') return media.content(req, photo)
  photo = id(path, /^\/api\/quote\/requests\/photos\/([^/]+)$/); if (photo && method === 'DELETE') return media.remove(req, photo)
  if (path === `${r}/analysis` && method === 'GET') return media.workspace(req)
  if (path === `${r}/analysis` && method === 'POST') return media.start(req).then(async response => {
    await scheduleQueuedQuoteAnalysis(response, { schedule: callback => setTimeout(callback, 2500), run: runAnalysis, warn: log })
    return response
  })
  const job = id(path, /^\/api\/quote\/requests\/analysis\/([^/]+)\/process$/); if (job && method === 'POST') return media.process(req, job)
  if (path === `${r}/reopen` && method === 'POST') return media.reopen(req)
  if (path === `${r}/booking` && method === 'GET') return booking.state(req)
  if (path === `${r}/booking/availability` && method === 'GET') return booking.availability(req)
  if (path === `${r}/booking/approve` && method === 'POST') return booking.approve(req)
  if (path === `${r}/booking/date` && method === 'PUT') return booking.date(req)
  if (path === `${r}/booking/review` && method === 'POST') return booking.review(req)
  if (path === `${r}/booking/submit` && method === 'POST') return booking.submit(req)
  if (path === `${r}/booking/retry` && method === 'POST') return booking.retry(req)
  if (path === `${r}/booking/documents/receipt` && method === 'GET') return booking.receipt(req)
  // The company has not confirmed a schedule in the local demo yet.
  if (path === `${r}/company-booking` && method === 'GET') return json({ state: null })
  if (path === '/api/address/config' && method === 'GET') return json({ configured: false, enabled: false })
  return json({ error: 'This API is not part of the local Quote demo.' }, 404)
}
const proxyHeaders = ['accept', 'accept-language', 'rsc', 'next-router-state-tree', 'next-router-prefetch', 'next-router-segment-prefetch', 'next-url', 'purpose', 'range', 'if-none-match']
const server = http.createServer(async (req, res) => {
  try {
    if (req.headers.host !== `127.0.0.1:${port}`) return await send(res, json({ error: `Open ${base} (the local demo checks the exact address).` }, 403))
    const url = new URL(req.url ?? '/', base)
    const upload = id(url.pathname, /^\/__demo\/upload\/(.+)$/)
    if (upload && req.method === 'PUT') { staging.set(decodeURIComponent(upload), new Uint8Array(await body(req, 10 * 1024 * 1024))); return await send(res, json({ Key: decodeURIComponent(upload) })) }
    if (url.pathname.startsWith('/api/')) {
      const bytes = ['GET', 'HEAD'].includes(req.method) ? undefined : await body(req, 200000)
      return await send(res, await route(req.method, url.pathname, new Request(url, { method: req.method, headers: req.headers, ...(bytes ? { body: bytes } : {}) })))
    }
    if (!['GET', 'HEAD'].includes(req.method)) return await send(res, json({ error: 'Only page reads are forwarded to the app.' }, 405))
    const headers = {}
    for (const name of proxyHeaders) if (typeof req.headers[name] === 'string') headers[name] = req.headers[name]
    const response = await fetch(`${upstream.origin}${url.pathname}${url.search}`, { method: req.method, redirect: 'manual', headers, signal: AbortSignal.timeout(30000) })
    const safe = Object.fromEntries(response.headers)
    for (const name of ['set-cookie', 'content-encoding', 'content-length', 'transfer-encoding', 'connection']) delete safe[name]
    if (safe.location) safe.location = safe.location.replace(upstream.origin, base)
    res.writeHead(response.status, safe); res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    const status = error instanceof QuoteRequestError ? error.status : 500
    if (status === 500) log(`unexpected error: ${error?.stack ?? error}`)
    if (!res.headersSent) await send(res, json({ error: status === 500 ? 'The local demo server failed.' : error.message }, status)); else res.end()
  }
})
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
log(`Quote demo ready: ${base}/quote/start?service=cabinet-painting&mode=live`)
log(`App upstream ${upstream.origin}. Email verification code: ${VERIFICATION_CODE}. Booked demo day: ${busy}.`)
const stop = async () => { await new Promise(resolve => server.close(resolve)); await db.close(); process.exit(0) }
process.once('SIGINT', stop); process.once('SIGTERM', stop)
