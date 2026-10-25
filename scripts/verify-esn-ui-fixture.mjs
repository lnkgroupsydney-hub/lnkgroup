// Synthetic loopback UI fixture. Only explicit admin/quote pages and UI static assets
// are proxied. ALL APIs stay local; Cookie/Authorization/Set-Cookie never forward.
import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { parseCustomerAccess } from '../src/modules/quotes/presentation/customer-access-client.ts'
import { parseLiveRequest } from '../src/modules/quotes/presentation/request-client.ts'
import { parsePhotoWorkspace } from '../src/modules/quotes/presentation/photo-workspace-client.ts'
import { parseBookingState } from '../src/modules/quotes/presentation/booking-flow-client.ts'
import { calculatePreviousEstimatePricing } from '../src/modules/quotes/domain/pricing.ts'
import { PHOTO_ROLES } from '../src/modules/quotes/domain/analysis.ts'
import { bookingAcknowledgment } from '../src/modules/quotes/domain/booking-flow.ts'
import { COMPANY_BOOKING_ACK_VERSION, COMPANY_BOOKING_ACK_TEXT } from '../src/modules/bookings/domain/live-contracts.ts'
import { parseCompanyState } from '../src/modules/bookings/presentation/live-booking-client.ts'
import { parseEnquiryList, parseEnquiryDetail, parseEnquiryAssignees, parseWorkReceipt } from '../src/modules/enquiries/presentation/enquiry-management-client.ts'
import { parseStaffQuoteDraft, parseStaffQuoteList } from '../src/modules/quotes/presentation/staff-quote-client.ts'
import { parseSimpleBookingManagement, parseSimpleBookingList, parseCancellation } from '../src/modules/bookings/presentation/simple-booking-client.ts'
import { WorkError, workExact, workId, workMutation, workSearch, workText } from '../src/modules/enquiries/management.ts'
import { COMPANY_REVISION_ACK, companyRevisionSaveInput, companyRevisionMutationInput, companyRevisionAcceptInput, calculateCompanyRevisionPricing, compareCompanyRevision } from '../src/modules/quotes/domain/company-revision.ts'
import { parseCompanyRevisionState } from '../src/modules/quotes/presentation/company-revision-client.ts'
import { staffQuoteSourceIssues } from '../src/modules/quotes/domain/staff-draft.ts'
import { validateStaffQuotePayload } from '../src/modules/quotes/staff-drafts.ts'
import { validateSimpleCompanyRequest } from '../src/modules/bookings/domain/live-validation.ts'
import { simpleDraftInput } from '../src/modules/bookings/simple-management.ts'
import { sydneyLocalToInstant } from '../src/modules/operations/domain/validation.ts'

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
  return detail[1] === 'customers' ? customers.some(customer => customer.id === detail[2]) : liveRequests.some(request => request.id === detail[2]) || detail[1] === 'enquiries' && r3aEnquiries.has(detail[2])
}
const publicAssets = new Set(['/favicon.ico', '/images/lk-group-logo-circle-transparent.png'])
// The quote entry screen also shows its cabinet concept photo; only these local images and widths pass.
const optimizedImageWidths = new Map([
  ['/images/lk-group-logo-circle-transparent.png', ['48', '96', '128', '256']],
  ['/images/home/cabinet-painting.webp', ['640', '750', '828', '1080', '1200', '1920', '2048', '3840']],
])
export function optimizedPublicLogo(url) {
  const query = url.searchParams, widths = optimizedImageWidths.get(query.get('url')) ?? []
  return url.pathname === '/_next/image' && query.size === 3 &&
    query.getAll('url').length === 1 && widths.length > 0 &&
    query.getAll('w').length === 1 && widths.includes(query.get('w')) &&
    query.getAll('q').length === 1 && query.get('q') === '75'
}
const authStages = new Set(['signed_out', 'password_change', 'email_verify', 'mfa_enroll', 'mfa_verify', 'ready'])
const navigationHeaders = ['accept', 'rsc', 'next-router-state-tree', 'next-router-prefetch', 'next-router-segment-prefetch', 'next-url', 'purpose']
let properties, crmRelations, commandAttempts, customers, records, links, audits, attempts, flags, signedOut, otherSessionCount, authStage, staffRole, emailVerification, requests, enquiries, bookingDetails, consentAttempts, quoteWorkspaces, newQuoteAttempts, liveRequests, liveAnalysis, liveBookings, liveAudits
let r3bRevisions, r3bReceipts, r3bProofs, r3bAttempts, r3bOutbox, r3bAuditRows
let r3aEnquiries, r3aAssignees, r3aStaffDrafts, r3aSimpleDrafts, r3aCancellations, r3aBookingStates, r3aReceipts, r3aAttempts, r3aAudits
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
  seedR3aRecords()
  r3bRevisions = new Map(); r3bReceipts = new Map(); r3bProofs = new Map(); r3bAttempts = []; r3bOutbox = []; r3bAuditRows = new Map()
  flags = { connected: false, failures: {}, apiDelays: {}, responseDelays: {}, customerAccessStatus: 0, loginNextStage: 'email_verify', customersUnavailable: false, failNextCreate: false, loseNextCreateResponse: false, failNextList: false, failNextDetail: false, conflictNextLink: false, failNextLink: false, loseNextLinkResponse: false, sessionCleanupFail: false, delays: {}, detailDelayMs: 0, liveAnalysisProcessing: false, conflictNextMutation: false, loseNextMutationResponse: false, loseNextCrmResponse: false, r3aConflictNext: false, r3aLoseNextResponse: false, r3aCancellationMode: 'pending', r3aActorUserId: actor, r3aActorSessionId: '00000000-0000-4000-8000-000000000002', r3bConflictNext: false, r3bLoseNextResponse: false, r3bFailNext: false, r3bCustomerSignedIn: true, r3bCustomerRequestId: liveRequests[1].id, r3bProofExpired: false, r3bLegacyInvalidPhone: false }
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
    const snapshot = { mode: 'live', kind: 'nonbinding_booking_request', version: acknowledgement.version, requestId: id, reference: request.reference, inputRevision: 2, analysisId: job.id, payload: structuredClone(request.payload), verifiedEmail: request.payload.contact.email, analysis, pricing, photos: [{ id: photoId, role: 'overview', contentHash: 'a'.repeat(64), width: 1, height: 1, storedBytes: 68 }], acknowledgment: acknowledgement, calendarTarget, preferredDate, ...(submitted ? { preferredTime } : {}) }
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

