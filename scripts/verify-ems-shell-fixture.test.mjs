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
    assert.equal((await fetch(`${base}/images/lk-group-logo-circle-transparent.png`, { headers: credentials })).status, 200)
    for (const width of [96, 128, 256]) {
      const path = `/_next/image?url=%2Fimages%2Flk-group-logo-circle-transparent.png&w=${width}&q=75`
      const logo = await fetch(base + path, { headers: credentials })
      assert.equal(logo.status, 200); assert.equal(logo.headers.get('set-cookie'), null)
      assert.equal(forwarded.at(-1).path, path)
    }
    for (const entry of forwarded) { assert.equal(entry.headers.cookie, undefined); assert.equal(entry.headers.authorization, undefined); assert.equal(entry.headers['x-company-secret'], undefined) }
    const count = forwarded.length
    for (const path of [
      '/api/unknown', '/api/google/callback', '/admin/not-approved', '/admin/customers/id',
      '/_next/image?url=https://example.invalid/private&w=128&q=75',
      '/_next/image?url=http://127.0.0.1:3002/images/lk-group-logo-circle-transparent.png&w=128&q=75',
      '/_next/image?url=%2Fapi%2Fquote%2Fbooking&w=128&q=75',
      '/_next/image?url=%2Fimages%2Fother.png&w=128&q=75',
      '/_next/image?url=%2Fimages%2Flk-group-logo-circle-transparent.png&url=%2Fapi%2Fquote%2Fbooking&w=128&q=75',
      '/_next/image?url=%2Fimages%2Flk-group-logo-circle-transparent.png&w=128&q=75&extra=1',
      '/_next/image?url=%2Fimages%2Flk-group-logo-circle-transparent.png&w=4096&q=75',
      '/_next/image?url=%2Fimages%2Flk-group-logo-circle-transparent.png&w=128&q=100',
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
  } finally {
    fixture.kill('SIGTERM'); if (fixture.exitCode === null) await once(fixture, 'exit')
    await new Promise(resolve => upstream.close(resolve))
  }
})
