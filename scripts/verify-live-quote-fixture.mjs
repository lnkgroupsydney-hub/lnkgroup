// Local-only integration fixture: real Quote API + migrations + in-memory SQL.
// Only allowlisted pages/assets may reach the loopback UI upstream. All API,
// customer cookies, staff cookies, Authorization and control data stay here.
import http from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { createQuoteRequestApi } from '../src/modules/quotes/infrastructure/api.ts'
import { createCustomerAuthApi } from '../src/modules/quotes/infrastructure/customer-auth-api.ts'
import { QuoteRequestError } from '../src/modules/quotes/domain/contracts.ts'

const pages = new Set(['/quote/start', '/admin', '/admin/quotes'])
const assets = new Set(['/favicon.ico', '/images/lk-group-logo-circle-transparent.png'])
const navigationHeaders = ['accept', 'rsc', 'next-router-state-tree', 'next-router-prefetch', 'next-router-segment-prefetch', 'next-url', 'purpose']
function logo(url) {
  const image = url.searchParams.get('url')
  const widths = image === '/images/lk-group-logo-circle-transparent.png' ? ['48', '64', '96', '128', '256']
    : image === '/images/home/cabinet-painting.webp' ? ['640', '750', '828', '1080', '1200', '1920', '2048', '3840'] : []
  return url.pathname === '/_next/image' && url.searchParams.size === 3
    && url.searchParams.getAll('url').length === 1 && widths.length > 0
    && url.searchParams.getAll('w').length === 1 && widths.includes(url.searchParams.get('w'))
    && url.searchParams.getAll('q').length === 1 && url.searchParams.get('q') === '75'
}
function json(value, status = 200) { return Response.json(value, { status, headers: { 'cache-control': 'private, no-store', vary: 'Cookie', 'x-live-quote-fixture': 'synthetic' } }) }
async function input(req) {
  const chunks = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > 16384) throw new QuoteRequestError(413, 'Synthetic fixture input too large.'); chunks.push(chunk) }
  return Buffer.concat(chunks)
}
async function send(res, response, delay = 0) {
  const bytes = Buffer.from(await response.arrayBuffer()), headers = Object.fromEntries(response.headers)
  const cookies = response.headers.getSetCookie(); if (cookies.length) headers['set-cookie'] = cookies
  headers['x-live-quote-fixture'] = 'synthetic'
  const write = () => { if (!res.destroyed) { res.writeHead(response.status, headers); res.end(bytes) } }
  if (delay) setTimeout(write, delay); else write()
}
export async function createLiveQuoteFixture({ port = 3014, hostname = '127.0.0.1', upstream = 'http://127.0.0.1:3002', customerAuth = false } = {}) {
  const upstreamUrl = new URL(upstream)
  if (!['localhost', '127.0.0.1'].includes(hostname)
    || !Number.isInteger(port) || (port !== 0 && (port < 1024 || port > 65535))
    || upstreamUrl.protocol !== 'http:' || upstreamUrl.hostname !== '127.0.0.1'
    || upstreamUrl.username || upstreamUrl.password || upstreamUrl.pathname !== '/'
    || upstreamUrl.search || upstreamUrl.hash || Number(upstreamUrl.port || 80) === port) throw new Error('Distinct loopback HTTP ports are required.')
  const db = new PGlite()
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  for (const name of readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'))
  }
  await db.exec('set role service_role')
  // Reset only this private in-memory fixture. Include authentication, media,
  // booking and receipt tables so one scenario cannot inherit another's access.
  const tables = (await db.query("select tablename from pg_tables where schemaname='public' and tablename like 'lk_%'")).rows.map(row => row.tablename)
  const actor = { userId: randomUUID(), sessionId: randomUUID(), companyId: 'lk-group' }
  let flags = {}, calls = []
  const resetFlags = () => { flags = { loseNextSaveResponse: false, conflictNextSave: false, customerAccessStatus: 0, staffAccessStatus: 0, responseDelayMs: 0 } }
  resetFlags()
  const store = { async command(command, args) {
    calls.push({ command, idempotencyKey: args.idempotencyKey, expectedRevision: args.expectedRevision })
    try { return (await db.query('select public.lk_quote_requests_command($1,$2::jsonb) result', [command, JSON.stringify(args)])).rows[0].result }
    catch (error) { const status = ({ LK400: 400, LK401: 401, LK403: 403, LK404: 404, LK409: 409, LK429: 429 })[error.code]; throw new QuoteRequestError(status ?? 503, status ? error.message : 'Synthetic SQL unavailable.') }
  } }
  let base
  const identities = new Map(), providerCalls = { send: 0, verify: 0, identity: 0 }, customerCommands = {}
  const customerStore = { async command(command, args) {
    customerCommands[command] = (customerCommands[command] ?? 0) + 1
    try { return (await db.query('select public.lk_quote_customer_command($1,$2::jsonb) result', [command, JSON.stringify(args)])).rows[0].result }
    catch (error) { const status = ({ LK400: 400, LK401: 401, LK403: 403, LK404: 404, LK409: 409, LK429: 429 })[error.code]; throw new QuoteRequestError(status ?? 503, status ? error.message : 'Synthetic customer SQL unavailable.') }
  } }
  const provider = {
    async send() { providerCalls.send++ },
    async verify(email, token) {
      providerCalls.verify++
      if (token !== '12345678') throw new QuoteRequestError(401, 'Invalid synthetic verification code.')
      const hex = createHash('sha256').update(`synthetic-customer:${email}`).digest('hex')
      const userId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
      const identity = { userId, email, authSessionId: randomUUID(), accessToken: randomUUID(), expiresAt: Date.now() + 3500000 }
      identities.set(identity.accessToken, identity)
      return identity
    },
    async identity(token) {
      providerCalls.identity++
      const identity = identities.get(token)
      if (!identity || identity.expiresAt <= Date.now()) throw new QuoteRequestError(401, 'Synthetic customer access ended.')
      return identity
    },
  }
  // Circular references are evaluated on requests, after both APIs exist.
  const customer = customerAuth ? createCustomerAuthApi({ store: customerStore, requests: store, provider,
    enabled: () => true, baseUrl: () => base, legacyUrl: () => undefined,
    sessionKey: () => '98'.repeat(32), now: Date.now, guestOwner: (req, legacy) => api.access.guestOwner(req, legacy) }) : null
  const api = createQuoteRequestApi({ store, enabled: () => true, baseUrl: () => base,
    sessionKey: () => '98'.repeat(32), now: Date.now,
    ...(customer ? { customerOwner: customer.owner } : {}),
    authorize: async () => { if (flags.staffAccessStatus) throw new QuoteRequestError(flags.staffAccessStatus, 'Synthetic staff access ended.'); return actor } })
  async function control(value) {
    if (value.reset) {
      // New media/booking tables also reference requests. This database exists
      // only in this local synthetic fixture; reset its complete FK graph.
      await db.exec(`reset role; truncate ${tables.map(name => `public."${name.replaceAll('"', '""')}"`).join(',')} cascade; set role service_role;`)
      calls = []; resetFlags()
      identities.clear()
      for (const key of Object.keys(providerCalls)) providerCalls[key] = 0
      for (const key of Object.keys(customerCommands)) delete customerCommands[key]
    }
    // Move only the synthetic one-minute send cooldown into the past. Keep the
    // real rate-limit function and global/hourly buckets active during recovery.
    if (customerAuth && value.expireCustomerSendCooldown === true) await db.exec("update public.lk_rate_buckets set reset_at=reset_at-61000 where bucket like 'quote-customer-send:%' and bucket <> 'quote-customer-send:global'")
    for (const key of ['loseNextSaveResponse', 'conflictNextSave']) if (key in value) flags[key] = value[key] === true
    for (const key of ['customerAccessStatus', 'staffAccessStatus']) if (key in value) flags[key] = [401, 403].includes(value[key]) ? value[key] : 0
    if ('responseDelayMs' in value) flags.responseDelayMs = Math.min(5000, Math.max(0, Number(value.responseDelayMs) || 0))
    return json({ synthetic: true, flags })
  }
  async function state() {
    const rows = (await db.query('select public.lk_quote_request_json(r) request from public.lk_quote_requests r order by saved_at,id')).rows
    const auditCount = (await db.query('select count(*)::integer n from public.lk_quote_request_audit')).rows[0].n
    return json({ synthetic: true, flags, requests: rows.map(row => row.request), auditCount, calls,
      customerAuth: { enabled: customerAuth, providerCalls, commands: customerCommands } })
  }
  const server = http.createServer(async (req, res) => {
    try {
      const actualPort = server.address().port
      if (req.headers.host !== `${hostname}:${actualPort}` || !req.url?.startsWith('/') || req.url.startsWith('//')) return await send(res, json({ error: 'Loopback fixture only.' }, 403))
      const url = new URL(req.url, base)
      if (url.pathname === '/__fixture/control' && req.method === 'POST') {
        if (req.headers.origin && req.headers.origin !== base) return await send(res, json({ error: 'Same-origin control required.' }, 403))
        return await send(res, await control(JSON.parse((await input(req)).toString('utf8') || '{}')))
      }
      if (url.pathname === '/__fixture/state' && req.method === 'GET') return await send(res, await state())
      if (url.pathname.startsWith('/api/')) {
        const bytes = ['GET', 'HEAD'].includes(req.method) ? undefined : await input(req)
        const request = new Request(url, { method: req.method, headers: req.headers, ...(bytes ? { body: bytes } : {}) })
        let response
        if (url.pathname.startsWith('/api/quote/requests') && flags.customerAccessStatus) response = json({ error: 'Synthetic private writing access ended.' }, flags.customerAccessStatus)
        else if (customer && url.pathname === '/api/quote/requests/customer' && req.method === 'GET') response = await customer.state(request)
        else if (customer && /^\/api\/quote\/requests\/customer\/(send|verify|select|logout)$/.test(url.pathname) && req.method === 'POST') response = await customer[url.pathname.split('/').at(-1)](request)
        else if (url.pathname === '/api/quote/requests/session' && req.method === 'POST') response = await api.session(request)
        else if (url.pathname === '/api/quote/requests' && req.method === 'GET') response = await api.read(request)
        else if (url.pathname === '/api/quote/requests' && req.method === 'PUT') {
          if (flags.conflictNextSave) { flags.conflictNextSave = false; response = json({ error: 'Synthetic other-tab conflict. Load latest saved details.' }, 409) }
          else {
            response = await api.save(request)
            if (response.ok && flags.loseNextSaveResponse) { flags.loseNextSaveResponse = false; response = json({ error: 'Synthetic saved response was lost. Retry the same save.' }, 503) }
          }
        } else if (url.pathname === '/api/quote/requests/review' && req.method === 'POST') response = await api.review(request)
        else if (url.pathname === '/api/admin/quote-requests' && req.method === 'GET') response = await api.list(request)
        else if (/^\/api\/admin\/quote-requests\/[^/]+$/.test(url.pathname) && req.method === 'GET') response = await api.detail(request, url.pathname.split('/').at(-1))
        else if (url.pathname === '/api/admin-auth/session' && req.method === 'GET') response = json(flags.staffAccessStatus ? { authenticated: false, stage: 'signed_out' } : { authenticated: true, stage: 'ready', email: 'synthetic-admin@example.invalid' })
        else if (url.pathname === '/api/operations/session' && req.method === 'GET') response = json(flags.staffAccessStatus ? { authenticated: false, mode: null, localLoginAvailable: false, googleConfigured: false } : { authenticated: true, mode: 'staff', ownerEmail: 'synthetic-admin@example.invalid', staffRole: 'admin', storage: 'supabase', localLoginAvailable: false, googleConfigured: false, missingConfiguration: [] })
        else if (url.pathname === '/api/operations' && req.method === 'GET') response = json(flags.staffAccessStatus ? { error: 'Synthetic staff access ended.' } : { enquiries: [], changes: [], gmail: { configured: false, connected: false }, calendar: { configured: false, connected: false } }, flags.staffAccessStatus || 200)
        else if (url.pathname === '/api/operations/bookings' && req.method === 'GET') response = json({ bookings: [] }, flags.staffAccessStatus || 200)
        else if (url.pathname === '/api/address/config' && req.method === 'GET') response = json({ configured: false, enabled: false })
        else response = json({ error: 'Synthetic API is unavailable. Nothing was forwarded.' }, 404)
        return await send(res, response, flags.responseDelayMs)
      }
      if (!['GET', 'HEAD'].includes(req.method) || !(pages.has(url.pathname) || url.pathname.startsWith('/_next/static/') || assets.has(url.pathname) || logo(url))) return await send(res, json({ error: 'Page or asset not allowlisted.' }, 404))
      if (url.pathname === '/quote/start') {
        const scenario = url.searchParams.get('scenario')
        if (scenario === 'lost-response') flags.loseNextSaveResponse = true
        if (scenario === 'stale') flags.conflictNextSave = true
        if (scenario === 'auth-lost') flags.customerAccessStatus = 401
      }
      const headers = {}
      for (const name of navigationHeaders) if (typeof req.headers[name] === 'string') headers[name] = req.headers[name]
      if (headers['next-url']) {
        const next = new URL(headers['next-url'], base)
        if (next.origin !== base || !pages.has(next.pathname)) return await send(res, json({ error: 'Navigation target not allowlisted.' }, 400))
        headers['next-url'] = next.pathname + next.search
      }
      const response = await fetch(`${upstreamUrl.origin}${url.pathname}${url.search}`, { method: req.method, redirect: 'manual', headers, signal: AbortSignal.timeout(15000) })
      const safeHeaders = Object.fromEntries(response.headers)
      for (const name of ['set-cookie', 'content-encoding', 'content-length', 'transfer-encoding', 'connection', 'location', 'x-nextjs-redirect']) delete safeHeaders[name]
      safeHeaders['cache-control'] = 'private, no-store'; safeHeaders['x-live-quote-fixture'] = 'synthetic'
      res.writeHead(response.status, safeHeaders); res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()))
    } catch (error) { if (!res.headersSent) await send(res, json({ error: error instanceof QuoteRequestError ? error.message : 'Synthetic fixture failed.' }, error instanceof QuoteRequestError ? error.status : 500)); else res.end() }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  base = `http://${hostname}:${server.address().port}`
  return { base, server, close: async () => { await new Promise(resolve => server.close(resolve)); await db.close() } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await createLiveQuoteFixture({ port: Number(process.env.LIVE_QUOTE_FIXTURE_PORT ?? 3014), hostname: process.env.LIVE_QUOTE_FIXTURE_HOST ?? '127.0.0.1', upstream: process.env.LIVE_QUOTE_FIXTURE_UPSTREAM ?? 'http://127.0.0.1:3002', customerAuth: process.env.LIVE_QUOTE_FIXTURE_CUSTOMER_AUTH === 'true' })
  process.stdout.write(`Synthetic live Quote fixture: ${fixture.base}/quote/start?service=cabinet-painting&mode=live\nEMS: ${fixture.base}/admin/quotes\nControls: POST /__fixture/control; GET /__fixture/state\nScenarios: add &scenario=lost-response, stale, or auth-lost; reset flags with control.\n`)
  const stop = async () => { await fixture.close(); process.exit(0) }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
}