function seedR3aRecords() {
  r3aEnquiries = new Map(); r3aStaffDrafts = new Map(); r3aSimpleDrafts = new Map(); r3aCancellations = new Map(); r3aBookingStates = new Map(); r3aReceipts = new Map(); r3aAttempts = []; r3aAudits = []
  r3aAssignees = [{ userId: actor, label: 'Synthetic Owner One' }, { userId: '00000000-0000-4000-8000-000000000003', label: 'Synthetic Admin Two' }]
  parseEnquiryAssignees({ assignees: r3aAssignees })
  for (let index = 0; index < 25; index++) {
    const original = index === 0 ? enquiries[0] : null, id = original?.id ?? randomUUID(), archived = index >= 22, now = new Date(Date.now() - index * 3600000).toISOString()
    const summary = original ? { name: original.name, email: original.email, phone: original.phone ?? '', siteAddress: original.siteAddress ?? '', details: original.notes ?? '' } : { name: index === 1 ? 'Synthetic ' + 'VeryLongEnquiryName'.repeat(6) : `Synthetic Enquiry ${index + 1}`, email: `enquiry${index + 1}@example.invalid`, phone: 'Synthetic phone — not callable', siteAddress: index === 1 ? 'Synthetic ' + 'LongStreetName '.repeat(10) + 'NSW 2000' : 'Synthetic site address, Sydney NSW 2000', details: 'Synthetic enquiry details only.' }
    const row = { enquiry: { id, reference: original?.reference ?? `SYN-ENQ-${String(index + 1).padStart(3, '0')}`, source: original?.source ?? (index % 3 === 0 ? 'gmail' : 'web'), status: original?.status ?? 'submitted', revision: original?.revision ?? 1, createdAt: original?.createdAt ?? now, summary }, management: { enquiryId: id, status: archived ? 'archived' : 'active', revision: archived ? 1 : 0, assigneeUserId: index === 1 ? actor : null, archivedAt: archived ? now : null, updatedAt: null }, notes: [], audit: [], canWrite: true }
    r3aEnquiries.set(id, parseEnquiryDetail(row))
  }
  parseEnquiryList({ enquiries: [...r3aEnquiries.values()].map(({ enquiry, management }) => ({ enquiry, management })), total: 25, page: 1, pageSize: 50 })
  for (const request of liveRequests) parseStaffQuoteDraft({ requestId: request.id, source: request, draft: null, audit: [], canWrite: true })
  parseStaffQuoteList({ requests: liveRequests.map(request => ({ ...request, staffDraft: null, staffDraftRevision: null })), total: liveRequests.length, page: 1, pageSize: 20 })
  for (const id of liveBookings.keys()) parseSimpleBookingManagement(r3aManagement(id))
  parseSimpleBookingList({ states: [...liveBookings.keys()].map(r3aBookingState), canWrite: true })
}
function isR3aPath(path) {
  return path === '/api/admin/quote-requests' || path === '/api/admin/enquiries' || path.startsWith('/api/admin/enquiries/') || /^\/api\/admin\/quote-requests\/[^/]+\/staff-draft(?:\/|$)/.test(path) || /^\/api\/admin\/live-bookings\/[^/]+\/(?:draft|cancel|cancellation|commands)(?:\/|$)/.test(path)
}
function r3aPage(rows, search, key) { return { [key]: rows.slice((search.page - 1) * search.pageSize, search.page * search.pageSize), total: rows.length, page: search.page, pageSize: search.pageSize } }
function r3aFail(res, status, code, error, extra = {}) { if (res.fixtureR3aAttempt) res.fixtureR3aAttempt.outcome = 'not_applied'; return json(res, { error, code, outcome: 'not_applied', ...extra }, status) }
function r3aActor() { try { return { userId: workId(flags.r3aActorUserId), sessionId: workId(flags.r3aActorSessionId) } } catch { throw new WorkError(403, 'forbidden', 'Synthetic current staff identity is unavailable.') } }
function canonical(value) { return JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(item => JSON.parse(canonical(item))) : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])) : value) }
function r3aAudit(kind, id, action, mutation, before, revision, details = {}) {
  const staff = r3aActor(), audit = { id: randomUUID(), entityType: kind, entityId: id, action, actorUserId: staff.userId, actorSessionId: staff.sessionId, reason: mutation.reason, priorRevision: before, revision, details, createdAt: new Date().toISOString() }
  r3aAudits.unshift(audit); return audit
}
function r3aBookingState(id) {
  if (!liveBookings.has(id)) return null
  advanceR3aCancellation(id)
  return { ...structuredClone(r3aBookingStates.get(id) ?? liveBookings.get(id)), simpleDraft: structuredClone(r3aSimpleDrafts.get(id) ?? null), cancellation: structuredClone(r3aCancellations.get(id) ?? null) }
}
function r3aManagement(id) { const state = r3aBookingState(id); return state ? { state, draft: state.simpleDraft, cancellation: state.cancellation, canWrite: true } : null }
function advanceR3aCancellation(id) {
  const current = r3aCancellations.get(id)
  if (!current || current.status === 'cancelled' || !['retrying','review_required','complete'].includes(flags?.r3aCancellationMode)) return
  const cancellation = structuredClone(current), state = structuredClone(r3aBookingStates.get(id)), complete = flags.r3aCancellationMode === 'complete'
  cancellation.status = complete ? 'cancelled' : flags.r3aCancellationMode
  cancellation.errorCode = complete ? null : cancellation.status === 'retrying' ? 'calendar_outcome_unknown' : 'calendar_changed'
  cancellation.verifiedDeletedEvents = complete ? 2 : 1; cancellation.occupancyHeld = !complete
  cancellation.cancelledAt = complete ? new Date().toISOString() : null
  state.booking.status = complete ? 'cancelled' : 'cancel_pending'; state.booking.occupancyHeld = !complete
  state.booking.error = complete ? 'Synthetic cancellation complete; visits released.' : 'Synthetic cancellation incomplete; both visits remain held.'
  if (complete) state.revision++
  parseCancellation(cancellation); parseCompanyState({ state }, id)
  r3aCancellations.set(id, cancellation); r3aBookingStates.set(id, state)
}
function r3aStaffDetail(id) { const source = liveRequests.find(request => request.id === id); return source ? parseStaffQuoteDraft({ requestId: id, source: structuredClone(source), draft: structuredClone(r3aStaffDrafts.get(id) ?? null), audit: r3aAudits.filter(item => item.entityType === 'staff_quote_draft' && item.entityId === id), canWrite: true }) : null }
function r3aRevision(kind, id) { return kind === 'enquiry' ? r3aEnquiries.get(id).management.revision : kind === 'staff_quote_draft' ? r3aStaffDrafts.get(id)?.revision ?? 0 : r3aBookingState(id).revision }
function r3aBump(kind, id) {
  if (kind === 'enquiry') { const row = structuredClone(r3aEnquiries.get(id)); row.management.revision++; row.management.updatedAt = new Date().toISOString(); r3aEnquiries.set(id, row); return }
  if (kind === 'staff_quote_draft') {
    const source = liveRequests.find(request => request.id === id), prior = r3aStaffDrafts.get(id), now = new Date().toISOString()
    const contact = Object.fromEntries(Object.entries(source.payload.contact).filter(([key]) => key !== 'consent')); contact.phone = ''
    const payload = prior?.payload ?? validateStaffQuotePayload({ contact, service: source.payload.service, internalNotes: 'Synthetic concurrent staff edit.' })
    const draft = { requestId: id, revision: (prior?.revision ?? 0) + 1, status: 'draft', sourceRevisionAtCreation: prior?.sourceRevisionAtCreation ?? source.revision, payload, createdBy: prior?.createdBy ?? actor, updatedBy: actor, createdAt: prior?.createdAt ?? now, updatedAt: now }
    parseStaffQuoteDraft({ requestId: id, source, draft, audit: [], canWrite: true }); r3aStaffDrafts.set(id, draft); return
  }
  const state = r3aBookingState(id); state.revision++
  if (!state.booking) r3aSimpleDrafts.set(id, { requestId: id, submissionId: state.submission.id, signedSnapshotHash: state.submission.signedContentHash, revision: state.revision, savedBy: actor, savedAt: new Date().toISOString(), takeOffEndLocal: null, installStartLocal: null, installEndLocal: null, companyNote: 'Synthetic concurrent draft.' })
  r3aBookingStates.set(id, state)
}
function r3aReceipt(req, res, kind, id, key, retry = false) {
  workId(key); const staff = r3aActor(), prior = r3aReceipts.get(`${kind}:${id}:${key}`)
  if (!prior || prior.actorUserId !== staff.userId || prior.actorSessionId !== staff.sessionId || retry && prior.receipt.action !== 'booking_cancel') return r3aFail(res, 404, 'not_found', 'Synthetic command not found.')
  const progress = kind === 'simple_booking' && prior.receipt.action === 'booking_cancel' ? r3aManagement(id).cancellation : null
  if (req.fixtureR3aAttempt) Object.assign(req.fixtureR3aAttempt, { outcome: 'committed', replay: true })
  return json(res, { receipt: structuredClone(prior.receipt), ...(!retry && progress ? { progress } : {}) }, retry ? 202 : 200)
}
function r3aMutation(req, res, kind, id, action, value, apply, status = 200) {
  const staff = r3aActor(), key = `${kind}:${id}:${value.idempotencyKey}`, signature = createHash('sha256').update(canonical({ path: req.url.split('?')[0], action, value })).digest('hex'), prior = r3aReceipts.get(key)
  if (prior) {
    if (prior.signature !== signature || prior.actorUserId !== staff.userId || prior.actorSessionId !== staff.sessionId) return r3aFail(res, 409, 'idempotency_conflict', 'Synthetic key belongs to different details or staff session.')
    if (req.fixtureR3aAttempt) Object.assign(req.fixtureR3aAttempt, { outcome: 'committed', replay: true })
    return json(res, { receipt: structuredClone(prior.receipt) }, prior.status)
  }
  if (flags.r3aConflictNext) { flags.r3aConflictNext = false; r3aBump(kind, id); return r3aFail(res, 409, 'revision_conflict', 'Synthetic change by another staff member. Reload and compare.', { currentRevision: r3aRevision(kind, id) }) }
  if (value.expectedRevision !== r3aRevision(kind, id)) return r3aFail(res, 409, 'revision_conflict', 'Synthetic aggregate revision changed.', { currentRevision: r3aRevision(kind, id) })
  const result = apply(), receipt = parseWorkReceipt({ idempotencyKey: value.idempotencyKey, entityType: kind, entityId: id, action, revision: result.revision, committedAt: new Date().toISOString(), ...(result.childId ? { childId: result.childId } : {}) }, value.idempotencyKey, req.url.split('?')[0])
  r3aReceipts.set(key, { receipt: structuredClone(receipt), status, actorUserId: staff.userId, actorSessionId: staff.sessionId, signature })
  if (req.fixtureR3aAttempt) Object.assign(req.fixtureR3aAttempt, { outcome: 'committed', replay: false })
  if (flags.r3aLoseNextResponse) { flags.r3aLoseNextResponse = false; return json(res, { error: 'Synthetic response lost after commit. Check or retry unchanged details.', code: 'outcome_unknown', outcome: 'unknown' }, 503) }
  return json(res, { receipt }, status)
}
async function handleR3a(req, res, url) {
  const path = url.pathname
  if (!isR3aPath(path)) return false
  try {
    r3aActor()
    if (path === '/api/admin/quote-requests' && req.method === 'GET') {
      const search = workSearch(url.searchParams, ['all','draft','review_requested'], 'all'), saved = url.searchParams.get('staffDraft') ?? 'all'
      if (!['all','saved','none'].includes(saved)) throw new WorkError(422, 'validation', 'Invalid synthetic staff draft filter.')
      const rows = liveRequests.filter(request => (search.status === 'all' || request.status === search.status) && (saved === 'all' || r3aStaffDrafts.has(request.id) === (saved === 'saved')) && [request.reference, request.payload.contact.name, request.payload.contact.email, request.payload.contact.siteAddress].some(value => value.toLowerCase().includes(search.q.toLowerCase()))).map(request => ({ ...structuredClone(request), staffDraft: structuredClone(r3aStaffDrafts.get(request.id) ?? null), staffDraftRevision: r3aStaffDrafts.get(request.id)?.revision ?? null })).sort((a,b)=>b.savedAt.localeCompare(a.savedAt)||a.id.localeCompare(b.id))
      json(res, parseStaffQuoteList(r3aPage(rows, search, 'requests'))); return true
    }
    if (path === '/api/admin/enquiries' && req.method === 'GET') {
      const search = workSearch(url.searchParams, ['active','archived','all'], 'active')
      const rows = [...r3aEnquiries.values()].filter(row => (search.status === 'all' || row.management.status === search.status) && [row.enquiry.reference, ...Object.values(row.enquiry.summary)].some(value => value.toLowerCase().includes(search.q.toLowerCase()))).sort((a,b)=>b.enquiry.createdAt.localeCompare(a.enquiry.createdAt)||a.enquiry.id.localeCompare(b.enquiry.id)).map(({ enquiry, management }) => ({ enquiry, management }))
      json(res, parseEnquiryList(r3aPage(rows, search, 'enquiries'))); return true
    }
    if (path === '/api/admin/enquiries/assignees' && req.method === 'GET') { json(res, parseEnquiryAssignees({ assignees: r3aAssignees })); return true }
    const enq = path.match(/^\/api\/admin\/enquiries\/([^/]+)(?:\/(notes|archive|restore|commands)(?:\/([^/]+))?)?$/)
    if (enq) {
      const id = workId(enq[1]), row = r3aEnquiries.get(id), sub = enq[2], child = enq[3]
      if (!row) { r3aFail(res, 404, 'not_found', 'Synthetic enquiry not found.'); return true }
      if (!sub && req.method === 'GET') { json(res, parseEnquiryDetail(structuredClone(row))); return true }
      if (sub === 'commands' && req.method === 'GET') { r3aReceipt(req, res, 'enquiry', id, child); return true }
      const raw = req.fixtureR3aInput ?? await body(req), extra = !sub ? ['assigneeUserId'] : sub === 'notes' ? ['body'] : []
      workExact(raw, ['expectedRevision','idempotencyKey','reason',...extra]); const value = { ...workMutation(raw), ...(!sub ? { assigneeUserId: raw.assigneeUserId === null ? null : workId(raw.assigneeUserId) } : sub === 'notes' ? { body: workText(raw.body, 3000) } : {}) }
      const action = !sub ? 'enquiry_assign' : sub === 'notes' ? child ? 'enquiry_note_update' : 'enquiry_note_add' : `enquiry_${sub}`
      if (!(!sub && req.method === 'PATCH' || sub === 'notes' && ((!child && req.method === 'POST') || child && req.method === 'PATCH') || ['archive','restore'].includes(sub) && req.method === 'POST')) throw new WorkError(422, 'validation', 'Unsupported synthetic enquiry action.')
      r3aMutation(req, res, 'enquiry', id, action, value, () => {
        const copy = structuredClone(row), before = copy.management.revision
        if (sub === 'restore' ? copy.management.status !== 'archived' : copy.management.status !== 'active') throw new WorkError(409, 'state_conflict', 'Synthetic enquiry status does not allow this action.')
        let childId
        if (!sub) { if (value.assigneeUserId !== null && !r3aAssignees.some(person => person.userId === value.assigneeUserId)) throw new WorkError(422, 'validation', 'Choose a current synthetic admin.'); copy.management.assigneeUserId = value.assigneeUserId }
        else if (sub === 'notes') {
          const now = new Date().toISOString(), staff = r3aActor()
          if (child) { const note = copy.notes.find(note => note.id === workId(child)); if (!note) throw new WorkError(404, 'not_found', 'Synthetic note belongs to another enquiry.'); Object.assign(note, { body: value.body, updatedBy: staff.userId, updatedAt: now }); childId = note.id }
          else { childId = randomUUID(); copy.notes.push({ id: childId, enquiryId: id, body: value.body, createdBy: staff.userId, updatedBy: staff.userId, createdAt: now, updatedAt: now }) }
        } else { copy.management.status = sub === 'archive' ? 'archived' : 'active'; copy.management.archivedAt = sub === 'archive' ? new Date().toISOString() : null }
        copy.management.revision++; copy.management.updatedAt = new Date().toISOString(); copy.audit.unshift(r3aAudit('enquiry', id, action, value, before, copy.management.revision, { ...(childId ? { noteId: childId } : {}) })); parseEnquiryDetail(copy); r3aEnquiries.set(id, copy)
        return { revision: copy.management.revision, childId }
      }, sub === 'notes' && !child ? 201 : 200); return true
    }
    const quote = path.match(/^\/api\/admin\/quote-requests\/([^/]+)\/staff-draft(?:\/commands\/([^/]+))?$/)
    if (quote) {
      const id = workId(quote[1]), detail = r3aStaffDetail(id)
      if (!detail) throw new WorkError(404, 'not_found', 'Synthetic quote source not found.')
      if (quote[2] && req.method === 'GET') { r3aReceipt(req, res, 'staff_quote_draft', id, quote[2]); return true }
      if (req.method === 'GET') { json(res, detail); return true }
      if (req.method !== 'PUT' || quote[2]) throw new WorkError(422, 'validation', 'Unsupported synthetic staff draft action.')
      const raw = req.fixtureR3aInput ?? await body(req); workExact(raw, ['expectedRevision','idempotencyKey','reason','payload']); const value = { ...workMutation(raw), payload: validateStaffQuotePayload(raw.payload, detail.source.payload) }
      r3aMutation(req, res, 'staff_quote_draft', id, 'quote_save', value, () => {
        const prior = r3aStaffDrafts.get(id), now = new Date().toISOString(), staff = r3aActor(), revision = (prior?.revision ?? 0) + 1
        const draft = { requestId: id, revision, status: 'draft', sourceRevisionAtCreation: prior?.sourceRevisionAtCreation ?? detail.source.revision, payload: value.payload, createdBy: prior?.createdBy ?? staff.userId, updatedBy: staff.userId, createdAt: prior?.createdAt ?? now, updatedAt: now }
        parseStaffQuoteDraft({ ...detail, draft }); r3aStaffDrafts.set(id, draft); r3aAudit('staff_quote_draft', id, 'quote_save', value, revision - 1, revision); return { revision }
      }); return true
    }
    const booking = path.match(/^\/api\/admin\/live-bookings\/([^/]+)\/(draft|cancel|cancel\/retry|cancellation|commands\/([^/]+))$/)
    if (booking) {
      const id = workId(booking[1]), state = r3aBookingState(id), sub = booking[2]
      if (!state) throw new WorkError(404, 'not_found', 'Synthetic signed booking source not found.')
      if (sub === 'draft' && req.method === 'GET') { json(res, parseSimpleBookingManagement(r3aManagement(id))); return true }
      if (sub === 'cancellation' && req.method === 'GET') { json(res, { cancellation: parseCancellation(state.cancellation), revision: state.revision }); return true }
      if (booking[3] && req.method === 'GET') { r3aReceipt(req, res, 'simple_booking', id, booking[3]); return true }
      const raw = req.fixtureR3aInput ?? await body(req)
      if (sub === 'cancel/retry' && req.method === 'POST') { workExact(raw, ['idempotencyKey']); r3aReceipt(req, res, 'simple_booking', id, workId(raw.idempotencyKey), true); return true }
      if (sub === 'draft' && req.method === 'PUT') {
        const value = simpleDraftInput(raw, sydneyLocalToInstant)
        r3aMutation(req, res, 'simple_booking', id, 'booking_save', value, () => {
          if (state.booking || state.submission.snapshot.version !== 'live-booking-request-ack-v2') throw new WorkError(409, 'state_conflict', 'Synthetic request is not an editable simple booking.')
          const first = Date.parse(sydneyLocalToInstant(`${state.submission.preferredDate}T${state.submission.preferredTime}`)), end = value.takeOffEndLocal === null ? null : Date.parse(sydneyLocalToInstant(value.takeOffEndLocal)), install = value.installStartLocal === null ? null : Date.parse(sydneyLocalToInstant(value.installStartLocal))
          if (end !== null && (end <= first || end - first > 90 * 86400000) || install !== null && install < (end ?? first)) throw new WorkError(422, 'validation', 'Synthetic take-off end must follow the signed start.')
          const revision = state.revision + 1, draft = { requestId: id, submissionId: state.submission.id, signedSnapshotHash: state.submission.signedContentHash, revision, savedBy: r3aActor().userId, savedAt: new Date().toISOString(), takeOffEndLocal: value.takeOffEndLocal, installStartLocal: value.installStartLocal, installEndLocal: value.installEndLocal, companyNote: value.companyNote }
          const next = { ...state, revision, simpleDraft: draft }; parseSimpleBookingManagement({ state: next, draft, cancellation: state.cancellation, canWrite: true }); r3aSimpleDrafts.set(id, draft); r3aBookingStates.set(id, next); r3aAudit('simple_booking', id, 'booking_save', value, revision - 1, revision); return { revision }
        }); return true
      }
      if (sub === 'cancel' && req.method === 'POST') {
        workExact(raw, ['expectedRevision','idempotencyKey','reason']); const value = workMutation(raw)
        r3aMutation(req, res, 'simple_booking', id, 'booking_cancel', value, () => {
          if (state.cancellation || state.booking?.status !== 'confirmed' || !['signed_request','accepted_revision'].includes(state.booking.confirmationBasis) || state.booking.emailStatus !== 'provider_accepted' || state.booking.events.length !== 2 || state.booking.events.some(event => !event.etag || !event.verifiedAt)) throw new WorkError(409, 'booking_busy', 'Synthetic booking is not fully ready for cancellation.')
          const cancellation = parseCancellation({ id: randomUUID(), requestId: id, bookingId: state.booking.id, status: 'pending', requestedAt: new Date().toISOString(), requestedBy: r3aActor().userId, cancelledAt: null, errorCode: null, occupancyHeld: true, totalEvents: 2, verifiedDeletedEvents: 0 }), next = structuredClone(state)
          next.revision++; Object.assign(next.booking, { status: 'cancel_pending', occupancyHeld: true, error: 'Synthetic cancellation pending; both visits remain held.' }); next.cancellation = cancellation
          parseSimpleBookingManagement({ state: next, draft: next.simpleDraft, cancellation, canWrite: true }); r3aCancellations.set(id, cancellation); r3aBookingStates.set(id, next); r3aAudit('simple_booking', id, 'booking_cancel', value, state.revision, next.revision, { cancellationId: cancellation.id }); return { revision: next.revision, childId: cancellation.id }
        }, 202); return true
      }
    }
    r3aFail(res, 404, 'not_found', 'Synthetic R3a route not found.'); return true
  } catch (error) {
    if (req.fixtureR3aAttempt) req.fixtureR3aAttempt.outcome = 'not_applied'
    if (error instanceof WorkError) { r3aFail(res, error.status, error.code, error.message, error.fields ? { fields: error.fields } : {}); return true }
    throw error
  }
}


