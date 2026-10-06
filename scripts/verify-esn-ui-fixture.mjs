// Local synthetic API fixture. Only /admin and Next assets are proxied to the
// local production app. Cookies/Auth headers and ALL /api calls never forward.
import http from 'node:http'
import { randomUUID } from 'node:crypto'

const port = 3013, upstream = 'http://127.0.0.1:3002'
let customers, records, links, audits, attempts, flags, signedOut, otherSessionCount
const actor = '00000000-0000-4000-8000-000000000001'
function customer(name, index = 0) {
  const now = new Date().toISOString()
  return { id: randomUUID(), companyId: 'lk-group', name, email: index === 0 ? `${'longsyntheticcontact'.repeat(5)}@example.invalid` : `synthetic${index}@example.invalid`, phone: 'Synthetic phone — not callable', address: 'Synthetic Sydney address — not a real property', revision: 1, createdAt: now, updatedAt: now }
}
function reset() {
  customers = Array.from({ length: 13 }, (_, index) => customer(index === 0 ? `Synthetic ${'VeryLongCustomerName'.repeat(5)}` : `Synthetic Customer ${index + 1}`, index))
  records = Array.from({ length: 4 }, (_, index) => {
    const id = randomUUID(), photo = randomUUID()
    return { sourceType: index === 0 ? 'submission' : 'enquiry', sourceId: id, reference: index === 0 ? 'SYNTHETIC-DEMO-001' : `SYNTHETIC-ENQ-${index}`, name: `Synthetic Source Contact ${index + 1}`, email: `source${index}@example.invalid`, phone: 'Synthetic source phone', address: 'Synthetic source address', createdAt: new Date().toISOString(), status: 'synthetic_demo', relatedEnquiryIds: [], booking: index === 0 ? { status: 'requested', revision: 1, syncStatus: 'pending', confirmedAt: null } : null, photos: index === 0 ? [{ id: photo, url: `/api/operations/bookings/${id}/photos/${photo}` }] : [], links: index === 0 ? { detail: `/api/operations/bookings/${id}`, quotePdf: `/api/operations/bookings/${id}/documents/quote`, agreementPdf: `/api/operations/bookings/${id}/documents/agreement`, photos: null } : { detail: null, quotePdf: null, agreementPdf: null, photos: null } }
  })
  links = new Map(); audits = new Map(); attempts = new Map(); signedOut = false; otherSessionCount = 2
  for (const c of customers) audits.set(c.id, [{ id: randomUUID(), action: 'create', sourceType: null, sourceId: null, reason: 'Synthetic fixture customer creation', actorUserId: actor, createdAt: c.createdAt, revision: 1 }])
  flags = { customersUnavailable: false, failNextCreate: false, loseNextCreateResponse: false, failNextList: false, failNextDetail: false, conflictNextLink: false, failNextLink: false, sessionCleanupFail: false, delays: {}, detailDelayMs: 0 }
}
reset()
function json(res, value, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', Vary: 'Cookie' }); res.end(JSON.stringify(value)) }
async function body(req) {
  let value = ''; for await (const chunk of req) { value += chunk; if (value.length > 8192) throw new Error('Fixture input too large') }
  return value ? JSON.parse(value) : {}
}
function page(rows, url, key) {
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1)), pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get('pageSize') ?? 10)))
  return { [key]: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: rows.length }
}
async function handleApi(req, res, url) {
  const path = url.pathname
  if (signedOut && path !== '/api/admin-auth/session') return json(res, { error: 'Synthetic session expired. Sign in again.' }, 401)
  if (path === '/api/admin-auth/session') return json(res, signedOut ? { authenticated: false, stage: 'signed_out' } : { authenticated: true, stage: 'ready', email: 'synthetic-admin@example.invalid' })
  if (path === '/api/admin-auth/logout' || path === '/api/operations/logout') { signedOut = true; return json(res, { authenticated: false, stage: 'signed_out' }) }
  if (path === '/api/admin-auth/sessions') return json(res, { current: { expiresAt: Date.now() + 3600000 }, otherSessionCount, otherSessions: Array.from({ length: otherSessionCount }, (_, i) => ({ expiresAt: Date.now() + 600000 + i * 100000 })), truncated: false })
  if (path === '/api/admin-auth/sessions/revoke-others') {
    const removedSessionCount = otherSessionCount; otherSessionCount = 0
    return flags.sessionCleanupFail ? json(res, { esnAccessRemoved: true, authCleanupComplete: false, removedSessionCount, code: 'AUTH_CLEANUP_PENDING', error: 'Synthetic: other ESN sessions lost access, but Auth cleanup failed. Retry cleanup; the current session is preserved.' }, 503) : json(res, { esnAccessRemoved: true, authCleanupComplete: true, removedSessionCount })
  }
  if (path === '/api/operations/session') return json(res, { authenticated: true, mode: 'staff', staffRole: 'admin', ownerEmail: 'synthetic-admin@example.invalid', storage: 'supabase', googleConfigured: false, localLoginAvailable: false })
  if (path === '/api/operations') return json(res, { enquiries: [], changes: [], calendar: { configured: false, connected: false, email: null, selectedCalendarId: null, lastSyncedAt: null, error: null }, gmail: { configured: false, connected: false, selectedLabelId: null, lastSyncedAt: null, error: null, quarantine: [] } })
  if (path === '/api/operations/bookings') return json(res, { bookings: [] })
  if (path.startsWith('/api/operations/bookings/') && path.includes('/documents/')) return json(res, { error: 'Synthetic fixture: PDF content is unavailable. No company file was accessed.' }, 503)
  if (path.startsWith('/api/operations/bookings/') && path.includes('/photos/')) return json(res, { error: 'Synthetic fixture: photo content is unavailable. No company photo was accessed.' }, 503)
  if (!path.startsWith('/api/admin/customers')) return json(res, { error: `Synthetic fixture route unavailable: ${path}. Nothing was forwarded.` }, 503)
  if (flags.customersUnavailable) return json(res, { error: 'Synthetic customer storage is unavailable. Review migration setup or retry.' }, 503)
  if (path === '/api/admin/customers' && req.method === 'GET') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase(); await new Promise(resolve => setTimeout(resolve, Number(flags.delays[q] ?? 0)))
    if (flags.failNextList) { flags.failNextList = false; return json(res, { error: 'Synthetic customer list refresh failed.' }, 503) }
    const rows = customers.filter(c => [c.name, c.email, c.phone, c.address, ...records.filter(r => links.get(r.sourceId) === c.id).map(r => r.reference)].some(value => value?.toLowerCase().includes(q)))
    return json(res, page(rows, url, 'customers'))
  }
  if (path === '/api/admin/customers/unlinked') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase()
    return json(res, page(records.filter(r => !links.has(r.sourceId) && [r.name, r.email, r.reference].some(value => value?.toLowerCase().includes(q))), url, 'records'))
  }
  if (path === '/api/admin/customers' && req.method === 'POST') {
    const value = await body(req), key = `create:${value.idempotencyKey}`, signature = JSON.stringify(value), prior = attempts.get(key)
    if (prior) return json(res, prior.signature === signature ? prior.result : { error: 'Synthetic request key conflict.' }, prior.signature === signature ? 201 : 409)
    if (flags.failNextCreate) { flags.failNextCreate = false; return json(res, { error: 'Synthetic create failed. Your details were preserved; retry the same request.' }, 503) }
    if (!value.name?.trim()) return json(res, { error: 'Enter name.' }, 400)
    const c = { ...customer(value.name), email: value.email || null, phone: value.phone || null, address: value.address || null }; customers.unshift(c)
    audits.set(c.id, [{ id: randomUUID(), action: 'create', sourceType: null, sourceId: null, reason: 'Synthetic customer created in UI', actorUserId: actor, createdAt: c.createdAt, revision: c.revision }])
    const result = { customer: c }; attempts.set(key, { signature, result })
    if (flags.loseNextCreateResponse) { flags.loseNextCreateResponse = false; return json(res, { error: 'Synthetic saved customer response was lost. Retry unchanged details to recover the saved result.' }, 503) }
    return json(res, result, 201)
  }
  const match = path.match(/^\/api\/admin\/customers\/([^/]+)(\/links)?$/)
  const c = customers.find(c => c.id === match?.[1])
  if (!c) return json(res, { error: 'Synthetic customer not found.' }, 404)
  if (!match[2]) {
    await new Promise(resolve => setTimeout(resolve, flags.detailDelayMs))
    if (flags.failNextDetail) { flags.failNextDetail = false; return json(res, { error: 'Synthetic customer detail refresh failed.' }, 503) }
    return json(res, { customer: c, records: records.filter(r => links.get(r.sourceId) === c.id), audit: audits.get(c.id) ?? [], purchases: { status: 'unavailable' }, billing: { status: 'unavailable' } })
  }
  const value = await body(req), key = `link:${value.idempotencyKey}`, signature = JSON.stringify({ id: c.id, ...value }), prior = attempts.get(key)
  if (prior) return json(res, prior.signature === signature ? prior.result : { error: 'Synthetic request key conflict.' }, prior.signature === signature ? 200 : 409)
  if (flags.failNextLink) { flags.failNextLink = false; return json(res, { error: 'Synthetic classification save failed. Retry unchanged details.' }, 503) }
  if (flags.conflictNextLink) { flags.conflictNextLink = false; c.revision++; return json(res, { error: 'Synthetic revision conflict. Refresh and compare again.' }, 409) }
  if (value.expectedRevision !== c.revision) return json(res, { error: 'Synthetic customer revision changed.' }, 409)
  const record = records.find(r => r.sourceId === value.sourceId && r.sourceType === value.sourceType)
  if (!record || !value.reason?.trim()) return json(res, { error: 'Synthetic source and reason are required.' }, 400)
  if (value.action === 'link') { if (links.has(record.sourceId)) return json(res, { error: 'Synthetic source already linked.' }, 409); links.set(record.sourceId, c.id) }
  else if (value.action === 'unlink') { if (links.get(record.sourceId) !== c.id) return json(res, { error: 'Synthetic source does not belong to this customer.' }, 409); links.delete(record.sourceId) }
  else return json(res, { error: 'Invalid synthetic action.' }, 400)
  c.revision++; c.updatedAt = new Date().toISOString()
  audits.get(c.id).unshift({ id: randomUUID(), action: value.action, sourceType: record.sourceType, sourceId: record.sourceId, reason: value.reason, actorUserId: actor, createdAt: c.updatedAt, revision: c.revision })
  const result = { customer: { ...c } }; attempts.set(key, { signature, result }); return json(res, result)
}
const server = http.createServer(async (req, res) => {
  try {
    if (!['127.0.0.1:3013', 'localhost:3013'].includes(req.headers.host) || !req.url?.startsWith('/') || req.url.startsWith('//')) return json(res, { error: 'Loopback fixture only.' }, 403)
    const url = new URL(req.url, `http://127.0.0.1:${port}`)
    if (url.pathname === '/__fixture/control' && req.method === 'POST') {
      const value = await body(req); if (value.reset) reset()
      for (const name of Object.keys(flags)) if (name in value) flags[name] = value[name]
      if ('signedOut' in value) signedOut = Boolean(value.signedOut)
      if ('otherSessionCount' in value) otherSessionCount = Math.max(0, Math.min(50, Number(value.otherSessionCount)))
      return json(res, { synthetic: true, flags, signedOut, otherSessionCount })
    }
    if (url.pathname === '/__fixture/state') return json(res, { synthetic: true, flags, signedOut, otherSessionCount, customers, records, links: [...links], audits: [...audits], attemptCount: attempts.size })
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url)
    if (!['GET', 'HEAD'].includes(req.method) || !(url.pathname === '/admin' || url.pathname.startsWith('/_next/') || url.pathname === '/favicon.ico')) return json(res, { error: 'Synthetic fixture only proxies /admin and Next static assets.' }, 404)
    const response = await fetch(`${upstream}${url.pathname}${url.search}`, { redirect: 'manual', headers: { accept: req.headers.accept ?? '*/*' } })
    const headers = Object.fromEntries(response.headers); for (const name of ['set-cookie', 'content-encoding', 'content-length', 'transfer-encoding', 'location']) delete headers[name]
    const bytes = await response.arrayBuffer()
    headers['x-esn-fixture'] = 'synthetic'
    res.writeHead(response.status, headers)
    if (req.method === 'HEAD') return res.end()

    res.end(Buffer.from(bytes))
  } catch { if (!res.headersSent) json(res, { error: 'Synthetic fixture request failed.' }, 500); else res.end() }
})
server.listen(port, '127.0.0.1', () => process.stdout.write(`Synthetic ESN UI fixture: http://127.0.0.1:${port}/admin\nControls: POST /__fixture/control · state: GET /__fixture/state\n`))
