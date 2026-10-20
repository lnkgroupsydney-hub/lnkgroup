// Synthetic loopback UI fixture. Only explicit admin/quote pages and UI static assets
// are proxied. ALL APIs stay local; Cookie/Authorization/Set-Cookie never forward.
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { parseLiveRequest } from '../src/modules/quotes/presentation/request-client.ts'
import { parsePhotoWorkspace } from '../src/modules/quotes/presentation/photo-workspace-client.ts'
import { parseBookingState } from '../src/modules/quotes/presentation/booking-flow-client.ts'
import { calculatePreviousEstimatePricing } from '../src/modules/quotes/domain/pricing.ts'
import { PHOTO_ROLES } from '../src/modules/quotes/domain/analysis.ts'
import { bookingAcknowledgment } from '../src/modules/quotes/domain/booking-flow.ts'
import { COMPANY_BOOKING_ACK_VERSION, COMPANY_BOOKING_ACK_TEXT } from '../src/modules/bookings/domain/live-contracts.ts'
import { parseCompanyState } from '../src/modules/bookings/presentation/live-booking-client.ts'

const port = Number(process.env.EMS_FIXTURE_PORT ?? 3013)
const upstreamUrl = new URL(process.env.EMS_FIXTURE_UPSTREAM ?? 'http://127.0.0.1:3002')
if (!Number.isInteger(port) || port < 1024 || port > 65535 || upstreamUrl.protocol !== 'http:' || upstreamUrl.hostname !== '127.0.0.1' || upstreamUrl.username || upstreamUrl.password || upstreamUrl.pathname !== '/' || upstreamUrl.search || upstreamUrl.hash || Number(upstreamUrl.port || 80) === port) throw new Error('Fixture requires distinct loopback HTTP ports.')
const upstream = upstreamUrl.origin
const adminPages = new Set(['/', '/admin', '/admin/customers', '/admin/enquiries', '/admin/quotes', '/admin/schedule', '/admin/settings', '/admin/jobs', '/admin/orders', '/admin/inventory', '/admin/reports', '/quote/start'])
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
function permittedPage(path) {
  if (adminPages.has(path)) return true
  const detail = path.match(/^\/admin\/(customers|quotes|enquiries|schedule)\/([^/]+)$/)
  if (!detail || !UUID.test(detail[2])) return false
  return detail[1] === 'customers' ? customers.some(customer => customer.id === detail[2]) : liveRequests.some(request => request.id === detail[2])
}
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
let properties, crmRelations, commandAttempts, customers, records, links, audits, attempts, flags, signedOut, otherSessionCount, authStage, staffRole, emailVerification, requests, enquiries, bookingDetails, consentAttempts, quoteWorkspaces, newQuoteAttempts, liveRequests, liveAnalysis, liveBookings, liveAudits
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
  return { id: randomUUID(), companyId: 'lk-group', name, email: index === 0 ? `${'longsyntheticcontact'.repeat(5)}@example.invalid` : `synthetic${index}@example.invalid`, phone: `Synthetic phone ${index} — not callable`, address: 'Synthetic Sydney address — not a real property', status: 'active', archivedAt: null, revision: 1, createdAt: now, updatedAt: now }
}
function reset() {
  customers = Array.from({ length: 13 }, (_, index) => customer(index === 0 ? `Synthetic ${'VeryLongCustomerName'.repeat(5)}` : `Synthetic Customer ${index + 1}`, index))
  records = Array.from({ length: 4 }, (_, index) => {
    const id = randomUUID(), photo = randomUUID()
    return { sourceType: index === 0 ? 'submission' : 'enquiry', sourceId: id, reference: index === 0 ? 'SYNTHETIC-DEMO-001' : `SYNTHETIC-ENQ-${index}`, name: `Synthetic Source Contact ${index + 1}`, email: `source${index}@example.invalid`, phone: 'Synthetic source phone', address: 'Synthetic source address', createdAt: new Date().toISOString(), status: 'synthetic_demo', relatedEnquiryIds: [], booking: index === 0 ? { status: 'requested', revision: 1, syncStatus: 'pending', confirmedAt: null } : null, photos: index === 0 ? [{ id: photo, url: `/api/operations/bookings/${id}/photos/${photo}` }] : [], links: index === 0 ? { detail: `/api/operations/bookings/${id}`, quotePdf: `/api/operations/bookings/${id}/documents/quote`, agreementPdf: `/api/operations/bookings/${id}/documents/agreement`, photos: null } : { detail: null, quotePdf: null, agreementPdf: null, photos: null } }
  })
  properties = []; crmRelations = new Map(); commandAttempts = [];
  links = new Map(); audits = new Map(); attempts = new Map(); signedOut = false; otherSessionCount = 2
  for (const c of customers) audits.set(c.id, [{ id: randomUUID(), action: 'create', sourceType: null, sourceId: null, reason: 'Synthetic fixture customer creation', actorUserId: actor, createdAt: c.createdAt, revision: 1 }])
  authStage = 'ready'; staffRole = 'admin'; emailVerification = undefined; requests = []; consentAttempts = []; quoteWorkspaces = new Map(); newQuoteAttempts = []
  bookingDetails = new Map(records.filter(record => record.sourceType === 'submission').map(record => [record.sourceId, syntheticBooking(record)]))
  enquiries = [{ id: records[1].sourceId, reference: records[1].reference, source: 'gmail', serviceId: 'cabinet-painting', projectIntent: 'refresh', targetSurfaces: ['doors'], suburb: 'Synthetic suburb', postcode: '0000', doorCount: 4, drawerCount: 2, notes: 'Synthetic enquiry only', name: records[1].name, email: records[1].email, phone: records[1].phone, siteAddress: records[1].address, preferredDate: null, acknowledgement: true, senderReviewRequired: true, attachmentCount: 0, status: 'submitted', revision: 1, createdAt: new Date().toISOString(), startAt: null, endAt: null, scheduleNotes: null, calendarStatus: 'pending', calendarError: null, gmail: { threadId: 'synthetic-thread', messages: [{ messageId: 'synthetic-message', receivedAt: new Date().toISOString(), senderName: records[1].name, senderEmail: records[1].email, subject: 'Synthetic cabinet enquiry', bodyText: 'Synthetic imported message. No company Gmail was accessed.', bodyStatus: 'available', attachmentCount: 0 }], historyTruncated: false } }]
  seedLiveRecords()
  flags = { connected: false, failures: {}, apiDelays: {}, responseDelays: {}, customerAccessStatus: 0, loginNextStage: 'email_verify', customersUnavailable: false, failNextCreate: false, loseNextCreateResponse: false, failNextList: false, failNextDetail: false, conflictNextLink: false, failNextLink: false, loseNextLinkResponse: false, sessionCleanupFail: false, delays: {}, detailDelayMs: 0, liveAnalysisProcessing: false, conflictNextMutation: false, loseNextMutationResponse: false, loseNextCrmResponse: false }
}
function seedLiveRecords() {
  const now = new Date().toISOString(), calendarTarget = { accountSub: 'synthetic-account', calendarId: 'synthetic-calendar' }
  liveAnalysis = new Map(); liveBookings = new Map(); liveAudits = new Map()
  liveRequests = Array.from({ length: 3 }, (_, index) => {
    const id = randomUUID(), photoId = randomUUID(), submitted = index > 0
    const request = parseLiveRequest({ id, reference: `RQ-${id.replaceAll('-', '').toUpperCase()}`, mode: 'live', companyId: 'lk-group', revision: 2, status: 'review_requested', createdAt: now, savedAt: now, reviewRequestedAt: now, consentVersion: 'quote-storage-review-v1', customerId: null,
      payload: { contact: { name: `Synthetic Live Client ${index + 1}`, email: `live${index + 1}@example.invalid`, phone: 'Synthetic phone', siteAddress: `Synthetic site ${index + 1} — ${'LongStreetName '.repeat(index === 0 ? 8 : 1)}`, suburb: 'Synthetic suburb', postcode: '2000', details: 'Synthetic cabinet project only', consent: true }, service: { serviceId: 'cabinet-painting', intent: 'full-repainting', surfaces: ['doors','drawers','frames'], doorCount: null, drawerCount: null, material: 'Synthetic material', colourPreference: '' } } })
    const analysis = { summary: 'Synthetic cabinet fronts visible in the supplied photo.', outcome: 'site_review_required', photoQuality: [{ photoId, usable: true, issues: [], retakeInstruction: null }], coverage: PHOTO_ROLES.map(role => ({ role, covered: true, photoIds: [photoId], note: 'Synthetic view only.' })), observedDamage: [],
      quantities: { doors: { customer: null, observed: 10, estimated: 12, needsConfirmation: true, confidence: 'medium', basisPhotoIds: [photoId], note: 'Estimated from the main cabinet view.' }, drawers: { customer: null, observed: 4, estimated: 4, needsConfirmation: true, confidence: 'high', basisPhotoIds: [photoId], note: 'Four visible drawer fronts.' } }, proposedWork: [], unknowns: [], siteChecks: [],
      estimateScope: { status: 'estimable', extent: 'whole_project', anchorPhotoId: photoId, scopePhotoIds: [photoId], contextPhotoIds: [], conflictingPhotoIds: [], description: 'Synthetic cabinet run.', assumptions: ['Exact quantities require an on-site check.'] } }
    // Keep these saved R1/R2 examples on their original GST-inclusive policy.
    const pricing = calculatePreviousEstimatePricing(analysis, request.payload.service)
    const photo = { id: photoId, requestId: id, role: 'overview', state: 'ready', mimeType: 'image/png', sizeBytes: 68, storedBytes: 68, contentHash: 'a'.repeat(64), width: 1, height: 1, createdAt: now, expiresAt: '2030-01-01T00:00:00Z', contentUrl: `/api/admin/quote-requests/${id}/photos/${photoId}` }
    const job = { id: randomUUID(), requestId: id, inputRevision: 2, status: 'succeeded', stale: false, createdAt: now, completedAt: now, attempts: 1, error: null, usage: null, analysis, pricing }
    liveAnalysis.set(id, parsePhotoWorkspace({ request, photos: [photo], jobs: [job], latest: job }, id))
    liveAudits.set(id, [{ id: randomUUID(), action: 'request_review', actorType: 'guest', revision: 2, createdAt: now }])
    const acknowledgement = bookingAcknowledgment(submitted ? 'live-booking-request-ack-v2' : 'live-booking-request-ack-v1')
    const preferredDate = `2026-11-${String(3 + index * 2).padStart(2,'0')}`, preferredTime = submitted ? '10:30' : null
    const snapshot = { mode: 'live', kind: 'nonbinding_booking_request', version: acknowledgement.version, requestId: id, reference: request.reference, inputRevision: 2, analysisId: job.id, payload: request.payload, verifiedEmail: request.payload.contact.email, analysis, pricing, photos: [{ id: photoId, role: 'overview', contentHash: 'a'.repeat(64), width: 1, height: 1, storedBytes: 68 }], acknowledgment: acknowledgement, calendarTarget, preferredDate, ...(submitted ? { preferredTime } : {}) }
    const submission = { id: randomUUID(), reference: `REQUEST-SYNTHETIC-${index + 1}`, requestId: id, approvalId: randomUUID(), submittedAt: now, preferredDate, preferredTime, snapshot, snapshotHash: 'a'.repeat(64), signedContentHash: 'b'.repeat(64), signature: { name: request.payload.contact.name, method: 'typed', strokes: [], acknowledged: true }, emailStatus: 'provider_accepted', calendarStatus: submitted ? 'not_required' : 'pending', error: null, receiptReady: true, providerMessageId: 'synthetic-message', calendarEventId: null }
    const state = { requestId: id, revision: 0, canWrite: true, submission, proposal: null, proposals: [], acceptance: null, booking: null, acknowledgment: { version: COMPANY_BOOKING_ACK_VERSION, text: COMPANY_BOOKING_ACK_TEXT } }
    if (index === 2) {
      const visits = [{ purpose: 'take_off', kind: 'timed', startAt: `${preferredDate}T10:30:00+11:00`, endAt: `${preferredDate}T12:30:00+11:00`, startDate: preferredDate, endDate: preferredDate, startLocal: `${preferredDate}T10:30`, endLocal: `${preferredDate}T12:30` }, { purpose: 'install', kind: 'timed', startAt: '2026-11-09T09:00:00+11:00', endAt: '2026-11-09T11:00:00+11:00', startDate: '2026-11-09', endDate: '2026-11-09', startLocal: '2026-11-09T09:00', endLocal: '2026-11-09T11:00' }]
      const proposal = { id: randomUUID(), version: 1, revision: 1, status: 'published', hash: 'c'.repeat(64), currency: 'AUD', amountExGst: pricing.subtotal, gst: pricing.tax, total: pricing.total, scope: 'Synthetic cabinet painting scope.', adjustmentReason: '', confirmationBasis: 'signed_request', companyNote: 'Synthetic guidance only.', calendarTarget, segments: visits, createdAt: now, publishedAt: now, emailStatus: 'provider_accepted', receiptReady: true }
      state.revision = 2; state.proposal = proposal; state.proposals = [proposal]
      state.booking = { id: randomUUID(), version: 1, proposalId: proposal.id, proposalHash: proposal.hash, confirmationBasis: 'signed_request', signedSubmissionId: submission.id, status: 'confirmed', emailStatus: 'provider_accepted', error: null, receiptReady: true, confirmedAt: now, events: visits.map((_, segmentIndex) => ({ segmentIndex, eventId: `synthetic-event-${segmentIndex}`, payloadHash: 'd'.repeat(64), etag: 'synthetic-etag', verifiedAt: now })) }
    }
    parseCompanyState({ state }, id)
    parseBookingState({ state: { requestId: id, verified: true, canEdit: false, approval: null, submission, acknowledgment: acknowledgement } }, id)
    liveBookings.set(id, state)
    return request
  })
}
reset()
function json(res, value, status = 200) {
  const payload = JSON.stringify(value), send = () => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json', 'X-ESN-Fixture': 'synthetic', 'Cache-Control': 'private, no-store', Vary: 'Cookie' }); res.end(payload) } }
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
  if (path === '/api/admin/quote-requests' && req.method === 'GET') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase()
    return json(res, page(liveRequests.filter(request => [request.reference, ...Object.values(request.payload.contact)].some(value => typeof value === 'string' && value.toLowerCase().includes(q))), url, 'requests'))
  }
  const liveRoute = path.match(/^\/api\/admin\/quote-requests\/([^/]+)(?:\/(analysis|booking|photos\/([^/]+)|booking\/documents\/receipt))?$/)
  if (liveRoute && req.method === 'GET') {
    const request = liveRequests.find(request => request.id === liveRoute[1])
    if (!request) return json(res, { error: 'Synthetic live request not found.' }, 404)
    if (!liveRoute[2]) return json(res, { request, audit: liveAudits.get(request.id) })
    if (liveRoute[2] === 'analysis') {
      const workspace = structuredClone(liveAnalysis.get(request.id))
      if (flags.liveAnalysisProcessing) {
        for (const job of workspace.jobs) Object.assign(job, { status: 'running', analysis: null, pricing: null, completedAt: null })
        workspace.latest = workspace.jobs.at(-1)
      }
      return json(res, workspace)
    }
    if (liveRoute[2] === 'booking') {
      const submission = liveBookings.get(request.id).submission
      return json(res, { state: { requestId: request.id, verified: true, canEdit: false, approval: null, submission, acknowledgment: submission.snapshot.acknowledgment } })
    }
    if (liveRoute[2] === 'booking/documents/receipt') return binary(res, syntheticPdf(), 'application/pdf')
    if (!liveAnalysis.get(request.id).photos.some(photo => photo.id === liveRoute[3])) return json(res, { error: 'Synthetic private live photo not found.' }, 404)
    return binary(res, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N70AAAAASUVORK5CYII=', 'base64'), 'image/png')
  }
  if (path === '/api/admin/live-bookings' && req.method === 'GET') {
    const id = url.searchParams.get('requestId')
    return json(res, id ? { state: liveBookings.get(id) ?? null } : { states: [...liveBookings.values()] })
  }
  const liveDraft = path.match(/^\/api\/admin\/live-bookings\/([^/]+)\/proposal$/)
  if (liveDraft && req.method === 'PUT') {
    const state = liveBookings.get(liveDraft[1]), value = await body(req)
    if (!state) return json(res, { error: 'Synthetic booking source not found.' }, 404)
    const key = `live-draft:${state.requestId}:${value.idempotencyKey}`, signature = JSON.stringify(value), prior = attempts.get(key)
    if (prior) return json(res, prior.signature === signature ? prior.result : { error: 'Synthetic immutable draft conflict.' }, prior.signature === signature ? 200 : 409)
    if (value.expectedRevision !== state.revision || state.booking) return json(res, { error: 'Synthetic booking draft changed.' }, 409)
    if (!Number.isSafeInteger(value.amountExGst) || value.amountExGst <= 0 || !value.scope?.trim() || !value.adjustmentReason?.trim() || !Array.isArray(value.segments) || !value.segments.length) return json(res, { error: 'Synthetic draft input is incomplete.' }, 400)
    const segments = value.segments.map(segment => segment.kind === 'all_day' ? { ...segment, startAt: `${segment.startDate}T00:00:00+11:00`, endAt: `${segment.endDate}T00:00:00+11:00` } : { ...segment, startAt: `${segment.startLocal}:00+11:00`, endAt: `${segment.endLocal}:00+11:00`, startDate: segment.startLocal.slice(0,10), endDate: segment.endLocal.slice(0,10) })
    const gst = Math.round(value.amountExGst / 10), proposal = { id: randomUUID(), version: state.proposals.length + 1, revision: state.revision + 1, status: 'draft', hash: randomUUID(), currency: 'AUD', amountExGst: value.amountExGst, gst, total: value.amountExGst + gst, scope: value.scope, adjustmentReason: value.adjustmentReason, segments, calendarTarget: state.submission.snapshot.calendarTarget, createdAt: new Date().toISOString(), publishedAt: null, emailStatus: 'pending', receiptReady: false }
    const saved = { ...structuredClone(state), revision: state.revision + 1, proposal, proposals: [...state.proposals, proposal] }
    parseCompanyState({ state: saved }, state.requestId); liveBookings.set(state.requestId, saved)
    const result = { state: saved }; attempts.set(key, { signature, result }); return json(res, result)
  }
  const liveBookingDocument = path.match(/^\/api\/admin\/live-bookings\/([^/]+)\/documents\/(proposal|acceptance|confirmation)$/)
  if (liveBookingDocument && req.method === 'GET') {
    const state = liveBookings.get(liveBookingDocument[1]), kind = liveBookingDocument[2]
    if (!state || !(kind === 'confirmation' ? state.booking?.receiptReady : kind === 'proposal' ? state.proposal?.receiptReady : state.acceptance?.receiptReady)) return json(res, { error: 'Synthetic frozen document is not ready.' }, 404)
    return binary(res, syntheticPdf(), 'application/pdf')
  }
  if (!path.startsWith('/api/admin/customers')) return json(res, { error: `Synthetic fixture route unavailable: ${path}. Nothing was forwarded.` }, 503)
  if (flags.customersUnavailable) return json(res, { error: 'Synthetic customer storage is unavailable. Review migration setup or retry.' }, 503)
  if (path === '/api/admin/customers' && req.method === 'GET') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase(); await new Promise(resolve => setTimeout(resolve, Number(flags.delays[q] ?? 0)))
    if (flags.failNextList) { flags.failNextList = false; return json(res, { error: 'Synthetic customer list refresh failed.' }, 503) }
    const status = url.searchParams.get('status') || 'active'
    const rows = customers.filter(c => (status === 'all' || c.status === status) && [c.name, c.email, c.phone, c.address, ...records.filter(r => links.get(r.sourceId) === c.id).map(r => r.reference)].some(value => value?.toLowerCase().includes(q)))
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
  const r2 = await handleR2(req, res, url)
  if (r2) return
  const match = path.match(/^\/api\/admin\/customers\/([^/]+)(\/links)?$/)
  const c = customers.find(c => c.id === match?.[1])
  if (!c) return json(res, { error: 'Synthetic customer not found.' }, 404)
  if (!match[2]) {
    await new Promise(resolve => setTimeout(resolve, flags.detailDelayMs))
    if (flags.failNextDetail) { flags.failNextDetail = false; return json(res, { error: 'Synthetic customer detail refresh failed.' }, 503) }
    return json(res, { customer: c, properties: properties.filter(p => p.customerId === c.id), records: [...records.filter(r => links.get(r.sourceId) === c.id), ...linkedQuoteRecords(c.id)], audit: audits.get(c.id) ?? [], purchases: { status: 'unavailable' }, billing: { status: 'unavailable' } })
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
  const result = { customer: { ...c } }; attempts.set(key, { signature, result })
  if (flags.loseNextLinkResponse) { flags.loseNextLinkResponse = false; return json(res, { error: 'Synthetic saved classification response was lost. Retry unchanged details.' }, 503) }
  return json(res, result)
}

// R2 is an HTTP/UI fixture, not a substitute for SQL transaction tests.
function candidatesFor(value, omit) {
  const normalize = v => String(v || '').trim().toLowerCase()
  return customers.filter(c => c.id !== omit).map(c => ({ customer: structuredClone(c), matchedBy: ['email','phone','name'].filter(field => normalize(value[field]) && normalize(value[field]) === normalize(c[field])) })).filter(c => c.matchedBy.length)
}
function linkedQuoteRecords(customerId, propertyId) {
  return liveRequests.filter(r => crmRelations.get(r.id)?.customerId === customerId && (!propertyId || crmRelations.get(r.id)?.propertyId === propertyId)).map(r => ({ sourceType: 'quote_request', sourceId: r.id, reference: r.reference, name: r.payload.contact.name, email: r.payload.contact.email, phone: r.payload.contact.phone, address: r.payload.contact.siteAddress, createdAt: r.createdAt, status: r.status, photos: liveAnalysis.get(r.id).photos.map(p => ({ id: p.id, url: p.contentUrl })), relatedEnquiryIds: [], booking: null, links: { detail: `/admin/quotes/${r.id}`, quotePdf: null, agreementPdf: `/api/admin/quote-requests/${r.id}/booking/documents/receipt`, photos: null } }))
}
function propertyKey(value) { return ['line1','unit','suburb','state','postcode','country'].map(k => String(value.address[k] || '').trim().toLowerCase().replace(/\s+/g, ' ')).join('|') }
function saveProperty(customerId, input) {
  const prior = properties.find(p => p.customerId === customerId && propertyKey(p) === propertyKey(input))
  if (prior) return { property: prior, propertyOutcome: 'property_reused' }
  const now = new Date().toISOString(), property = { id: randomUUID(), companyId: 'lk-group', customerId, label: input.label, address: input.address, contactName: input.contactName || null, notes: input.notes || null, status: 'active', archivedAt: null, revision: 1, createdAt: now, updatedAt: now }
  properties.push(property); return { property, propertyOutcome: 'property_created' }
}
function addAudit(c, action, reason, source = null) {
  const audit = { id: randomUUID(), action, sourceType: source?.type || null, sourceId: source?.id || null, reason: reason || 'Synthetic fixture command', actorUserId: actor, createdAt: new Date().toISOString(), revision: c.revision }
  if (!audits.has(c.id)) audits.set(c.id, []); audits.get(c.id).unshift(audit)
}
function immutableReply(res, key, value, result, status = 200) {
  attempts.set(key, { signature: JSON.stringify(value), result: structuredClone(result), status })
  if (flags.loseNextMutationResponse) { flags.loseNextMutationResponse = false; json(res, { error: 'Synthetic saved mutation response was lost. Retry unchanged details.' }, 503) }
  else json(res, result, status)
  return true
}
async function handleR2(req, res, url) {
  const path = url.pathname, root = '/api/admin/customers'
  const quoteRoute = path.match(/^\/api\/admin\/customers\/quote-requests\/([^/]+)$/)
  if (quoteRoute && req.method === 'GET') {
    const request = liveRequests.find(r => r.id === quoteRoute[1]), relation = crmRelations.get(quoteRoute[1])
    if (!request) json(res, { error: 'Synthetic quote not found.' }, 404)
    else json(res, { requestId: request.id, crmRevision: relation?.crmRevision || 0, customer: customers.find(c => c.id === relation?.customerId) || null, property: properties.find(p => p.id === relation?.propertyId) || null })
    return true
  }
  if (path === `${root}/candidates` && req.method === 'POST') { json(res, { candidates: candidatesFor(await body(req)) }); return true }
  if (path === `${root}/resolve` && req.method === 'POST') {
    const value = await body(req), key = `resolve:${value.idempotencyKey}`, prior = attempts.get(key)
    commandAttempts.push({ path, method: req.method, input: structuredClone(value) })
    if (prior) { json(res, prior.signature === JSON.stringify(value) ? prior.result : { error: 'Synthetic immutable command conflict.' }, prior.signature === JSON.stringify(value) ? prior.status : 409); return true }
    if (value.source) {
      const request = liveRequests.find(r => r.id === value.source.id), relation = crmRelations.get(value.source.id)
      if (!request || request.revision !== value.source.expectedSourceRevision || (relation?.crmRevision || 0) !== value.source.expectedCrmRevision) { json(res, { error: 'Synthetic source or CRM relation changed.' }, 409); return true }
    }
    const matches = candidatesFor(value), decision = value.decision || { kind: 'auto' }
    if (matches.length && decision.kind === 'auto') { json(res, { error: 'Review matching clients before saving.', code: 'needs_review', candidates: matches }, 409); return true }
    let c
    if (decision.kind === 'existing') {
      c = customers.find(c => c.id === decision.customerId)
      if (!c || c.revision !== decision.expectedRevision || c.status === 'archived') { json(res, { error: 'Synthetic selected client changed or is archived.' }, 409); return true }
    } else {
      if (matches.length && (!decision.reason?.trim() || !matches.every(({ customer }) => decision.reviewedCandidates?.some(v => v.id === customer.id && v.revision === customer.revision)))) { json(res, { error: 'Review every current candidate.', code: 'needs_review', candidates: matches }, 409); return true }
      c = { ...customer(value.name), email: value.email || null, phone: value.phone || null, address: value.address || null }; customers.unshift(c); addAudit(c, 'create', decision.reason)
    }
    let propertyResult = { property: null, propertyOutcome: null }
    if (value.property) propertyResult = saveProperty(c.id, value.property)
    else if (value.propertyId) propertyResult = { property: properties.find(p => p.id === value.propertyId && p.customerId === c.id) || null, propertyOutcome: 'property_reused' }
    const result = { outcome: decision.kind === 'existing' ? 'client_reused' : 'client_created', customer: c, ...propertyResult }
    if (value.source) {
      const crmRevision = value.source.expectedCrmRevision + 1
      crmRelations.set(value.source.id, { customerId: c.id, propertyId: propertyResult.property?.id || null, crmRevision }); result.crmRevision = crmRevision; addAudit(c, 'resolve', decision.reason, value.source)
    }
    if (flags.loseNextCreateResponse || value.source && flags.loseNextCrmResponse) { flags.loseNextCreateResponse = false; flags.loseNextCrmResponse = false; flags.loseNextMutationResponse = true }
    return immutableReply(res, key, value, result, 200)
  }
  const match = path.match(/^\/api\/admin\/customers\/([^/]+)(?:\/(archive|restore|properties)(?:\/([^/]+)(?:\/(archive|restore))?)?)?$/)
  if (!match || (req.method === 'GET' && !match[2])) return false
  const c = customers.find(c => c.id === match[1])
  if (!c) { json(res, { error: 'Synthetic client not found.' }, 404); return true }
  if (req.method === 'GET' && match[2] === 'properties') { json(res, { properties: properties.filter(p => p.customerId === c.id) }); return true }
  if (!['POST','PATCH'].includes(req.method)) return false
  const value = await body(req), key = `mutation:${path}:${value.idempotencyKey}`, prior = attempts.get(key)
  commandAttempts.push({ path, method: req.method, input: structuredClone(value) })
  if (prior) { json(res, prior.signature === JSON.stringify(value) ? prior.result : { error: 'Synthetic immutable command conflict.' }, prior.signature === JSON.stringify(value) ? prior.status : 409); return true }
  const p = match[2] === 'properties' && match[3] ? properties.find(p => p.id === match[3] && p.customerId === c.id) : null
  if (match[3] && !p) { json(res, { error: 'Synthetic property not found.' }, 404); return true }
  const target = p || c
  if (flags.conflictNextMutation) { flags.conflictNextMutation = false; target.revision++; json(res, { error: 'Synthetic revision conflict. Refresh and compare again.' }, 409); return true }
  if (value.expectedRevision !== target.revision) { json(res, { error: 'Synthetic revision changed.' }, 409); return true }
  if (!value.reason?.trim()) { json(res, { error: 'A reason is required.' }, 400); return true }
  if (match[2] === 'properties' && !p) { const result = saveProperty(c.id, value); c.revision++; addAudit(c, 'property_create', value.reason); return immutableReply(res, key, value, { customer: c, ...result }) }
  const action = match[4] || match[2] || 'update', prefix = p ? 'property_' : ''
  if (action === 'archive' || action === 'restore') { target.status = action === 'archive' ? 'archived' : 'active'; target.archivedAt = action === 'archive' ? new Date().toISOString() : null }
  else if (p) Object.assign(p, { label: value.label, address: value.address, contactName: value.contactName || null, notes: value.notes || null })
  else {
    const matches = candidatesFor(value, c.id)
    if (matches.length && value.decision?.kind !== 'different_person') { json(res, { error: 'Review matching clients.', code: 'needs_review', candidates: matches }, 409); return true }
    Object.assign(c, { name: value.name, email: value.email || null, phone: value.phone || null, address: value.address || null })
  }
  target.revision++; target.updatedAt = new Date().toISOString(); addAudit(c, prefix + (['archive','restore'].includes(action) ? action : 'update'), value.reason)
  return immutableReply(res, key, value, p ? { customer: c, property: p } : { customer: c })
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
      if (value.mutateLiveQuote) {
        const update = typeof value.mutateLiveQuote === 'object' ? value.mutateLiveQuote : {}, request = liveRequests.find(r => r.id === update.requestId) || liveRequests[0]
        request.revision++; request.savedAt = new Date().toISOString(); Object.assign(request.payload.contact, { name: 'Synthetic changed quote contact', email: 'synthetic-changed@example.invalid', siteAddress: 'Synthetic changed quote site', ...(update.contact || {}) })
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
    if (url.pathname === '/__fixture/state') return json(res, { synthetic: true, flags, signedOut, authStage, staffRole, otherSessionCount, customers, properties, crmRelations: [...crmRelations], commandAttempts, records, enquiries, liveRequests, liveAnalysis: [...liveAnalysis.values()], liveBookings: [...liveBookings.values()], bookings: [...bookingDetails.values()], requests, consentAttempts, newQuoteAttempts, quoteWorkspaces: [...quoteWorkspaces], links: [...links], audits: [...audits], attemptCount: attempts.size })
    if (url.pathname.startsWith('/api/')) { res.fixtureApiPath = url.pathname; requests.push({ path: url.pathname, query: url.search, requestId: typeof req.headers['x-lk-quote-request-id'] === 'string' ? req.headers['x-lk-quote-request-id'] : null, method: req.method, at: Date.now() }); return await handleApi(req, res, url) }
    if (!['GET', 'HEAD'].includes(req.method) || !(permittedPage(url.pathname) || url.pathname.startsWith('/_next/static/') || publicAssets.has(url.pathname) || optimizedPublicLogo(url))) return json(res, { error: 'Synthetic fixture only proxies approved admin/quote pages and explicit UI static assets.' }, 404)
    const forwarded = {}
    for (const name of navigationHeaders) if (typeof req.headers[name] === 'string') forwarded[name] = req.headers[name]
    if (forwarded['next-url']) {
      const nextUrl = new URL(forwarded['next-url'], `http://127.0.0.1:${port}`)
      if (!permittedPage(nextUrl.pathname) || ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(nextUrl.origin)) return json(res, { error: 'Fixture rejected an unapproved navigation target.' }, 400)
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
