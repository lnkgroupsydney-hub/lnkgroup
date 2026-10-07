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
    for (const entry of forwarded) { assert.equal(entry.headers.cookie, undefined); assert.equal(entry.headers.authorization, undefined); assert.equal(entry.headers['x-company-secret'], undefined) }
    const count = forwarded.length
    for (const path of ['/api/unknown', '/api/google/callback', '/admin/not-approved', '/admin/customers/id', '/_next/image?url=https://example.invalid/private']) assert.ok((await fetch(base + path, { headers: credentials })).status >= 400)
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
  } finally {
    fixture.kill('SIGTERM'); if (fixture.exitCode === null) await once(fixture, 'exit')
    await new Promise(resolve => upstream.close(resolve))
  }
})
