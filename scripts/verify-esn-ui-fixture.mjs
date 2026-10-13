// Synthetic loopback UI fixture. Only explicit admin/quote pages and UI static assets
// are proxied. ALL APIs stay local; Cookie/Authorization/Set-Cookie never forward.
import http from 'node:http'
import { randomUUID } from 'node:crypto'

const port = Number(process.env.EMS_FIXTURE_PORT ?? 3013)
const upstreamUrl = new URL(process.env.EMS_FIXTURE_UPSTREAM ?? 'http://127.0.0.1:3002')
if (!Number.isInteger(port) || port < 1024 || port > 65535 || upstreamUrl.protocol !== 'http:' || upstreamUrl.hostname !== '127.0.0.1' || upstreamUrl.username || upstreamUrl.password || upstreamUrl.pathname !== '/' || upstreamUrl.search || upstreamUrl.hash || Number(upstreamUrl.port || 80) === port) throw new Error('Fixture requires distinct loopback HTTP ports.')
const upstream = upstreamUrl.origin
const adminPages = new Set(['/admin', '/admin/customers', '/admin/enquiries', '/admin/quotes', '/admin/schedule', '/admin/settings', '/admin/jobs', '/admin/orders', '/admin/inventory', '/admin/reports', '/quote/start'])
const publicAssets = new Set(['/favicon.ico', '/images/lk-group-logo-circle-transparent.png'])
function optimizedPublicLogo(url) {
  const query = url.searchParams
  return url.pathname === '/_next/image' && query.size === 3 &&
    query.getAll('url').length === 1 && query.get('url') === '/images/lk-group-logo-circle-transparent.png' &&
    query.getAll('w').length === 1 && ['96', '128', '256'].includes(query.get('w')) &&
    query.getAll('q').length === 1 && query.get('q') === '75'
}
const authStages = new Set(['signed_out', 'password_change', 'email_verify', 'mfa_enroll', 'mfa_verify', 'ready'])
const navigationHeaders = ['accept', 'rsc', 'next-router-state-tree', 'next-router-prefetch', 'next-router-segment-prefetch', 'next-url', 'purpose']
let customers, records, links, audits, attempts, flags, signedOut, otherSessionCount, authStage, staffRole, emailVerification, requests, enquiries, bookingDetails, consentAttempts, quoteWorkspaces, newQuoteAttempts
const sleep = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(30000, Number(ms) || 0))))
function session() { return { authenticated: !signedOut && authStage !== 'signed_out', stage: signedOut ? 'signed_out' : authStage, email: 'synthetic-admin@example.invalid', emailVerification, factors: [{ id: 'synthetic-factor', friendlyName: 'Synthetic authenticator' }] } }
function syntheticBooking(record) {
  const now = new Date().toISOString(), signature = { name: 'Synthetic Signer', strokes: [[{ x: .1, y: .2 }, { x: .3, y: .5 }, { x: .5, y: .3 }, { x: .7, y: .6 }]] }
  const snapshot = { mode: 'demo', version: 'kcp-demo-v2', draftId: record.sourceId, draftRevision: 1, preferredDate: '2026-10-12', price: { currency: 'AUD', totalCents: 125000, label: 'SYNTHETIC sample only' }, terms: ['Synthetic nonbinding demonstration only.'], photos: record.photos.map(photo => ({ photoId: photo.id, contentHash: 'a'.repeat(64), processingVersion: 'quote-photo-jpeg-v1' })), payload: { contact: { name: record.name, email: record.email, phone: record.phone, siteAddress: record.address, suburb: 'Synthetic suburb', postcode: '0000', details: 'Synthetic fixture project', consent: true }, service: { serviceId: 'cabinet-painting', intent: 'full-repainting', surfaces: ['doors'], doorCount: 4, drawerCount: 2, material: 'Synthetic material', colourPreference: 'Synthetic colour' } } }
  return { submission: { id: record.sourceId, reference: record.reference, snapshot, snapshotHash: 'synthetic-snapshot-hash', signature, submittedAt: now, emailStatus: 'provider_accepted', calendarStatus: 'synced' }, booking: { id: record.sourceId, revision: 1, status: 'requested', syncStatus: 'pending', confirmedProposalId: null, pendingProposalId: null, confirmedAt: null }, proposals: [] }
}
function operationsDashboard() {
  const connected = flags.connected
  return { enquiries, changes: [], calendar: { configured: true, connected, status: connected ? 'ready' : 'not_connected', email: connected ? 'synthetic-admin@example.invalid' : null, selectedCalendarId: connected ? 'synthetic-calendar' : null, lastSyncedAt: null, error: null }, gmail: { configured: true, connected, status: connected ? 'ready' : 'not_connected', selectedLabelId: connected ? 'synthetic-label' : null, lastSyncedAt: null, error: null, quarantine: [] } }
}
function syntheticPdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  const stream = 'BT /F1 16 Tf 40 740 Td (SYNTHETIC FIXTURE - NOT A COMPANY DOCUMENT) Tj ET'
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  let pdf = '%PDF-1.4\n', offsets = [0]
  objects.forEach((value, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${value}\nendobj\n` })
  const start = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`
  return Buffer.from(pdf)
}
function binary(res, bytes, type) { res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, no-store', 'X-ESN-Fixture': 'synthetic' }); res.end(bytes) }
function customerDetail() { return [...bookingDetails.values()][0] }
function customerSubmission() {
  const { submission } = customerDetail()
  return { id: submission.id, reference: submission.reference, submittedAt: submission.submittedAt, preferredDate: submission.snapshot.preferredDate, emailStatus: submission.emailStatus, calendarStatus: submission.calendarStatus, error: null }
}
function addCustomerProposal() {
  const detail = customerDetail(), revision = detail.proposals.length + 1
  const segments = [{ id: randomUUID(), startAt: '2026-10-19T22:00:00.000Z', endAt: '2026-10-20T00:00:00.000Z' }]
  const proposal = { id: randomUUID(), revision, snapshotHash: `synthetic-proposal-${revision}-hash`, segments, notes: `Synthetic customer proposal ${revision}`, createdAt: new Date().toISOString(), signature: null, consentedAt: null, emailStatus: 'pending', emailError: null, confirmedAt: null }
  proposal.snapshot = { mode: 'demo', version: 'booking-demo-v1', submissionId: detail.submission.id, reference: detail.submission.reference, submission: structuredClone(detail.submission.snapshot), proposalId: proposal.id, proposalRevision: revision, resource: 'demo-single-resource', segments, notes: proposal.notes }
  detail.proposals.push(proposal); detail.booking.revision++; detail.booking.pendingProposalId = proposal.id
}

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
  authStage = 'ready'; staffRole = 'admin'; emailVerification = undefined; requests = []; consentAttempts = []; quoteWorkspaces = new Map(); newQuoteAttempts = []
  bookingDetails = new Map(records.filter(record => record.sourceType === 'submission').map(record => [record.sourceId, syntheticBooking(record)]))
  enquiries = [{ id: records[1].sourceId, reference: records[1].reference, source: 'gmail', serviceId: 'cabinet-painting', projectIntent: 'refresh', targetSurfaces: ['doors'], suburb: 'Synthetic suburb', postcode: '0000', doorCount: 4, drawerCount: 2, notes: 'Synthetic enquiry only', name: records[1].name, email: records[1].email, phone: records[1].phone, siteAddress: records[1].address, preferredDate: null, acknowledgement: true, senderReviewRequired: true, attachmentCount: 0, status: 'submitted', revision: 1, createdAt: new Date().toISOString(), startAt: null, endAt: null, scheduleNotes: null, calendarStatus: 'pending', calendarError: null, gmail: { threadId: 'synthetic-thread', messages: [{ messageId: 'synthetic-message', receivedAt: new Date().toISOString(), senderName: records[1].name, senderEmail: records[1].email, subject: 'Synthetic cabinet enquiry', bodyText: 'Synthetic imported message. No company Gmail was accessed.', bodyStatus: 'available', attachmentCount: 0 }], historyTruncated: false } }]
  flags = { connected: false, failures: {}, apiDelays: {}, responseDelays: {}, customerAccessStatus: 0, loginNextStage: 'email_verify', customersUnavailable: false, failNextCreate: false, loseNextCreateResponse: false, failNextList: false, failNextDetail: false, conflictNextLink: false, failNextLink: false, sessionCleanupFail: false, delays: {}, detailDelayMs: 0 }
}
reset()
function json(res, value, status = 200) {
  const payload = JSON.stringify(value), send = () => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', Vary: 'Cookie' }); res.end(payload) } }
  const delay = Math.max(0, Math.min(30000, Number(flags.responseDelays[res.fixtureApiPath]) || 0))
  // Capture the successful response now, then deliver it even if synthetic auth
  // is lost while waiting. This exercises the client's stale-response guard.
  if (delay) setTimeout(send, delay); else send()
}
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
  if (path === '/api/quote/booking/consent' && req.method === 'POST') { req.fixtureConsent = await body(req); consentAttempts.push(structuredClone(req.fixtureConsent)) }
  if (path === '/api/quote/draft/session/new' && req.method === 'POST') { req.fixtureNewQuote = await body(req); newQuoteAttempts.push(structuredClone(req.fixtureNewQuote)) }
  await sleep(flags.apiDelays[path])
  const injected = flags.failures[path]
  if (injected) {
    const status = Number(typeof injected === 'object' ? injected.status : injected)
    if (typeof injected === 'object' && injected.once) delete flags.failures[path]
    return json(res, { error: `Synthetic HTTP ${status} failure. No company request occurred.` }, status >= 400 && status <= 599 ? status : 503)
  }
  if (path.startsWith('/api/quote/')) {
    if ([401, 403].includes(flags.customerAccessStatus)) return json(res, { error: 'Synthetic customer access is unavailable.' }, flags.customerAccessStatus)
    const selector = url.searchParams.get('quote')
    if (url.searchParams.has('quote')) {
      if (url.searchParams.getAll('quote').length !== 1 || !quoteWorkspaces.has(selector)) return json(res, { error: 'Synthetic quote workspace is unavailable.' }, 401)
      const workspace = quoteWorkspaces.get(selector)
      if (path === '/api/quote/draft/session' && req.method === 'POST') return json(res, { ready: true })
      if (path === '/api/quote/draft' && req.method === 'GET') return json(res, { draft: workspace.draft })
      if (path === '/api/quote/draft' && req.method === 'PUT') {
        const value = await body(req)
        if (value.expectedRevision !== (workspace.draft?.revision ?? 0)) return json(res, { error: 'Synthetic draft revision changed.' }, 409)
        workspace.draft = { id: workspace.draft?.id ?? randomUUID(), revision: value.expectedRevision + 1, savedAt: new Date().toISOString(), payload: value.payload }
        return json(res, { draft: workspace.draft })
      }
      if (path === '/api/quote/demo' && req.method === 'GET') return json(res, { enabled: true, recipientEmail: 'lnkgroupsydney@gmail.com', submission: null })
      if (path === '/api/quote/submission' && req.method === 'GET') return json(res, { submission: null })
      if (path === '/api/quote/photos' && req.method === 'GET' && workspace.draft) return json(res, { photos: [], draftRevision: workspace.draft.revision, submitted: false })
      return json(res, { error: 'Synthetic new quote endpoint is unavailable. Nothing was forwarded.' }, 503)
    }
    const detail = customerDetail()
    if (path === '/api/quote/draft/session/new' && req.method === 'POST') {
      const { nextId } = req.fixtureNewQuote
      if (typeof nextId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(nextId)) return json(res, { error: 'Synthetic quote identifier is invalid.' }, 400)
      if (!quoteWorkspaces.has(nextId)) quoteWorkspaces.set(nextId, { draft: null })
      return json(res, { ready: true, href: `/quote/start?service=cabinet-painting&quote=${nextId}` })
    }
    if (path === '/api/quote/draft/session' && req.method === 'POST') return json(res, { ready: true })
    if (path === '/api/quote/draft' && req.method === 'GET') return json(res, { draft: { id: detail.submission.id, revision: 1, savedAt: detail.submission.submittedAt, payload: detail.submission.snapshot.payload } })
    if (path === '/api/quote/demo' && req.method === 'GET') return json(res, { enabled: true, recipientEmail: detail.submission.snapshot.payload.contact.email, submission: customerSubmission() })
    if (path === '/api/quote/submission' && req.method === 'GET') return json(res, { submission: customerSubmission() })
    if (path === '/api/quote/booking' && req.method === 'GET') return json(res, { detail })
    if (path === '/api/quote/booking/consent' && req.method === 'POST') {
      const value = req.fixtureConsent, key = `customer-consent:${value.idempotencyKey}`, signature = JSON.stringify(value), prior = attempts.get(key)
      if (prior) return json(res, prior.signature === signature ? prior.result : { error: 'Synthetic consent key conflict.' }, prior.signature === signature ? 200 : 409)
      const proposal = detail.proposals.find(item => item.id === value.proposalId)
      if (!proposal || proposal.id !== detail.booking.pendingProposalId || proposal.snapshotHash !== value.snapshotHash) return json(res, { error: 'Synthetic proposal changed. Review the latest version.' }, 409)
      if (!value.signature?.acknowledged || !value.signature.name || !Array.isArray(value.signature.strokes)) return json(res, { error: 'Synthetic consent requires a signature.' }, 400)
      proposal.signature = structuredClone(value.signature); proposal.consentedAt = new Date().toISOString(); proposal.emailStatus = 'pending'; detail.booking.revision++
      const result = { detail: structuredClone(detail) }; attempts.set(key, { signature, result }); return json(res, result)
    }
    const photoRoute = path.match(/^\/api\/quote\/photos\/([^/]+)\/content$/)
    if (photoRoute && req.method === 'GET') {
      if (!detail.submission.snapshot.photos?.some(photo => photo.photoId === photoRoute[1])) return json(res, { error: 'Synthetic private photo not found.' }, 404)
      return binary(res, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N70AAAAASUVORK5CYII=', 'base64'), 'image/png')
    }
    if (/^\/api\/quote\/booking\/documents\/(quote|agreement)$/.test(path) && req.method === 'GET') return binary(res, syntheticPdf(), 'application/pdf')
    return json(res, { error: 'Synthetic customer endpoint is unavailable. Nothing was forwarded.' }, 503)
  }
  if (path === '/api/admin-auth/session' && req.method === 'GET') return json(res, session())
  if (path === '/api/admin-auth/login' && req.method === 'POST') { await body(req); signedOut = false; authStage = authStages.has(flags.loginNextStage) ? flags.loginNextStage : 'email_verify'; return json(res, session()) }
  if (path === '/api/admin-auth/logout' || path === '/api/operations/logout') { signedOut = true; authStage = 'signed_out'; return json(res, session()) }
  if (path === '/api/admin-auth/password' && req.method === 'POST') { await body(req); authStage = 'email_verify'; return json(res, session()) }
  if (path === '/api/admin-auth/email/send' && req.method === 'POST') { emailVerification = { sent: true, expiresAt: Date.now() + 600000, retryAt: Date.now() + 60000 }; return json(res, emailVerification) }
  if (path === '/api/admin-auth/mfa/enroll' && req.method === 'POST') return json(res, { factorId: 'synthetic-factor', qrCode: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="white"/><text x="8" y="60">SYNTHETIC</text></svg>', secret: 'SYNTHETIC-SETUP-ONLY' })
  if ((path === '/api/admin-auth/email/verify' || path === '/api/admin-auth/mfa/verify') && req.method === 'POST') { const value = await body(req); if (value.code !== '123456') return json(res, { error: 'Synthetic code is 123456.' }, 400); authStage = 'ready'; return json(res, session()) }
  if (signedOut || authStage !== 'ready') return json(res, { error: 'Synthetic administrator verification required.' }, signedOut || authStage === 'signed_out' ? 401 : 403)
  if (path === '/api/admin-auth/sessions') return json(res, { current: { expiresAt: Date.now() + 3600000 }, otherSessionCount, otherSessions: Array.from({ length: otherSessionCount }, (_, i) => ({ expiresAt: Date.now() + 600000 + i * 100000 })), truncated: false })
  if (path === '/api/admin-auth/sessions/revoke-others') {
    const removedSessionCount = otherSessionCount; otherSessionCount = 0
    return flags.sessionCleanupFail ? json(res, { esnAccessRemoved: true, authCleanupComplete: false, removedSessionCount, code: 'AUTH_CLEANUP_PENDING', error: 'Synthetic: other ESN sessions lost access, but Auth cleanup failed. Retry cleanup; the current session is preserved.' }, 503) : json(res, { esnAccessRemoved: true, authCleanupComplete: true, removedSessionCount })
  }
  if (path === '/api/operations/session') return json(res, { authenticated: true, mode: 'staff', staffRole, ownerEmail: 'synthetic-admin@example.invalid', storage: 'supabase', googleConfigured: true, localLoginAvailable: false })
  if (path === '/api/operations') return json(res, operationsDashboard())
  if (['/api/operations/calendars', '/api/operations/gmail/labels', '/api/operations/calendar', '/api/operations/gmail', '/api/operations/sync', '/api/google/connect'].includes(path)) {
    if (staffRole !== 'owner') return json(res, { error: 'Synthetic owner permission required.' }, 403)
    if (path === '/api/operations/calendars') return json(res, { calendars: [{ id: 'synthetic-calendar', summary: 'Synthetic company calendar', accessRole: 'owner' }] })
    if (path === '/api/operations/gmail/labels') return json(res, { labels: [{ id: 'synthetic-label', name: 'Synthetic enquiries', type: 'user' }] })
    if (path === '/api/operations/sync') return json(res, { gmail: { imported: 0, scanned: 0 }, calendar: { synced: 0, reviewed: 0 } })
    if (path === '/api/google/connect') return json(res, { error: 'Synthetic fixture blocks real OAuth navigation.' }, 503)
    await body(req); return json(res, { saved: true })
  }
  const schedule = path.match(/^\/api\/operations\/enquiries\/([^/]+)\/schedule$/)
  if (schedule && req.method === 'POST') {
    const value = await body(req), enquiry = enquiries.find(item => item.id === schedule[1])
    if (!enquiry) return json(res, { error: 'Synthetic enquiry not found.' }, 404)
    if (value.expectedRevision !== enquiry.revision) return json(res, { error: 'Synthetic revision conflict.' }, 409)
    Object.assign(enquiry, { revision: enquiry.revision + 1, status: 'provisional', startAt: `${value.startLocal}:00+11:00`, endAt: `${value.endLocal}:00+11:00`, scheduleNotes: value.notes })
    return json(res, { enquiry })
  }
  if (path === '/api/operations/bookings') return json(res, { bookings: [...bookingDetails.values()].map(detail => ({ ...detail.booking, reference: detail.submission.reference, clientName: detail.submission.snapshot.payload.contact.name, preferredDate: detail.submission.snapshot.preferredDate, submittedAt: detail.submission.submittedAt, proposalEmailStatus: detail.proposals.at(-1)?.emailStatus ?? null })) })
  const bookingRoute = path.match(/^\/api\/operations\/bookings\/([^/]+)(?:\/(changes|proposals|confirm|documents\/(quote|agreement)|photos\/([^/]+)))?$/)
  if (bookingRoute) {
    const detail = bookingDetails.get(bookingRoute[1])
    if (!detail) return json(res, { error: 'Synthetic booking not found.' }, 404)
    if (bookingRoute[2]?.startsWith('documents/')) return binary(res, syntheticPdf(), 'application/pdf')
    if (bookingRoute[2]?.startsWith('photos/')) {
      if (!detail.submission.snapshot.photos.some(photo => photo.photoId === bookingRoute[4])) return json(res, { error: 'Synthetic photo not found.' }, 404)
      return binary(res, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N70AAAAASUVORK5CYII=', 'base64'), 'image/png')
    }
    if (bookingRoute[2] === 'changes') return json(res, { changes: [] })
    if (!bookingRoute[2] && req.method === 'GET') return json(res, { detail })
    if (bookingRoute[2] === 'proposals' && req.method === 'POST') {
      const value = await body(req), key = `proposal:${value.idempotencyKey}`, signature = JSON.stringify(value), prior = attempts.get(key)
      if (prior) return json(res, prior.signature === signature ? prior.result : { error: 'Synthetic request key conflict.' }, prior.signature === signature ? 200 : 409)
      if (value.expectedRevision !== detail.booking.revision) return json(res, { error: 'Synthetic booking revision conflict.' }, 409)
      const proposal = { id: randomUUID(), revision: detail.proposals.length + 1, snapshotHash: 'synthetic-proposal-hash', segments: value.segments.map(segment => ({ id: randomUUID(), startAt: `${segment.startLocal}:00+11:00`, endAt: `${segment.endLocal}:00+11:00` })), notes: value.notes, createdAt: new Date().toISOString(), signature: null, consentedAt: null, emailStatus: 'pending', emailError: null, confirmedAt: null }
      proposal.snapshot = { mode: 'demo', version: 'booking-demo-v1', submissionId: detail.submission.id, reference: detail.submission.reference, submission: structuredClone(detail.submission.snapshot), proposalId: proposal.id, proposalRevision: proposal.revision, resource: 'demo-single-resource', segments: proposal.segments, notes: proposal.notes }
      detail.proposals.push(proposal); detail.booking.revision++; detail.booking.pendingProposalId = proposal.id
      const result = { detail: structuredClone(detail) }; attempts.set(key, { signature, result }); return json(res, result)
    }
    if (bookingRoute[2] === 'confirm' && req.method === 'POST') {
      const value = await body(req), key = `confirm:${value.idempotencyKey}`, signature = JSON.stringify(value), prior = attempts.get(key)
      if (prior) return json(res, prior.signature === signature ? prior.result : { error: 'Synthetic request key conflict.' }, prior.signature === signature ? 200 : 409)
      if (value.expectedRevision !== detail.booking.revision) return json(res, { error: 'Synthetic booking revision conflict.' }, 409)
      const proposal = detail.proposals.find(item => item.id === value.proposalId)
      if (!proposal?.signature || proposal.emailStatus !== 'provider_accepted') return json(res, { error: 'Synthetic proposal requires a signature and email acceptance.' }, 422)
      proposal.confirmedAt = new Date().toISOString()
      Object.assign(detail.booking, { revision: detail.booking.revision + 1, status: 'confirmed', syncStatus: 'synced', confirmedProposalId: proposal.id, confirmedAt: proposal.confirmedAt })
      const result = { detail: structuredClone(detail) }; attempts.set(key, { signature, result }); return json(res, result)
    }
    return json(res, { error: 'Synthetic booking action not supported. Nothing was forwarded.' }, 503)
  }
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
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host) || !req.url?.startsWith('/') || req.url.startsWith('//')) return json(res, { error: 'Loopback fixture only.' }, 403)
    const url = new URL(req.url, `http://127.0.0.1:${port}`)
    if (url.pathname === '/__fixture/control' && req.method === 'POST') {
      const value = await body(req); if (value.reset) reset()
      for (const name of Object.keys(flags)) if (name in value) flags[name] = value[name]
      if ('signedOut' in value) { signedOut = Boolean(value.signedOut); authStage = signedOut ? 'signed_out' : 'ready' }
      if (authStages.has(value.authStage)) { authStage = value.authStage; signedOut = authStage === 'signed_out' }
      if (['owner', 'admin'].includes(value.staffRole)) staffRole = value.staffRole
      if ('customerPhotoCount' in value) {
        const count = Math.max(0, Math.min(2, Number(value.customerPhotoCount) || 0))
        customerDetail().submission.snapshot.photos = Array.from({ length: count }, (_, index) => ({ photoId: randomUUID(), contentHash: String(index + 1).repeat(64), processingVersion: 'quote-photo-jpeg-v1' }))
      }
      if (value.customerLegacyV1) { customerDetail().submission.snapshot.version = 'kcp-demo-v1'; delete customerDetail().submission.snapshot.photos }
      if (value.newCustomerProposal) addCustomerProposal()
      if (value.customerEmailAccepted) {
        const detail = customerDetail(), proposal = detail.proposals.find(item => item.id === detail.booking.pendingProposalId)
        if (proposal) proposal.emailStatus = 'provider_accepted'
      }
      if (value.confirmCustomerProposal) {
        const detail = customerDetail(), proposal = detail.proposals.find(item => item.id === detail.booking.pendingProposalId)
        if (proposal?.signature) { proposal.confirmedAt = new Date().toISOString(); Object.assign(detail.booking, { revision: detail.booking.revision + 1, status: 'confirmed', syncStatus: 'synced', confirmedProposalId: proposal.id, confirmedAt: proposal.confirmedAt }) }
      }
      if (value.signPendingProposals) for (const detail of bookingDetails.values()) {
        const proposal = detail.proposals.find(item => item.id === detail.booking.pendingProposalId)
        if (proposal) { proposal.signature = structuredClone(detail.submission.signature); proposal.consentedAt = new Date().toISOString(); proposal.emailStatus = 'provider_accepted' }
      }
      if ('otherSessionCount' in value) otherSessionCount = Math.max(0, Math.min(50, Number(value.otherSessionCount)))
      return json(res, { synthetic: true, flags, signedOut, authStage, staffRole, otherSessionCount })
    }
    if (url.pathname === '/__fixture/state') return json(res, { synthetic: true, flags, signedOut, authStage, staffRole, otherSessionCount, customers, records, enquiries, bookings: [...bookingDetails.values()], requests, consentAttempts, newQuoteAttempts, quoteWorkspaces: [...quoteWorkspaces], links: [...links], audits: [...audits], attemptCount: attempts.size })
    if (url.pathname.startsWith('/api/')) { res.fixtureApiPath = url.pathname; requests.push({ path: url.pathname, method: req.method, at: Date.now() }); return await handleApi(req, res, url) }
    if (!['GET', 'HEAD'].includes(req.method) || !(adminPages.has(url.pathname) || url.pathname.startsWith('/_next/static/') || publicAssets.has(url.pathname) || optimizedPublicLogo(url))) return json(res, { error: 'Synthetic fixture only proxies approved admin/quote pages and explicit UI static assets.' }, 404)
    const forwarded = {}
    for (const name of navigationHeaders) if (typeof req.headers[name] === 'string') forwarded[name] = req.headers[name]
    if (forwarded['next-url']) {
      const nextUrl = new URL(forwarded['next-url'], `http://127.0.0.1:${port}`)
      if (!adminPages.has(nextUrl.pathname) || ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(nextUrl.origin)) return json(res, { error: 'Fixture rejected an unapproved navigation target.' }, 400)
      forwarded['next-url'] = nextUrl.pathname + nextUrl.search
    }
    const response = await fetch(`${upstream}${url.pathname}${url.search}`, { method: req.method, redirect: 'manual', headers: forwarded })
    const headers = Object.fromEntries(response.headers)
    for (const name of ['set-cookie', 'content-encoding', 'content-length', 'transfer-encoding', 'connection', 'location', 'x-nextjs-redirect']) delete headers[name]
    headers['cache-control'] = 'private, no-store'
    const bytes = await response.arrayBuffer()
    headers['x-esn-fixture'] = 'synthetic'
    res.writeHead(response.status, headers)
    if (req.method === 'HEAD') return res.end()

    res.end(Buffer.from(bytes))
  } catch { if (!res.headersSent) json(res, { error: 'Synthetic fixture request failed.' }, 500); else res.end() }
})
server.listen(port, '127.0.0.1', () => process.stdout.write(`Synthetic ESN UI fixture: http://127.0.0.1:${port}/admin\nControls: POST /__fixture/control · state: GET /__fixture/state\n`))
