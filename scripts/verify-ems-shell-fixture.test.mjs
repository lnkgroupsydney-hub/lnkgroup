import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { once } from 'node:events'
import { setTimeout as pause } from 'node:timers/promises'
import { test } from 'node:test'

test('synthetic fixture preserves navigation and isolates every API and credential', async () => {
  const forwarded = []
  const upstream = http.createServer((req, res) => {
    forwarded.push({ path: req.url, method: req.method, headers: req.headers })
    res.writeHead(200, { 'content-type': req.headers.rsc ? 'text/x-component' : 'text/html', 'set-cookie': 'company-cookie=must-not-leave-upstream', vary: 'RSC, Next-Router-State-Tree' })
    res.end(req.headers.rsc ? 'synthetic-rsc-payload' : '<html><body>synthetic upstream only</body></html>')
  })
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening')
  const reservation = http.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening')
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve))
  const fixture = spawn(process.execPath, ['scripts/verify-esn-ui-fixture.mjs'], { cwd: process.cwd(), env: { PATH: process.env.PATH, EMS_FIXTURE_PORT: String(port), EMS_FIXTURE_UPSTREAM: `http://127.0.0.1:${upstream.address().port}` }, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''; fixture.stdout.on('data', chunk => { output += chunk }); fixture.stderr.on('data', chunk => { output += chunk })
  const base = `http://127.0.0.1:${port}`
  async function control(value) { return fetch(`${base}/__fixture/control`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }) }
  try {
    for (let attempt = 0; attempt < 100 && !output.includes('Synthetic ESN UI fixture:'); attempt++) { if (fixture.exitCode !== null) throw new Error(output); await pause(20) }
    assert.match(output, /Synthetic ESN UI fixture:/)
    const credentials = { cookie: 'private-company-cookie=secret', authorization: 'Bearer secret', 'x-company-secret': 'secret' }
    const html = await fetch(`${base}/admin/customers`, { headers: credentials })
    assert.equal(html.status, 200); assert.equal(html.headers.get('set-cookie'), null)
    const rsc = await fetch(`${base}/admin/schedule?_rsc=synthetic`, { headers: { ...credentials, rsc: '1', accept: 'text/x-component', 'next-router-state-tree': '%5B%22%22%5D', 'next-router-prefetch': '1', 'next-router-segment-prefetch': '/_tree', 'next-url': '/admin/customers' } })
    assert.equal(rsc.headers.get('content-type'), 'text/x-component'); assert.equal(await rsc.text(), 'synthetic-rsc-payload')
    assert.match(rsc.headers.get('vary'), /RSC/)
    assert.equal(forwarded[1].headers.rsc, '1'); assert.equal(forwarded[1].headers['next-router-state-tree'], '%5B%22%22%5D')
    assert.equal(forwarded[1].headers['next-router-prefetch'], '1'); assert.equal(forwarded[1].headers['next-url'], '/admin/customers')
    assert.equal((await fetch(`${base}/images/lk-group-logo.png`, { headers: credentials })).status, 200)
    for (const width of [96, 128, 256]) {
      const path = `/_next/image?url=%2Fimages%2Flk-group-logo.png&w=${width}&q=75`
      const logo = await fetch(base + path, { headers: credentials })
      assert.equal(logo.status, 200); assert.equal(logo.headers.get('set-cookie'), null)
      assert.equal(forwarded.at(-1).path, path)
    }
    for (const entry of forwarded) { assert.equal(entry.headers.cookie, undefined); assert.equal(entry.headers.authorization, undefined); assert.equal(entry.headers['x-company-secret'], undefined) }
    const count = forwarded.length
    for (const path of [
      '/api/unknown', '/api/google/callback', '/admin/not-approved', '/admin/customers/id',
      '/_next/image?url=https://example.invalid/private&w=128&q=75',
      '/_next/image?url=http://127.0.0.1:3002/images/lk-group-logo.png&w=128&q=75',
      '/_next/image?url=%2Fapi%2Fquote%2Fbooking&w=128&q=75',
      '/_next/image?url=%2Fimages%2Fother.png&w=128&q=75',
      '/_next/image?url=%2Fimages%2Flk-group-logo.png&url=%2Fapi%2Fquote%2Fbooking&w=128&q=75',
      '/_next/image?url=%2Fimages%2Flk-group-logo.png&w=128&q=75&extra=1',
      '/_next/image?url=%2Fimages%2Flk-group-logo.png&w=4096&q=75',
      '/_next/image?url=%2Fimages%2Flk-group-logo.png&w=128&q=100',
    ]) assert.ok((await fetch(base + path, { headers: credentials })).status >= 400)
    assert.equal((await fetch(`${base}/admin/settings`, { method: 'POST', headers: credentials })).status, 404)
    assert.equal((await fetch(`${base}/admin`, { headers: { 'next-url': 'https://example.invalid/admin' } })).status, 400)
    assert.equal(forwarded.length, count, 'unknown endpoints and unsupported methods must never forward')
    await control({ authStage: 'email_verify' })
    assert.equal((await fetch(`${base}/api/admin/customers`)).status, 403)
    await control({ authStage: 'ready', staffRole: 'admin' })
    assert.equal((await fetch(`${base}/api/operations/calendars`)).status, 403)
    await control({ staffRole: 'owner', connected: true })
    assert.equal((await fetch(`${base}/api/operations/calendars`)).status, 200)
    await control({ failures: { '/api/operations': { status: 401, once: true } } })
    assert.equal((await fetch(`${base}/api/operations`)).status, 401)
    assert.equal((await fetch(`${base}/api/operations`)).status, 200)
    const state = await (await fetch(`${base}/__fixture/state`)).json(), booking = state.bookings[0]
    const detail = await (await fetch(`${base}/api/operations/bookings/${booking.submission.id}`)).json()
    assert.equal(detail.detail.submission.snapshot.payload.contact.name, 'Synthetic Source Contact 1')
    const pdf = await fetch(`${base}/api/operations/bookings/${booking.submission.id}/documents/quote`)
    assert.equal(pdf.headers.get('content-type'), 'application/pdf'); assert.match(await pdf.text(), /SYNTHETIC FIXTURE/)
    const photo = await fetch(`${base}/api/operations/bookings/${booking.submission.id}/photos/${state.records[0].photos[0].id}`)
    assert.equal(photo.headers.get('content-type'), 'image/png')
    await control({ responseDelays: { '/api/operations': 100 } })
    const slowResponse = fetch(`${base}/api/operations`)
    await pause(20); await control({ signedOut: true })
    assert.equal((await slowResponse).status, 200, 'fixture can deliver a captured pre-logout response after access ends')
    assert.equal((await fetch(`${base}/api/operations/bookings`)).status, 401)
    assert.equal(forwarded.length, count, 'synthetic auth, operation, document and photo APIs stay local')
    await control({ reset: true, customerPhotoCount: 2, newCustomerProposal: true })
    const quotePage = await fetch(`${base}/quote/start`, { headers: credentials })
    assert.equal(quotePage.status, 200); assert.equal(quotePage.headers.get('set-cookie'), null)
    assert.equal(forwarded.length, count + 1)
    assert.equal(forwarded.at(-1).headers.cookie, undefined); assert.equal(forwarded.at(-1).headers.authorization, undefined)
    assert.deepEqual(await (await fetch(`${base}/api/quote/draft/session`, { method: 'POST' })).json(), { ready: true })
    const draft = await (await fetch(`${base}/api/quote/draft`)).json(), demo = await (await fetch(`${base}/api/quote/demo`)).json()
    assert.equal(draft.draft.payload.contact.consent, true); assert.equal(draft.draft.payload.service.serviceId, 'cabinet-painting')
    assert.equal(demo.submission.id, draft.draft.id); assert.equal(demo.enabled, true)
    const original = (await (await fetch(`${base}/api/quote/booking`)).json()).detail, proposal = original.proposals[0]
    assert.equal(proposal.snapshot.submission.photos.length, 2)
    for (const photo of proposal.snapshot.submission.photos) assert.equal((await fetch(`${base}/api/quote/photos/${photo.photoId}/content`)).headers.get('content-type'), 'image/png')
    assert.equal((await fetch(`${base}/api/quote/photos/unowned/content`)).status, 404)
    const consent = { proposalId: proposal.id, snapshotHash: proposal.snapshotHash, idempotencyKey: 'synthetic-customer-consent-key', signature: { name: 'Synthetic Customer', acknowledged: true, strokes: [[{ x: .1, y: .2 }, { x: .3, y: .4 }, { x: .5, y: .3 }, { x: .7, y: .6 }]] } }
    const postConsent = () => fetch(`${base}/api/quote/booking/consent`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(consent) })
    await control({ failures: { '/api/quote/booking/consent': { status: 503, once: true } } })
    assert.equal((await postConsent()).status, 503)
    assert.equal((await (await fetch(`${base}/api/quote/booking`)).json()).detail.proposals[0].signature, null)
    const consentResult = await (await postConsent()).json()
    assert.equal(consentResult.detail.proposals[0].signature.name, consent.signature.name)
    assert.equal(consentResult.detail.proposals[0].emailStatus, 'pending')
    const retryResult = await (await postConsent()).json()
    assert.equal(retryResult.detail.booking.revision, consentResult.detail.booking.revision, 'retry reuses the immutable command result')
    await control({ customerEmailAccepted: true })
    const emailResult = await (await fetch(`${base}/api/quote/booking`)).json()
    assert.equal(emailResult.detail.booking.revision, consentResult.detail.booking.revision)
    assert.equal(emailResult.detail.proposals[0].emailStatus, 'provider_accepted', 'fixture supports a newer worker state at the same booking revision')
    await control({ confirmCustomerProposal: true })
    const confirmedResult = await (await fetch(`${base}/api/quote/booking`)).json()
    assert.equal(confirmedResult.detail.booking.status, 'confirmed'); assert.equal(confirmedResult.detail.booking.syncStatus, 'synced')
    const customerState = await (await fetch(`${base}/__fixture/state`)).json()
    assert.equal(customerState.attemptCount, 1); assert.deepEqual(customerState.consentAttempts, [consent, consent, consent])
    for (const status of [401, 403]) {
      await control({ customerAccessStatus: status })
      assert.equal((await fetch(`${base}/api/quote/booking`)).status, status); assert.equal((await postConsent()).status, status)
      assert.equal((await fetch(`${base}/api/quote/booking/documents/quote`)).status, status)
      assert.equal((await fetch(`${base}/api/quote/photos/${proposal.snapshot.submission.photos[0].photoId}/content`)).status, status)
    }
    await control({ customerAccessStatus: 0, responseDelays: { '/api/quote/booking': 100 } })
    const delayedCustomerRead = fetch(`${base}/api/quote/booking`)
    await pause(20); await control({ customerAccessStatus: 401, responseDelays: {} })
    assert.equal((await delayedCustomerRead).status, 200, 'captured customer reads can arrive after access loss')
    assert.equal((await fetch(`${base}/api/quote/booking`)).status, 401)
    await control({ reset: true, customerPhotoCount: 2, newCustomerProposal: true, responseDelays: { '/api/quote/booking/consent': 100 } })
    const beforeDelay = (await (await fetch(`${base}/api/quote/booking`)).json()).detail
    Object.assign(consent, { proposalId: beforeDelay.proposals[0].id, snapshotHash: beforeDelay.proposals[0].snapshotHash })
    const delayedConsent = postConsent()
    await pause(20); await control({ newCustomerProposal: true })
    const newerProposal = (await (await fetch(`${base}/api/quote/booking`)).json()).detail
    assert.equal(newerProposal.proposals.length, 2)
    const oldConsent = await (await delayedConsent).json()
    assert.equal(oldConsent.detail.proposals.length, 1, 'fixture can deliver an old consent after a revised proposal is available')
    await control({ reset: true, customerLegacyV1: true, newCustomerProposal: true })
    const legacy = (await (await fetch(`${base}/api/quote/booking`)).json()).detail.proposals[0]
    assert.equal(legacy.snapshot.submission.version, 'kcp-demo-v1'); assert.equal(legacy.snapshot.submission.photos, undefined)
    const originalDraft = await (await fetch(`${base}/api/quote/draft`)).json()
    const nextId = '10000000-0000-4000-8000-000000000001'
    const startQuote = () => fetch(`${base}/api/quote/draft/session/new`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nextId }) })
    await control({ failures: { '/api/quote/draft/session/new': { status: 503, once: true } } })
    assert.equal((await startQuote()).status, 503)
    assert.equal((await (await startQuote()).json()).href, `/quote/start?service=cabinet-painting&quote=${nextId}`)
    assert.deepEqual(await (await fetch(`${base}/api/quote/draft?quote=${nextId}`)).json(), { draft: null })
    assert.equal((await (await fetch(`${base}/api/quote/demo?quote=${nextId}`)).json()).submission, null)
    const saveDraft = await fetch(`${base}/api/quote/draft?quote=${nextId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: 0, payload: originalDraft.draft.payload }) })
    assert.equal(saveDraft.status, 200)
    const savedDraft = await saveDraft.json()
    assert.notEqual(savedDraft.draft.id, originalDraft.draft.id)
    assert.deepEqual(await (await fetch(`${base}/api/quote/draft`)).json(), originalDraft)
    assert.equal((await startQuote()).status, 200)
    assert.deepEqual(await (await fetch(`${base}/api/quote/draft?quote=${nextId}`)).json(), savedDraft)
    assert.equal((await fetch(`${base}/api/quote/draft?quote=unknown`)).status, 401)
    const newQuoteState = await (await fetch(`${base}/__fixture/state`)).json()
    assert.deepEqual(newQuoteState.newQuoteAttempts, [{ nextId }, { nextId }, { nextId }])
    assert.equal(newQuoteState.quoteWorkspaces.length, 1)
    assert.equal((await fetch(`${base}/api/quote/not-approved`)).status, 503)
    assert.equal(forwarded.length, count + 1, 'all customer APIs, documents and photo content stay local')
    await control({ reset: true })
    const liveState = await (await fetch(`${base}/__fixture/state`)).json()
    assert.equal(liveState.liveRequests.length, 3); assert.equal(liveState.liveBookings.length, 3)
    const upstreamCount = forwarded.length
    const liveId = liveState.liveRequests[0].id, customerId = liveState.customers[0].id
    for (const path of [`/admin/customers/${customerId}`, ...['quotes','enquiries','schedule'].map(section => `/admin/${section}/${liveId}`)]) {
      const response = await fetch(base + path, { headers: { ...credentials, 'next-url': `/admin/quotes/${liveId}` } })
      assert.equal(response.status, 200); assert.equal(response.headers.get('set-cookie'), null)
      assert.equal(forwarded.at(-1).headers.cookie, undefined); assert.equal(forwarded.at(-1).headers.authorization, undefined)
    }
    const detailPageCount = forwarded.length
    assert.equal(detailPageCount, upstreamCount + 4)
    const unknownId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    for (const section of ['customers','quotes','enquiries','schedule']) assert.equal((await fetch(`${base}/admin/${section}/${unknownId}`)).status, 404)
    assert.equal((await fetch(`${base}/admin/quotes/${liveId}`, { headers: { 'next-url': `/admin/quotes/${unknownId}` } })).status, 400)
    for (const request of liveState.liveRequests) {
      const detail = await (await fetch(`${base}/api/admin/quote-requests/${request.id}`)).json()
      assert.equal(detail.request.id, request.id); assert.equal(detail.audit[0].actorType, 'guest')
      const analysis = await (await fetch(`${base}/api/admin/quote-requests/${request.id}/analysis`)).json()
      assert.equal(analysis.latest.pricing.total, 242000); assert.equal(analysis.latest.analysis.estimateScope.extent, 'whole_project')
      const photo = await fetch(base + analysis.photos[0].contentUrl)
      assert.equal(photo.headers.get('content-type'), 'image/png')
      const booking = await (await fetch(`${base}/api/admin/quote-requests/${request.id}/booking`)).json()
      assert.equal(booking.state.submission.requestId, request.id)
      const company = await (await fetch(`${base}/api/admin/live-bookings?requestId=${request.id}`)).json()
      assert.equal(company.state.requestId, request.id)
    }
    const draftInput = { expectedRevision: 0, idempotencyKey: 'synthetic-draft-replay', amountExGst: 250000, scope: 'Synthetic test scope', adjustmentReason: 'Synthetic test adjustment', segments: [{ kind: 'all_day', startDate: '2026-11-11', endDate: '2026-11-13' }] }
    const saveCompany = () => fetch(`${base}/api/admin/live-bookings/${liveId}/proposal`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draftInput) })
    const firstCompany = await (await saveCompany()).json(), retryCompany = await (await saveCompany()).json()
    assert.equal(firstCompany.state.revision, 1); assert.equal(firstCompany.state.proposal.total, 275000); assert.deepEqual(retryCompany, firstCompany)
    await control({ loseNextLinkResponse: true })
    const linkInput = { idempotencyKey: 'synthetic-link-replay', expectedRevision: 1, action: 'link', sourceType: liveState.records[0].sourceType, sourceId: liveState.records[0].sourceId, reason: 'Synthetic checked classification' }
    const saveLink = () => fetch(`${base}/api/admin/customers/${customerId}/links`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(linkInput) })
    assert.equal((await saveLink()).status, 503)
    const linkedState = await (await fetch(`${base}/__fixture/state`)).json(); assert.equal(linkedState.links.length, 1)
    assert.equal((await saveLink()).status, 200)
    const replayedState = await (await fetch(`${base}/__fixture/state`)).json(); assert.deepEqual(replayedState.links, linkedState.links); assert.deepEqual(replayedState.audits, linkedState.audits)
    const allBookings = await (await fetch(`${base}/api/admin/live-bookings`)).json()
    assert.equal(allBookings.states[2].booking.status, 'confirmed')
    const confirmedId = allBookings.states[2].requestId
    assert.match(await (await fetch(`${base}/api/admin/live-bookings/${confirmedId}/documents/confirmation`)).text(), /SYNTHETIC FIXTURE/)
    assert.equal((await fetch(`${base}/api/admin/quote-requests/${liveId}/photos/${unknownId}`)).status, 404)
    assert.equal((await fetch(`${base}/api/admin/live-bookings/${liveId}/documents/confirmation`)).status, 404)
    await control({ liveAnalysisProcessing: true })
    assert.equal((await (await fetch(`${base}/api/admin/quote-requests/${liveId}/analysis`)).json()).latest.status, 'running')
    // R2 HTTP fixture contracts and isolation; real transaction correctness is
    // covered by the separate customer SQL tests, not these canned responses.
    const post = (path, input, method = 'POST') => fetch(base + path, { method, headers: { 'content-type': 'application/json', ...credentials }, body: JSON.stringify(input) })
    const candidateRows = await (await post('/api/admin/customers/candidates', { email: liveState.customers[0].email })).json()
    assert.equal(candidateRows.candidates[0].customer.id, customerId)
    const reviewResponse = await post('/api/admin/customers/resolve', { name: 'Synthetic other contact', email: liveState.customers[0].email, idempotencyKey: 'synthetic-review-only' })
    assert.equal(reviewResponse.status, 409); assert.equal((await reviewResponse.json()).code, 'needs_review')
    const propertyInput = { label: 'Synthetic Unit 1', address: { line1: 'Synthetic 1 QA Lane', unit: '1', suburb: 'Synthetic suburb', state: 'NSW', postcode: '2000', country: 'AU' }, contactName: null, notes: null }
    await control({ loseNextMutationResponse: true })
    const resolvedInput = { name: liveState.customers[0].name, email: liveState.customers[0].email, idempotencyKey: 'synthetic-resolve-replay', decision: { kind: 'existing', customerId, expectedRevision: replayedState.customers.find(c => c.id === customerId).revision, reason: 'Synthetic reviewed person' }, property: propertyInput, source: { type: 'quote_request', id: liveId, expectedSourceRevision: 2, expectedCrmRevision: 0 } }
    assert.equal((await post('/api/admin/customers/resolve', resolvedInput)).status, 503)
    const resolved = await (await post('/api/admin/customers/resolve', resolvedInput)).json()
    assert.equal(resolved.outcome, 'client_reused'); assert.equal(resolved.propertyOutcome, 'property_created'); assert.equal(resolved.crmRevision, 1)
    assert.deepEqual(await (await post('/api/admin/customers/resolve', resolvedInput)).json(), resolved)
    const relation = await (await fetch(`${base}/api/admin/customers/quote-requests/${liveId}`)).json()
    assert.equal(relation.property.id, resolved.property.id)
    const r2Detail = await (await fetch(`${base}/api/admin/customers/${customerId}`)).json()
    assert.equal(r2Detail.properties.length, 1); assert.ok(r2Detail.records.some(r => r.sourceType === 'quote_request' && r.sourceId === liveId))
    assert.deepEqual((await (await fetch(`${base}/api/admin/quote-requests/${liveId}`)).json()).request, liveState.liveRequests[0])
    const beforeLate = forwarded.length
    await control({ responseDelays: { [`/api/admin/customers/${customerId}`]: 100 } })
    const lateR2 = fetch(`${base}/api/admin/customers/${customerId}`, { headers: credentials })
    await pause(20); await control({ signedOut: true, responseDelays: {} })
    assert.equal((await lateR2).status, 200)
    for (const path of ['/api/admin/customers/candidates', '/api/admin/customers/resolve', `/api/admin/customers/${customerId}/properties`, `/api/admin/customers/quote-requests/${liveId}`]) {
      const response = path.endsWith('/candidates') || path.endsWith('/resolve') ? await post(path, {}) : await fetch(base + path, { headers: credentials })
      assert.equal(response.status, 401); assert.equal(response.headers.get('x-esn-fixture'), 'synthetic')
    }
    assert.equal(forwarded.length, beforeLate, 'R2 API credentials and late captured responses never forward')
    await control({ signedOut: true })
    for (const path of ['/api/admin/quote-requests','/api/admin/live-bookings', `/api/admin/quote-requests/${liveId}/analysis`, `/api/admin/live-bookings/${confirmedId}/documents/confirmation`]) assert.equal((await fetch(base + path)).status, 401)
    assert.equal(forwarded.length, detailPageCount, 'live records, photos, documents, guessed IDs and denied APIs never reach upstream')

  } finally {
    fixture.kill('SIGTERM'); if (fixture.exitCode === null) await once(fixture, 'exit')
    await new Promise(resolve => upstream.close(resolve))
  }
})