function r3bAuditSummary(revision) {
  if (!revision) return null
  return { revisionId: revision.id, versionNo: revision.versionNo, revision: revision.revision, status: revision.status, quantities: structuredClone(revision.payload.quantities), totalCents: revision.totalCents, pricingVersion: revision.pricing.pricingVersion, baseSubmissionId: revision.baseSubmissionId, baseSnapshotHash: revision.baseSnapshotHash, baseSignedContentHash: revision.baseSignedContentHash, basedOnRevisionId: revision.basedOnRevisionId, snapshotHash: revision.snapshotHash, payloadHash: createHash('sha256').update(canonical(revision.payload)).digest('hex'), acceptanceId: revision.acceptance?.id || null, signedContentHash: revision.acceptance?.signedContentHash || null }
}
function r3bState(id, customer = false) {
  const source = liveRequests.find(row => row.id === id), booking = r3aBookingState(id)
  if (!source || !booking) throw new WorkError(404, 'not_found', 'Synthetic signed request not found.')
  const all = r3bRevisions.get(id) || [], visible = customer ? all.filter(row => row.status !== 'draft') : all
  const effective = [...all].reverse().find(row => row.status === 'accepted') || null, current = visible.at(-1) || null
  const contact = Object.fromEntries(Object.entries(source.payload.contact).filter(([key]) => key !== 'consent'))
  const original = booking.submission.snapshot, originalComparison = compareCompanyRevision(original, { contact, quantities: { doorCount: 1, drawerCount: 0, moderateRepair: false }, extraItems: [], customerNote: '' })
  const eligible = original.version === 'live-booking-request-ack-v2' && !booking.booking && !booking.cancellation
  const state = { requestId: id, revision: Math.max(0, ...all.map(row => row.revision)), current: structuredClone(current), effectiveAccepted: structuredClone(effective), acknowledgment: COMPANY_REVISION_ACK, ...(customer ? {} : { eligible, eligibilityCode: eligible ? null : booking.booking ? 'booking_confirmed' : 'revision_not_eligible', initialPayload: structuredClone(effective?.payload || { contact, quantities: originalComparison.original.quantities, extraItems: [], customerNote: '' }), sourceIssues: staffQuoteSourceIssues(source.payload), revisions: structuredClone(all), audit: structuredClone(r3bAuditRows.get(id) || []), canWrite: eligible }) }
  return parseCompanyRevisionState(state)
}
async function handleR3b(req, res, url) {
  const confirmation = url.pathname.match(/^\/api\/admin\/live-bookings\/([^/]+)\/confirm-request$/)
  if (confirmation) {
    try {
      r3aActor(); const id = workId(confirmation[1]), state = r3aBookingState(id)
      if (!state) throw new WorkError(404, 'not_found', 'Synthetic signed booking not found.')
      if (req.method !== 'POST') throw new WorkError(422, 'validation', 'Use POST for confirmation.')
      const raw = await body(req, 32768), fingerprint = canonical(raw), receiptKey = `r3b-confirm:${id}:${raw.idempotencyKey}`, replay = attempts.get(receiptKey)
      if (replay) { if (replay.signature !== fingerprint) throw new WorkError(409, 'idempotency_conflict', 'Synthetic confirmation key changed.'); json(res, replay.result, 202); return true }
      const value = validateSimpleCompanyRequest(raw, state.submission, sydneyLocalToInstant), revisions = r3bState(id)
      if (revisions.current?.status === 'published') throw new WorkError(409, 'revision_awaiting_customer', 'The published revision requires customer acceptance before booking confirmation.')
      if (state.booking || state.cancellation || value.expectedRevision !== state.revision) throw new WorkError(409, 'revision_conflict', 'Synthetic booking changed.')
      const accepted = revisions.effectiveAccepted, now = new Date().toISOString(), original = state.submission, pricing = accepted?.pricing || original.snapshot.pricing
      const period = (purpose, startLocal, endLocal) => ({ purpose, kind: 'timed', startLocal, endLocal, startAt: sydneyLocalToInstant(startLocal), endAt: sydneyLocalToInstant(endLocal), startDate: startLocal.slice(0, 10), endDate: endLocal.slice(0, 10) })
      const evidence = accepted ? { companyRevisionId: accepted.id, companyRevisionSnapshotHash: accepted.snapshotHash, companyRevisionAcceptanceId: accepted.acceptance.id, companyRevisionSignedContentHash: accepted.acceptance.signedContentHash } : {}
      const proposal = { id: randomUUID(), version: state.proposals.length + 1, revision: state.revision + 1, status: 'published', hash: createHash('sha256').update(fingerprint).digest('hex'), amountExGst: pricing.subtotal, gst: pricing.tax, total: pricing.total, currency: 'AUD', confirmationBasis: accepted ? 'accepted_revision' : 'signed_request', companyNote: value.companyNote, scope: accepted?.payload.customerNote || 'Synthetic cabinet painting', adjustmentReason: accepted ? 'Explicitly accepted company revision.' : '', calendarTarget: original.snapshot.calendarTarget, createdAt: now, publishedAt: now, emailStatus: 'provider_accepted', receiptReady: true, segments: [period('take_off', `${original.preferredDate}T${original.preferredTime}`, value.takeOffEndLocal), period('install', value.installStartLocal, value.installEndLocal)], ...(accepted ? { ...accepted.payload, pricing: accepted.pricing, ...evidence, companyRevisionSignature: accepted.acceptance.signature, companyRevisionAcknowledgment: COMPANY_REVISION_ACK } : {}) }
      const booking = { id: randomUUID(), proposalId: proposal.id, proposalHash: proposal.hash, version: 1, status: 'confirmed', confirmationBasis: proposal.confirmationBasis, signedSubmissionId: original.id, emailStatus: 'provider_accepted', receiptReady: true, error: null, confirmedAt: now, events: proposal.segments.map((_, segmentIndex) => ({ segmentIndex, eventId: `synthetic-revision-${segmentIndex}`, payloadHash: 'd'.repeat(64), etag: 'synthetic-etag', verifiedAt: now })), ...evidence }
      const next = { ...state, revision: state.revision + 1, proposal, proposals: [...state.proposals, proposal], acceptance: null, booking }; parseCompanyState({ state: next }, id); r3aBookingStates.set(id, next); liveBookings.set(id, next)
      const result = { state: next }; attempts.set(receiptKey, { signature: fingerprint, result: structuredClone(result) }); json(res, result, 202); return true
    } catch (error) { if (error instanceof WorkError) { json(res, { error: error.message, code: error.code, outcome: error.outcome }, error.status); return true } throw error }
  }
  const admin = url.pathname.match(/^\/api\/admin\/quote-requests\/([^/]+)\/company-revisions(?:\/(history|publish|withdraw|commands\/([^/]+)))?$/)
  const customer = url.pathname.match(/^\/api\/quote\/requests\/company-revision(?:\/(review|accept|commands\/([^/]+)))?$/)
  if (!admin && !customer) return false
  try {
    const actorScope = admin ? r3aActor() : null
    if (customer && (!flags.r3bCustomerSignedIn || [401, 403].includes(flags.customerAccessStatus))) throw new WorkError(flags.customerAccessStatus === 403 ? 403 : 401, 'unauthorized', 'Synthetic customer email OTP is required.')
    const id = workId(admin ? admin[1] : String(req.headers['x-lk-quote-request-id'] || flags.r3bCustomerRequestId))
    if (customer && (id !== flags.r3bCustomerRequestId || id !== liveRequests[1].id)) throw new WorkError(403, 'forbidden', 'Synthetic customer has no access to this saved request.')
    const action = admin ? admin[2] : customer[1], key = admin ? admin[3] : customer[2], state = r3bState(id, !!customer), source = liveRequests.find(row => row.id === id), scope = admin ? `${actorScope.userId}:${actorScope.sessionId}` : `customer:${id}`
    if (req.method === 'GET') {
      if (key) { const saved = r3bReceipts.get(`${id}:${workId(key)}`); if (!saved || saved.scope !== scope) throw new WorkError(404, 'not_found', 'Synthetic revision command not found.'); json(res, structuredClone(saved.result)); return true }
      if (action && action !== 'history') throw new WorkError(422, 'validation', 'Unsupported fixture read.')
      json(res, state); return true
    }
    if (!['POST', 'PUT'].includes(req.method)) throw new WorkError(422, 'validation', 'Unsupported fixture command.')
    const raw = await body(req, customer && action === 'accept' ? 180000 : 32768)
    if (customer && action === 'review') {
      workExact(raw, ['revisionId', 'snapshotHash']); const revision = state.current
      if (!revision || revision.status !== 'published' || revision.id !== raw.revisionId || revision.snapshotHash !== raw.snapshotHash) throw new WorkError(409, 'revision_snapshot_changed', 'Review the latest synthetic revised quote.')
      const reviewProof = randomUUID(), expiresAt = new Date(Date.now() + (flags.r3bProofExpired ? -1000 : 900000)).toISOString()
      r3bProofs.set(reviewProof, { requestId: id, revisionId: revision.id, snapshotHash: revision.snapshotHash, expiresAt })
      json(res, { review: { state, revision, snapshot: revision.snapshot, snapshotHash: revision.snapshotHash, reviewProof, expiresAt } }); return true
    }
    const value = admin ? !action ? companyRevisionSaveInput(raw, source.payload) : companyRevisionMutationInput(raw) : companyRevisionAcceptInput(raw)
    const fingerprint = canonical({ action: action || 'save', value }), receiptKey = `${id}:${value.idempotencyKey}`, saved = r3bReceipts.get(receiptKey)
    const attempt = { requestId: id, action: action || 'save', input: structuredClone(value), scope, at: new Date().toISOString(), outcome: 'received', replay: false }; r3bAttempts.push(attempt)
    if (saved) { if (saved.scope !== scope || saved.fingerprint !== fingerprint) throw new WorkError(409, 'idempotency_conflict', 'The synthetic key belongs to different input.'); Object.assign(attempt, { outcome: 'committed', replay: true }); json(res, structuredClone(saved.result)); return true }
    if (admin && !state.eligible || customer && r3aBookingState(id).booking) throw new WorkError(409, 'booking_confirmed', 'A confirmed booking cannot acquire a company revision.')
    if (flags.r3bFailNext) { flags.r3bFailNext = false; attempt.outcome = 'not_applied'; throw new WorkError(503, 'unavailable', 'Synthetic revision failure before commit.') }
    if (flags.r3bConflictNext) { flags.r3bConflictNext = false; if (state.current) r3bRevisions.get(id).at(-1).revision++; attempt.outcome = 'not_applied'; throw new WorkError(409, 'revision_conflict', 'Synthetic concurrent revision changed.', 'not_applied', state.revision + 1) }
    if (value.expectedRevision !== state.revision) throw new WorkError(409, 'revision_conflict', 'Reload the latest synthetic company revision.', 'not_applied', state.revision)
    const all = structuredClone(r3bRevisions.get(id) || []), now = new Date().toISOString(), original = r3aBookingState(id).submission
    let current = all.at(-1)
    const priorSummary = r3bAuditSummary(admin && !action && current?.status !== 'draft' ? null : current)
    if (admin && !action) {
      if (req.method !== 'PUT' || current?.status === 'published') throw new WorkError(409, 'revision_awaiting_customer', 'Withdraw the published revision before editing.')
      if (current?.status !== 'draft') { current = { id: randomUUID(), requestId: id, versionNo: (current?.versionNo || 0) + 1, revision: state.revision, status: 'draft', baseSubmissionId: original.id, baseSnapshotHash: original.snapshotHash, baseSignedContentHash: original.signedContentHash, basedOnRevisionId: state.effectiveAccepted?.id || null, snapshot: null, snapshotHash: null, publishedAt: null, acceptedAt: null, withdrawnAt: null, acceptance: null, emailStatus: null, receiptReady: false }; all.push(current) }
      current.payload = value.payload; current.pricing = calculateCompanyRevisionPricing(value.payload); current.totalCents = current.pricing.total; current.comparison = compareCompanyRevision(original.snapshot, value.payload)
    } else {
      if (!current || current.id !== value.revisionId) throw new WorkError(409, 'revision_snapshot_changed', 'The current synthetic revised quote changed.')
      if (admin && action === 'publish') {
        if (current.status !== 'draft') throw new WorkError(409, 'state_conflict', 'Only a draft can be published.')
        companyRevisionSaveInput({ expectedRevision: value.expectedRevision, idempotencyKey: value.idempotencyKey, reason: value.reason, payload: current.payload })
        current.snapshot = { schemaVersion: 'company-quote-revision-v1', companyId: 'lk-group', requestId: id, revisionId: current.id, versionNo: current.versionNo, baseSubmissionId: current.baseSubmissionId, baseSnapshotHash: current.baseSnapshotHash, baseSignedContentHash: current.baseSignedContentHash, basedOnRevisionId: current.basedOnRevisionId, contact: current.payload.contact, quantities: current.payload.quantities, extraItems: current.payload.extraItems, customerNote: current.payload.customerNote, pricing: current.pricing, comparison: current.comparison, acknowledgment: COMPANY_REVISION_ACK, termsVersion: null }; current.snapshotHash = createHash('sha256').update(canonical(current.snapshot)).digest('hex'); current.status = 'published'; current.publishedAt = now; current.emailStatus = 'pending'; current.receiptReady = true
        r3bOutbox.push({ revisionId: current.id, kind: 'revision_notice', recipientEmail: original.snapshot.verifiedEmail, count: 1, synthetic: true, emailStatus: 'pending', emailFirstAttemptAt: null, errorCode: null, providerMessageId: null })
      } else if (admin && action === 'withdraw') {
        if (current.status !== 'published') throw new WorkError(409, 'state_conflict', 'Only a published pending revision can be withdrawn.'); current.status = 'withdrawn'; current.withdrawnAt = now
        // Match the DB: cancel only notices which have never registered a send attempt.
        for (const notice of r3bOutbox) if (notice.revisionId === current.id && notice.kind === 'revision_notice' && notice.emailFirstAttemptAt === null && notice.emailStatus !== 'provider_accepted') {
          notice.emailStatus = 'cancelled'; notice.errorCode = 'revision_withdrawn'
        }
        current.emailStatus = r3bOutbox.find(row => row.revisionId === current.id && row.kind === 'revision_notice')?.emailStatus || null
      } else if (customer && action === 'accept') {
        const proof = r3bProofs.get(value.reviewProof)
        if (!proof || proof.requestId !== id || proof.revisionId !== current.id || proof.snapshotHash !== current.snapshotHash || Date.parse(proof.expiresAt) <= Date.now()) throw new WorkError(409, 'review_proof_expired', 'Review the current synthetic quote again.')
        if (current.status !== 'published') throw new WorkError(409, 'revision_snapshot_changed', 'This revision is no longer awaiting acceptance.')
        const signedContentHash = createHash('sha256').update(canonical({ revisionSnapshot: current.snapshot, signature: value.signature, ack: COMPANY_REVISION_ACK })).digest('hex')
        for (const prior of all) if (prior.status === 'accepted') prior.status = 'superseded'
        current.status = 'accepted'; current.acceptedAt = now; current.acceptance = { id: randomUUID(), revisionId: current.id, snapshotHash: current.snapshotHash, signature: value.signature, acknowledgment: COMPANY_REVISION_ACK, signedContentHash, acceptedAt: now }; current.emailStatus = 'pending'; current.receiptReady = true
        r3bOutbox.push({ revisionId: current.id, kind: 'revision_acceptance_receipt', recipientEmail: original.snapshot.verifiedEmail, count: 1, synthetic: true, emailStatus: 'pending', emailFirstAttemptAt: null, errorCode: null, providerMessageId: null })
      } else throw new WorkError(422, 'validation', 'Unsupported synthetic revision action.')
    }
    current.revision = state.revision + 1; r3bRevisions.set(id, all); attempt.outcome = 'committed'
    const audit = { id: randomUUID(), action: customer ? 'customer_accept' : `revision_${action || 'save'}`, actorUserId: actorScope?.userId || '00000000-0000-4000-8000-000000000004', actorSessionId: actorScope?.sessionId || '00000000-0000-4000-8000-000000000005', reason: customer ? 'Customer explicitly accepted revised booking-request quote.' : value.reason, priorRevision: state.revision, newRevision: current.revision, details: { prior: priorSummary, new: r3bAuditSummary(current) }, createdAt: now }
    r3bAuditRows.set(id, [...(r3bAuditRows.get(id) || []), Object.freeze(structuredClone(audit))])
    const receipt = { idempotencyKey: value.idempotencyKey, entityType: 'company_revision', entityId: id, action: customer ? 'customer_accept' : `revision_${action || 'save'}`, revision: current.revision, committedAt: now, childId: current.id }, result = { [customer ? 'state' : 'detail']: r3bState(id, !!customer), receipt: parseWorkReceipt(receipt) }
    r3bReceipts.set(receiptKey, { scope, fingerprint, result: structuredClone(result) })
    if (flags.r3bLoseNextResponse) { flags.r3bLoseNextResponse = false; json(res, { error: 'Synthetic committed response was lost. Retry the unchanged request.', code: 'outcome_unknown', outcome: 'unknown' }, 503); return true }
    json(res, result); return true
  } catch (error) { if (error instanceof WorkError) { json(res, { error: error.message, code: error.code, outcome: error.outcome, ...(error.fields ? { fields: error.fields } : {}), ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }) }, error.status); return true } throw error }
}

