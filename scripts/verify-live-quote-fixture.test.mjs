import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createLiveQuoteFixture } from './verify-live-quote-fixture.mjs'

// Actual HTTP -> Quote API -> application -> migration/RPC -> EMS API. The UI
// proxy uses a synthetic upstream; browser interactions are a separate check.
test('live Quote fixture verifies real save/retry/revision/EMS flow while isolating upstream credentials and APIs', async () => {
  const forwarded = []
  const upstream = http.createServer((req, res) => {
    forwarded.push({ path: req.url, headers: req.headers })
    res.writeHead(200, { 'content-type': req.headers.rsc ? 'text/x-component' : 'text/html', 'set-cookie': 'company-session=never-forward', vary: 'RSC, Next-Router-State-Tree' })
    res.end(req.headers.rsc ? 'synthetic-rsc' : '<html><body>synthetic UI upstream</body></html>')
  })
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening')
  const fixture = await createLiveQuoteFixture({ port: 0, upstream: `http://127.0.0.1:${upstream.address().port}` })
  const { base } = fixture
  const contact = { name: 'Synthetic integration client', email: 'synthetic.customer@example.invalid', phone: '', siteAddress: '1 Synthetic Street', suburb: 'Synthetic suburb', postcode: '2000', details: 'Synthetic fixture only', consent: true }
  const service = { serviceId: 'cabinet-painting', intent: 'full-repainting', surfaces: ['doors', 'drawers'], doorCount: 6, drawerCount: 2, material: 'Synthetic timber', colourPreference: 'Synthetic white' }
  const request = (path, { method = 'GET', cookie, body, headers = {} } = {}) => fetch(base + path, { method, headers: { origin: base, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const control = value => request('/__fixture/control', { method: 'POST', body: value })
  const state = async () => (await request('/__fixture/state')).json()
  const save = (cookie, values) => request('/api/quote/requests', { method: 'PUT', cookie, body: values })
  const values = (revision, payload, idempotencyKey = randomUUID()) => ({ expectedRevision: revision, payload, idempotencyKey, storageConsent: true })
  try {
    const credentials = { cookie: 'company-secret=never-forward', authorization: 'Bearer never-forward', 'x-company-secret': 'never-forward' }
    const html = await request('/quote/start?service=cabinet-painting', { headers: credentials })
    assert.equal(html.status, 200); assert.equal(html.headers.get('set-cookie'), null)
    const rsc = await request('/admin/quotes?_rsc=synthetic', { headers: { ...credentials, rsc: '1', 'next-router-state-tree': '%5B%22%22%5D', 'next-url': '/quote/start?service=cabinet-painting' } })
    assert.equal(await rsc.text(), 'synthetic-rsc')
    assert.equal(forwarded[1].headers.rsc, '1'); assert.equal(forwarded[1].headers['next-url'], '/quote/start?service=cabinet-painting')
    assert.equal((await request('/_next/image?url=%2Fimages%2Flk-group-logo-circle-transparent.png&w=128&q=75', { headers: credentials })).status, 200)
    for (const item of forwarded) {
      assert.equal(item.headers.cookie, undefined); assert.equal(item.headers.authorization, undefined)
      assert.equal(item.headers['x-company-secret'], undefined)
    }
    const proxyCount = forwarded.length
    for (const path of ['/api/google/connect', '/api/google/callback', '/api/quote/submit', '/admin/settings', '/_next/image?url=%2Fapi%2Fquote%2Frequests&w=128&q=75', '/_next/image?url=https://foreign.invalid/private&w=128&q=75']) assert.ok((await request(path, { headers: credentials })).status >= 400)
    assert.equal((await request('/admin/quotes', { method: 'POST', body: {} })).status, 404)
    assert.equal((await request('/admin', { headers: { 'next-url': 'https://foreign.invalid/admin' } })).status, 400)
    const opened = await request('/api/quote/requests/session', { method: 'POST' })
    assert.equal(opened.status, 200); assert.match(opened.headers.get('set-cookie'), /^lk_quote_request=/)
    const a = opened.headers.get('set-cookie').split(';')[0]
    const b = (await request('/api/quote/requests/session', { method: 'POST' })).headers.get('set-cookie').split(';')[0]
    assert.notEqual(a, b)
    assert.deepEqual(await (await request('/api/quote/requests', { cookie: a })).json(), { request: null })
    const invalid = values(0, { contact: { ...contact, name: '' }, service: null })
    assert.equal((await save(a, invalid)).status, 400)
    assert.equal((await save(undefined, values(0, { contact, service: null }))).status, 401)
    assert.equal((await state()).auditCount, 0)
    const initial = values(0, { contact, service: null })
    await control({ loseNextSaveResponse: true })
    assert.equal((await save(a, initial)).status, 503)
    assert.equal((await state()).requests.length, 1, 'Response-loss scenario commits the real SQL save')
    const retried = await save(a, initial); assert.equal(retried.status, 200)
    const saved = (await retried.json()).request
    assert.equal(saved.mode, 'live'); assert.equal(saved.revision, 1)
    assert.equal(saved.payload.contact.email, contact.email, 'Customer address is not replaced by the company trial recipient')
    assert.equal((await state()).auditCount, 1, 'Retry does not create another request or audit')
    assert.equal((await save(a, { ...initial, payload: { contact: { ...contact, name: 'Changed' }, service: null } })).status, 409)
    assert.deepEqual(await (await request('/api/quote/requests', { cookie: b })).json(), { request: null })
    const updated = await save(a, values(1, { contact, service })); assert.equal(updated.status, 200)
    const second = (await updated.json()).request
    assert.equal(second.id, saved.id); assert.equal(second.revision, 2)
    assert.equal((await save(a, values(1, { contact: { ...contact, name: 'Old tab' }, service }))).status, 409)
    const listing = await (await request('/api/admin/quote-requests')).json()
    assert.equal(listing.total, 1); assert.equal(listing.requests[0].id, saved.id)
    assert.equal(listing.requests[0].payload.service.doorCount, 6)
    const detail = await (await request(`/api/admin/quote-requests/${saved.id}`)).json()
    assert.equal(detail.request.revision, 2); assert.equal(detail.audit.length, 2)
    assert.ok(detail.audit.every(audit => audit.actorType === 'guest'))
    assert.equal(JSON.stringify(detail).includes('ownerHash'), false)
    const beforeForeign = await state()
    assert.equal((await request('/api/quote/requests', { method: 'PUT', cookie: a, body: values(2, { contact, service }), headers: { origin: 'https://foreign.invalid' } })).status, 403)
    assert.equal((await state()).auditCount, beforeForeign.auditCount)
    const reviewBody = { expectedRevision: 2, idempotencyKey: randomUUID() }
    const review = await request('/api/quote/requests/review', { method: 'POST', cookie: a, body: reviewBody })
    assert.equal(review.status, 200); const submitted = (await review.json()).request
    assert.equal(submitted.status, 'review_requested'); assert.equal(submitted.revision, 3)
    assert.equal((await request('/api/quote/requests/review', { method: 'POST', cookie: a, body: reviewBody })).status, 200)
    assert.equal((await state()).auditCount, 3)
    assert.equal((await save(a, values(3, { contact, service }))).status, 409)
    await control({ customerAccessStatus: 401 })
    assert.equal((await request('/api/quote/requests', { cookie: a })).status, 401)
    assert.equal((await (await request('/api/admin/quote-requests')).json()).total, 1, 'Customer access loss retains the company record')
    await control({ staffAccessStatus: 403 })
    assert.equal((await request('/api/admin/quote-requests')).status, 403)
    assert.equal((await request(`/api/admin/quote-requests/${saved.id}`)).status, 403)
    assert.equal(forwarded.length, proxyCount, 'Every customer/admin API remains local')
    await control({ loseNextSaveResponse: true, conflictNextSave: true })
    assert.equal((await control({ reset: true })).status, 200, 'Reset truncates the local fixture FK graph')
    assert.equal((await state()).requests.length, 0)
    assert.equal((await request('/api/admin/quote-requests')).status, 200, 'Reset clears staff access faults')
    assert.equal((await save(a, values(0, { contact, service: null }))).status, 200, 'Reset clears customer access, conflict and response-loss faults')
    assert.equal((await state()).requests.length, 1, 'The next scenario starts independently')
  } finally { await fixture.close(); await new Promise(resolve => upstream.close(resolve)) }
})

test('localhost fixture isolates browser cookies from the company 127.0.0.1 host and rejects authority swaps', async () => {
  const fixture = await createLiveQuoteFixture({ port: 0, hostname: 'localhost' })
  const port = fixture.server.address().port, network = `http://127.0.0.1:${port}`
  const raw = (path, options) => new Promise((resolve, reject) => {
    const req = http.request(network + path, options, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: Object.entries(res.headers).flatMap(([name, value]) => (Array.isArray(value) ? value : [value]).map(item => [name, item])) })))
    })
    req.on('error', reject); req.end()
  })
  try {
    assert.equal(fixture.base, `http://localhost:${port}`)
    const opened = await fetch(`${fixture.base}/api/quote/requests/session`, { method: 'POST', headers: { origin: fixture.base } })
    assert.equal(opened.status, 200)
    const setCookie = opened.headers.get('set-cookie')
    assert.match(setCookie, /^lk_quote_request=/); assert.doesNotMatch(setCookie, /Domain=/i)
    const cookie = setCookie.split(';')[0]
    assert.equal((await fetch(`${fixture.base}/api/quote/requests`, { headers: { cookie } })).status, 200)
    for (const host of [`127.0.0.1:${port}`, `localhost:${port + 1}`, `foreign.invalid:${port}`]) {
      const denied = await raw('/api/quote/requests/session', { method: 'POST', headers: { host, origin: fixture.base, cookie } })
      assert.equal(denied.status, 403); assert.equal(denied.headers.get('set-cookie'), null)
    }
    const foreignOrigin = await fetch(`${fixture.base}/api/quote/requests/session`, { method: 'POST', headers: { origin: network, cookie } })
    assert.equal(foreignOrigin.status, 403)
  } finally { await fixture.close() }
  for (const hostname of ['foreign.invalid', '*.localhost', 'localhost.attacker.invalid', '::1']) {
    await assert.rejects(createLiveQuoteFixture({ hostname }), /Distinct loopback HTTP ports/)
  }
})