reset()
function json(res, value, status = 200) {
  const payload = JSON.stringify(value), send = () => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json', 'X-ESN-Fixture': 'synthetic', 'Cache-Control': 'private, no-store', Vary: 'Cookie' }); res.end(payload) } }
  const delay = Math.max(0, Math.min(30000, Number(flags.responseDelays[res.fixtureApiPath]) || 0))
  // Capture the successful response now, then deliver it even if synthetic auth
  // is lost while waiting. This exercises the client's stale-response guard.
  if (delay) setTimeout(send, delay); else send()
}
async function body(req, max = 8192) {
  let value = ''; for await (const chunk of req) { value += chunk; if (max === 8192 ? value.length > max : Buffer.byteLength(value) > max) { if (max === 8192) throw new Error('Fixture input too large'); throw new WorkError(413, 'request_too_large', 'Fixture input too large') } }
  return value ? JSON.parse(value) : {}
}
function page(rows, url, key) {
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1)), pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get('pageSize') ?? 10)))
  return { [key]: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: rows.length }
}
// These are the real /quote/start live-flow responses; API requests never reach upstream.
async function handleLiveCustomer(req, res, url) {
  const path = url.pathname
  if (!path.startsWith('/api/quote/requests') || path.startsWith('/api/quote/requests/company-revision')) return false
  try {
    if (!flags.r3bCustomerSignedIn || [401, 403].includes(flags.customerAccessStatus)) throw new WorkError(flags.customerAccessStatus === 403 ? 403 : 401, 'unauthorized', 'Synthetic customer email OTP is required.')
    // A selected request is not an authorization grant to another synthetic customer's request.
    const allowedId = liveRequests[1].id, id = flags.r3bCustomerRequestId, headerId = req.headers['x-lk-quote-request-id']
    if (id !== allowedId || headerId !== undefined && headerId !== id) throw new WorkError(403, 'forbidden', 'Synthetic customer has no access to this saved request.')
    const source = liveRequests.find(row => row.id === id)
    if (!source) throw new WorkError(404, 'not_found', 'Synthetic saved request not found.')
    if (path === '/api/quote/requests/session' && req.method === 'POST') { workExact(await body(req), []); json(res, { ready: true }); return true }
    if (path === '/api/quote/requests' && req.method === 'GET') { json(res, { request: parseLiveRequest(structuredClone(source)) }); return true }
    const access = () => parseCustomerAccess({ customer: { email: source.payload.contact.email, expiresAt: new Date(Date.now() + 3600000).toISOString() }, requests: [{ id: source.id, reference: source.reference, status: source.status, savedAt: source.savedAt, revision: source.revision }], currentRequestId: id })
    if (path === '/api/quote/requests/customer' && req.method === 'GET') { json(res, access()); return true }
    if (path === '/api/quote/requests/customer/select' && req.method === 'POST') {
      const value = await body(req); workExact(value, ['requestId']); workId(value.requestId)
      if (value.requestId !== allowedId) throw new WorkError(403, 'forbidden', 'Synthetic customer has no access to this saved request.')
      flags.r3bCustomerRequestId = value.requestId; json(res, access()); return true
    }
    if (path === '/api/quote/requests/analysis' && req.method === 'GET') {
      const workspace = structuredClone(liveAnalysis.get(id)); workspace.request = structuredClone(source)
      workspace.photos = workspace.photos.map(photo => ({ ...photo, contentUrl: `/api/quote/requests/photos/${photo.id}/content` }))
      json(res, parsePhotoWorkspace(workspace, id)); return true
    }
    const state = r3aBookingState(id)
    if (path === '/api/quote/requests/booking' && req.method === 'GET') {
      json(res, { state: parseBookingState({ state: { requestId: id, verified: true, canEdit: false, approval: null, submission: state.submission, acknowledgment: state.submission.snapshot.acknowledgment } }, id) }); return true
    }
    if (path === '/api/quote/requests/company-booking' && req.method === 'GET') {
      const customerState = structuredClone(state); delete customerState.simpleDraft; delete customerState.cancellation; delete customerState.canWrite
      if (customerState.booking) customerState.booking.events = []
      json(res, { state: parseCompanyState({ state: customerState }, id) }); return true
    }
    const photo = path.match(/^\/api\/quote\/requests\/photos\/([^/]+)\/content$/)
    if (photo && req.method === 'GET') {
      if (!liveAnalysis.get(id).photos.some(row => row.id === photo[1])) throw new WorkError(404, 'not_found', 'Synthetic private photo not found.')
      binary(res, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N70AAAAASUVORK5CYII=', 'base64'), 'image/png'); return true
    }
    if (req.method === 'GET' && (path === '/api/quote/requests/booking/documents/receipt' || /^\/api\/quote\/requests\/company-booking\/documents\/(proposal|acceptance|confirmation)$/.test(path))) {
      const kind = path.split('/').at(-1)
      if (kind === 'confirmation' && !state.booking?.receiptReady || kind === 'proposal' && !state.proposal?.receiptReady || kind === 'acceptance' && !state.acceptance?.receiptReady) throw new WorkError(404, 'not_found', 'Synthetic frozen document not found.')
      binary(res, syntheticPdf(), 'application/pdf'); return true
    }
    throw new WorkError(503, 'unavailable', 'Synthetic live customer endpoint is unavailable. Nothing was forwarded.')
  } catch (error) {
    if (!(error instanceof WorkError)) throw error
    json(res, { error: error.message, code: error.code, outcome: error.outcome }, error.status); return true
  }
}
function applyR3bControls(value) {
  for (const name of Object.keys(flags)) if (name in value) flags[name] = value[name]
  if ('r3bLegacyInvalidPhone' in value) { const source = liveRequests.find(row => row.id === flags.r3bCustomerRequestId); if (source) source.payload.contact.phone = value.r3bLegacyInvalidPhone ? 'Legacy invalid phone' : '0400 000 000' }
  // A synthetic failed first attempt, with no provider or network call. Used to verify
  // that withdrawal preserves attempted-mail evidence rather than cancelling it.
  if (value.r3bAttemptRevisionNotice) {
    const notice = r3bOutbox.find(row => row.revisionId === value.r3bAttemptRevisionNotice && row.kind === 'revision_notice')
    const revision = [...r3bRevisions.values()].flat().find(row => row.id === value.r3bAttemptRevisionNotice)
    if (!notice || revision?.status !== 'published' || notice.emailStatus !== 'pending' || notice.emailFirstAttemptAt !== null) throw new Error('Synthetic notice must be published and unattempted.')
    Object.assign(notice, { emailStatus: 'retrying', emailFirstAttemptAt: new Date().toISOString(), errorCode: 'email_outcome_unknown' })
    revision.emailStatus = notice.emailStatus
  }
  if (value.r3bExpireProofs) for (const proof of r3bProofs.values()) proof.expiresAt = new Date(Date.now() - 1000).toISOString()
}
async function handleApi(req, res, url) {
  const path = url.pathname
  if (isR3aPath(path) && ['POST','PUT','PATCH'].includes(req.method)) {
    req.fixtureR3aInput = await body(req, 32768)
    req.fixtureR3aAttempt = { path, method: req.method, input: structuredClone(req.fixtureR3aInput), actorUserId: flags.r3aActorUserId, actorSessionId: flags.r3aActorSessionId, at: Date.now(), outcome: 'received' }
    res.fixtureR3aAttempt = req.fixtureR3aAttempt
    r3aAttempts.push(req.fixtureR3aAttempt)
  }
  if (path === '/api/quote/booking/consent' && req.method === 'POST') { req.fixtureConsent = await body(req); consentAttempts.push(structuredClone(req.fixtureConsent)) }
  if (path === '/api/quote/draft/session/new' && req.method === 'POST') { req.fixtureNewQuote = await body(req); newQuoteAttempts.push(structuredClone(req.fixtureNewQuote)) }
  await sleep(flags.apiDelays[path])
  const injected = flags.failures[path]
  if (injected) {
    const status = Number(typeof injected === 'object' ? injected.status : injected)
    if (typeof injected === 'object' && injected.once) delete flags.failures[path]
    const failure = { error: `Synthetic HTTP ${status} failure. No company request occurred.` }
    if (typeof injected === 'object') for (const key of ['error','code','outcome','fields','currentRevision']) if (Object.hasOwn(injected, key)) failure[key] = injected[key]
    if (req.fixtureR3aAttempt) req.fixtureR3aAttempt.outcome = failure.outcome === 'not_applied' ? 'not_applied' : 'unknown'
    return json(res, failure, status >= 400 && status <= 599 ? status : 503)
  }
  if (await handleLiveCustomer(req, res, url)) return
  if (await handleR3b(req, res, url)) return
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
  if (await handleR3a(req, res, url)) return
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
    return json(res, id ? { state: r3aBookingState(id) } : parseSimpleBookingList({ states: [...liveBookings.keys()].map(r3aBookingState), canWrite: true }))
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
const normalizedAddressText = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
function normalizedStreet(value) {
  const suffixes = { st: 'street', rd: 'road', ave: 'avenue', dr: 'drive', ct: 'court', ln: 'lane', pl: 'place', cres: 'crescent', tce: 'terrace', pde: 'parade', hwy: 'highway' }
  return normalizedAddressText(value).replace(/\s+(st|rd|ave|dr|ct|ln|pl|cres|tce|pde|hwy)\.?$/, (_, suffix) => ` ${suffixes[suffix]}`)
}
function propertyKey(value) { return ['line1','unit','suburb','state','postcode','country'].map(k => k === 'line1' ? normalizedStreet(value.address[k]) : normalizedAddressText(value.address[k] || (k === 'country' ? 'AU' : ''))).join('|') }
function weakPropertyParts(address) {
  let street = normalizedAddressText(address.line1), unit = normalizedAddressText(address.unit) || null
  const inline = street.match(/^(?:unit|apartment|apt|flat|#)\s*([a-z0-9-]+)(?:\s*[,/]\s*|\s+)([0-9].*)$/) || street.match(/^([a-z0-9-]+)\/([0-9].*)$/)
  const conflicting = Boolean(inline && unit && unit !== inline[1])
  if (inline) { street = inline[2]; unit ||= inline[1] }
  return { street: normalizedStreet(street), unit, conflicting, postcode: String(address.postcode || '').trim() }
}
function propertyCandidates(customerId, input) {
  const proposed = weakPropertyParts(input.address)
  return properties.filter(p => {
    if (p.customerId !== customerId || propertyKey(p) === propertyKey(input)) return false
    const previous = weakPropertyParts(p.address)
    return previous.street === proposed.street && previous.postcode === proposed.postcode && (!previous.unit || !proposed.unit || previous.unit === proposed.unit || previous.conflicting || proposed.conflicting)
  }).sort((a, b) => a.id.localeCompare(b.id))
}
function reviewedPropertiesMatch(matches, decision) {
  if (decision?.kind !== 'different_property' || typeof decision.reason !== 'string' || !decision.reason.trim() || decision.reason.trim().length > 500 || /[\u0000-\u001f\u007f]/.test(decision.reason) || !Array.isArray(decision.reviewedProperties)) return false
  const reviewed = decision.reviewedProperties
  if (!reviewed.every(p => p && typeof p === 'object' && !Array.isArray(p) && typeof p.id === 'string' && Number.isSafeInteger(p.revision) && p.revision > 0)) return false
  return reviewed.length === matches.length && new Set(reviewed.map(p => p.id)).size === reviewed.length && matches.every(p => reviewed.some(item => item.id === p.id && item.revision === p.revision))
}
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
    const request = value.source && liveRequests.find(r => r.id === value.source.id), relation = value.source && crmRelations.get(value.source.id)
    if (value.source && (!request || request.revision !== value.source.expectedSourceRevision)) { json(res, { error: 'Synthetic source changed.', code: 'conflict' }, 409); return true }
    const matches = candidatesFor(value), decision = value.decision || { kind: 'auto' }
    if (relation?.customerId && (decision.kind === 'different_person' || decision.kind === 'existing' && decision.customerId !== relation.customerId)) { json(res, { error: 'Synthetic quote already belongs to another client.', code: 'conflict' }, 409); return true }
    if (!relation?.customerId && matches.length && decision.kind === 'auto') { json(res, { error: 'Review matching clients before saving.', code: 'needs_review', candidates: matches }, 409); return true }
    let c, created = false
    if (relation?.customerId) c = customers.find(c => c.id === relation.customerId)
    else if (decision.kind === 'existing') {
      c = customers.find(c => c.id === decision.customerId)
    } else {
      if (matches.length && (!decision.reason?.trim() || decision.reviewedCandidates?.length !== matches.length || !matches.every(({ customer }) => decision.reviewedCandidates?.some(v => v.id === customer.id && v.revision === customer.revision)))) { json(res, { error: 'Review every current candidate.', code: 'needs_review', candidates: matches }, 409); return true }
      c = { ...customer(value.name), email: value.email || null, phone: value.phone || null, address: value.address || null }; created = true
    }
    if (!c || decision.kind === 'existing' && c.revision !== decision.expectedRevision || c.status === 'archived') { json(res, { error: 'Synthetic selected client changed or is archived.', code: 'conflict' }, 409); return true }
    if (value.property && value.propertyId) { json(res, { error: 'Select or create one property.', code: 'validation' }, 400); return true }
    let propertyResult = { property: null, propertyOutcome: null }
    let newProperty = false
    if (value.propertyId) {
      const property = properties.find(p => p.id === value.propertyId && p.customerId === c.id)
      if (!property) { json(res, { error: 'Synthetic property not found for client.', code: 'notfound' }, 404); return true }
      if (value.expectedPropertyRevision !== property.revision || property.status !== 'active') { json(res, { error: 'Property changed. Refresh and compare again.', code: 'conflict' }, 409); return true }
      propertyResult = { property, propertyOutcome: 'property_reused' }
    } else if (value.property) {
      const property = properties.find(p => p.customerId === c.id && propertyKey(p) === propertyKey(value.property))
      if (property?.status === 'archived') { json(res, { error: 'Restore the matching property before linking.', code: 'conflict' }, 409); return true }
      if (property) propertyResult = { property, propertyOutcome: 'property_reused' }
      else {
        const matches = propertyCandidates(c.id, value.property)
        if (matches.length && !reviewedPropertiesMatch(matches, value.propertyDecision)) { json(res, { error: 'Review matching properties before saving.', code: 'needs_property_review', properties: matches }, 409); return true }
        newProperty = true
      }
    } else if (relation?.propertyId) propertyResult = { property: properties.find(p => p.id === relation.propertyId) || null, propertyOutcome: 'property_reused' }
    if (relation?.propertyId && (newProperty || propertyResult.property && propertyResult.property.id !== relation.propertyId)) { json(res, { error: 'Synthetic quote already belongs to another property.', code: 'conflict' }, 409); return true }
    const relationChanged = Boolean(value.source && (relation?.customerId !== c.id || newProperty || (propertyResult.property && relation?.propertyId !== propertyResult.property.id)))
    if (relationChanged && (relation?.crmRevision || 0) !== value.source.expectedCrmRevision) { json(res, { error: 'Synthetic CRM relation changed.', code: 'conflict' }, 409); return true }
    // Commit only after every possible review/conflict; rejected requests leave no partial client/property/audit.
    if (created) { customers.unshift(c); addAudit(c, 'create', decision.reason) }
    if (newProperty) propertyResult = saveProperty(c.id, value.property)
    if (!created && (newProperty || relationChanged)) { c.revision++; c.updatedAt = new Date().toISOString() }
    const result = { outcome: created ? 'client_created' : 'client_reused', customer: c, ...propertyResult }
    if (value.source) {
      const crmRevision = (relation?.crmRevision || 0) + (relationChanged ? 1 : 0)
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
      applyR3bControls(value)
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
      if (value.seedQuotePropertyReview) {
        const c = customers[1]
        for (const unit of ['1', '2']) saveProperty(c.id, { label: `Synthetic review unit ${unit}`, address: { line1: '10 Synthetic Review Street', unit, suburb: 'Synthetic suburb', state: 'NSW', postcode: '2000', country: 'AU' } })
      }
      if (value.mutateProperty) {
        const update = value.mutateProperty, p = properties.find(p => p.id === update.propertyId)
        if (!p) return json(res, { error: 'Synthetic property control requires an existing property.' }, 400)
        p.address = { ...p.address, ...(update.address || {}) }; p.revision++; p.updatedAt = new Date().toISOString()
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
    if (url.pathname === '/__fixture/state') return json(res, { synthetic: true, flags, signedOut, authStage, staffRole, otherSessionCount, customers, properties, crmRelations: [...crmRelations], commandAttempts, records, enquiries, liveRequests, liveAnalysis: [...liveAnalysis.values()], liveBookings: [...liveBookings.values()], bookings: [...bookingDetails.values()], requests, consentAttempts, newQuoteAttempts, quoteWorkspaces: [...quoteWorkspaces], links: [...links], audits: [...audits], attemptCount: attempts.size, r3aEnquiries: [...r3aEnquiries.values()], r3aAssignees, r3aStaffDrafts: [...r3aStaffDrafts.values()], r3aSimpleDrafts: [...r3aSimpleDrafts.values()], r3aCancellations: [...r3aCancellations.values()], r3aBookingStates: [...liveBookings.keys()].map(r3aBookingState), r3aReceipts: [...r3aReceipts.values()], r3aAttempts, r3aAudits, r3bRevisions: [...r3bRevisions], r3bReceipts: [...r3bReceipts], r3bAttempts, r3bOutbox })
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
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) server.listen(port, '127.0.0.1', () => process.stdout.write(`Synthetic ESN UI fixture: http://127.0.0.1:${port}/admin\nControls: POST /__fixture/control · state: GET /__fixture/state\n`))

// The test harness invokes the same route handler without opening a network listener.
export function companyRevisionFixtureHarness() {
  reset()
  const requestId = flags.r3bCustomerRequestId
  return { requestId, control: applyR3bControls, outbox: () => structuredClone(r3bOutbox),
    state: () => structuredClone({ liveRequests, liveAnalysis: [...liveAnalysis], liveBookings: [...liveBookings], r3bAttempts, r3bReceipts: [...r3bReceipts], r3bRevisions: [...r3bRevisions] }),
    async dispatch(method, path, value, customerRequestId = requestId) {
      let status = 0, result
      const req = { method, headers: { 'x-lk-quote-request-id': customerRequestId }, async *[Symbol.asyncIterator]() { if (value !== undefined) yield JSON.stringify(value) } }
      const res = { destroyed: false, writeHead(code) { status = code }, end(body) { result = JSON.parse(body) } }
      await handleApi(req, res, new URL(path, 'http://127.0.0.1'))
      return { status, body: result }
    }
  }
}
