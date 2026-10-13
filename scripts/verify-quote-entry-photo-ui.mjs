// Isolated photo lifetime acceptance. Real quote/auth API + PGlite; all media,
// AI and private upload transport responses are synthetic and stay intercepted.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createLiveQuoteFixture } from './verify-live-quote-fixture.mjs'
import { attachJourneyOverlay } from './verify-quote-journey-ui.mjs'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=', 'base64')
const photoId = 'c7907719-387c-4830-a160-f6eb0febfcd1'
const syntheticUpload = 'https://private-photo.fixture.invalid/upload'
function playwrightPackage() {
  const require = createRequire(import.meta.url)
  try { return require('playwright') } catch { return require(`${process.env.QUOTE_UI_RUNTIME_PACKAGES ?? '/Users/jimee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'}/playwright`) }
}
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
export async function verifyQuoteEntryPhoto({ upstream = 'http://127.0.0.1:3005', port = 3020 } = {}) {
  const fixture = await createLiveQuoteFixture({ upstream, port, customerAuth: true })
  const { chromium } = playwrightPackage()
  const browser = await chromium.launch({ headless: true, channel: process.env.QUOTE_UI_BROWSER_CHANNEL ?? 'chrome' }).catch(async error => { await fixture.close(); throw error })
  const checks = [], pageErrors = [], externalRequests = [], screenshots = []
  try {
    for (const phase of ['prepare', 'finalize', 'process']) for (const lateStatus of [401, 200]) {
      const name = `${phase} late ${lateStatus} preserves photo and exact pending request across peer start-new`
      if (process.env.QUOTE_PHOTO_SCENARIO && !name.includes(process.env.QUOTE_PHOTO_SCENARIO)) continue
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' })
      const page = await context.newPage(), peer = await context.newPage(), gate = deferred(), entered = deferred()
      const calls = [], consoleMessages = []
      let released = false, closing = false, uploadCalls = 0
      page.setDefaultTimeout(15_000)
      page.on('pageerror', error => pageErrors.push({ name, error: error.message }))
      page.on('console', message => { if (['error', 'warning'].includes(message.type())) consoleMessages.push(message.text().slice(0, 800)) })
      const api = async (path, data, method = 'POST', headers = {}) => {
        const response = await context.request.fetch(`${fixture.base}${path}`, { method, headers: { origin: fixture.base, ...headers }, ...(data === undefined ? {} : { data }) })
        assert.equal(response.status(), 200, `${path}: ${await response.text()}`)
        return response.json()
      }
      try {
        await api('/__fixture/control', { reset: true })
        const overlay = await attachJourneyOverlay(context, fixture.base, { realAuth: true })
        await context.route('**/*', async route => {
          const request = route.request(), url = new URL(request.url())
          if (request.url() === syntheticUpload) { uploadCalls++; return route.fulfill({ status: 200, body: '' }) }
          const isPrepare = request.method() === 'POST' && url.pathname === '/api/quote/requests/photos'
          const isFinalize = request.method() === 'POST' && url.pathname.endsWith('/finalize')
          const isProcess = request.method() === 'POST' && url.pathname.endsWith('/process')
          if (!isPrepare && !isFinalize && !isProcess) return route.fallback()
          const currentPhase = isPrepare ? 'prepare' : isFinalize ? 'finalize' : 'process'
          const record = { phase: currentPhase, path: url.pathname, body: request.postData(), requestId: request.headers()['x-lk-quote-request-id'] }
          calls.push(record)
          const firstTarget = currentPhase === phase && calls.filter(call => call.phase === phase).length === 1
          if (firstTarget) { entered.resolve(); await gate.promise }
          if (closing) return route.abort().catch(() => {})
          const state = await (await context.request.get(`${fixture.base}/__fixture/state`)).json()
          const quote = state.requests.find(item => item.id === record.requestId)
          assert.ok(quote, 'Synthetic media response remains bound to the actual PGlite quote')
          const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
          if (firstTarget && lateStatus === 401) return reply({ error: 'Synthetic old photo access ended.' }, 401)
          if (isPrepare) return reply({ photo: { id: photoId }, upload: { signedUrl: syntheticUpload } })
          if (isProcess) overlay.flags.analysisStatus = 'succeeded'
          return reply(overlay.workspace(quote))
        })
        await api('/api/quote/requests/session')
        const payload = { contact: { name: 'Synthetic Photo Client', email: 'photo-boundary@example.invalid', phone: '0412345678', siteAddress: '12 Example Road', suburb: 'Ermington', postcode: '2115', details: '', consent: true }, service: { serviceId: 'cabinet-painting', intent: 'full-repainting', surfaces: ['doors', 'drawers'], doorCount: null, drawerCount: null, material: '', colourPreference: '' } }
        const { request: a } = await api('/api/quote/requests', { expectedRevision: 0, idempotencyKey: randomUUID(), storageConsent: true, payload }, 'PUT')
        await api('/api/quote/requests/customer/send', { email: payload.contact.email, requestId: a.id, expectedRevision: a.revision })
        await api('/api/quote/requests/customer/verify', { token: '12345678' })
        await page.goto(`${fixture.base}/quote/start?service=cabinet-painting&mode=live`)
        await page.getByRole('button', { name: 'View quotes & bookings', exact: true }).click()
        await page.locator('.lq-customer-list').getByRole('button', { name: 'Open saved quote', exact: true }).click()
        await page.locator('[data-quote-step="2"]:visible').waitFor()
        await page.getByText('Missing views or no visible damage?', { exact: true }).click()
        await page.locator('input[name="live-photo-upper-none"]').check()
        await page.locator('input[name="live-photo-no-damage"]').check()
        await page.locator('#live-photo-file').setInputFiles({ name: 'kept-photo.png', mimeType: 'image/png', buffer: png })
        const fileName = () => page.locator('#live-photo-file').evaluate(input => input.files?.[0]?.name ?? null)
        const localOptions = async () => ({ consent: await page.locator('input[name="live-photo-ai-consent"]').isChecked(), upper: await page.locator('input[name="live-photo-upper-none"]').isChecked(), damage: await page.locator('input[name="live-photo-no-damage"]').isChecked() })
        if (phase === 'process') {
          await page.getByRole('checkbox', { name: /I agree to sending these photos/ }).check()
          await page.getByRole('button', { name: 'Analyse photos & get estimate', exact: true }).click()
        } else await page.getByRole('button', { name: 'Save photo privately', exact: true }).click()
        await Promise.race([entered.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Target photo request was not started')), 15_000))])
        const originalOptions = await localOptions()
        let expectedRecord = a
        if (phase === 'finalize' && lateStatus === 200) {
          // Model the successful media command's legitimate revision advance in
          // the real quote API, while retaining the original finalize body/key.
          expectedRecord = (await api('/api/quote/requests', { expectedRevision: a.revision, idempotencyKey: randomUUID(), storageConsent: true, payload }, 'PUT', { 'x-lk-quote-request-id': a.id })).request
          assert.equal(expectedRecord.revision, a.revision + 1)
        }
        await peer.goto(`${fixture.base}/quote/start?service=cabinet-painting&mode=live`)
        const start = await api('/api/quote/requests/customer/logout', { intent: 'start-new' })
        assert.equal(start.signedOut, true)
        await api('/api/quote/requests/session')
        await peer.evaluate(() => { const channel = new BroadcastChannel('lk-live-quote-access'); channel.postMessage({ type: 'new-quote-started', source: 'synthetic-peer-photo-test' }); channel.close() })
        const check = page.getByRole('button', { name: 'Check quote session', exact: true })
        await check.waitFor()
        assert.equal(await check.isDisabled(), true, 'Actual pending HTTP blocks scope recovery until it finishes')
        assert.equal(await fileName(), 'kept-photo.png')
        released = true; gate.resolve()
        await assertEventually(async () => assert.equal(await check.isEnabled(), true))
        const retryName = phase === 'process' ? 'Retry same request' : 'Retry photo upload'
        const retry = page.getByRole('button', { name: retryName, exact: true })
        await retry.waitFor()
        assert.equal(await retry.isDisabled(), true, 'Original pending is retained while old scope is blocked')
        assert.equal(await fileName(), 'kept-photo.png')
        if (phase === 'process') assert.equal(await page.getByText('Your photo estimate is ready', { exact: true }).count(), 0, 'Late success cannot publish the old analysis into blocked scope')
        await check.click()
        await page.getByText('Your session was checked.', { exact: false }).waitFor()
        assert.equal(await fileName(), 'kept-photo.png', 'Metadata check preserves local selection')
        assert.deepEqual(await localOptions(), originalOptions, 'Metadata check preserves consent and coverage')
        assert.equal(await retry.isDisabled(), true, 'Metadata check alone does not reauthorize original quote')
        await api('/__fixture/control', { expireCustomerSendCooldown: true })
        await api('/api/quote/requests/customer/send', { email: payload.contact.email })
        await api('/api/quote/requests/customer/verify', { token: '12345678' })
        await page.getByRole('button', { name: 'View quotes & bookings', exact: true }).click()
        await page.getByRole('button', { name: 'Refresh saved quotes', exact: true }).click()
        await page.locator('.lq-customer-list').getByRole('button', { name: 'Open saved quote', exact: true }).click()
        await page.locator('[data-quote-step="2"]:visible').waitFor()
        assert.equal(await fileName(), 'kept-photo.png', 'Same-ID recovery preserves component and selected File')
        assert.deepEqual(await localOptions(), originalOptions, 'Same-ID recovery preserves consent and coverage')
        await assertEventually(async () => assert.equal(await retry.isEnabled(), true))
        await retry.click()
        await assertEventually(async () => assert.equal(calls.filter(call => call.phase === phase).length, 2))
        const targetCalls = calls.filter(call => call.phase === phase)
        assert.deepEqual(targetCalls[1], targetCalls[0], 'Same path, quote ID, serialized body and idempotency key are retried')
        if (phase === 'process') { await page.getByText('Your photo estimate is ready', { exact: true }).waitFor(); assert.equal(await fileName(), 'kept-photo.png') }
        else { await page.getByText('Photo saved privately. You can add another view.', { exact: true }).waitFor(); assert.equal(await fileName(), null) }
        const after = await (await context.request.get(`${fixture.base}/__fixture/state`)).json()
        assert.equal(after.requests.length, 1)
        assert.deepEqual(after.requests[0], expectedRecord, 'Entry and retry preserve the actual quote record after its explicit synthetic revision advance')
        assert.deepEqual(after.requests[0].payload, a.payload)
        assert.equal(after.requests[0].status, a.status)
        assert.deepEqual(overlay.denied, [])
        externalRequests.push(...overlay.denied)
        const screenshot = `/tmp/quote-entry-photo-${phase}-${lateStatus}.png`
        await page.screenshot({ path: screenshot }); screenshots.push(screenshot)
        checks.push({ name, passed: true, attempts: targetCalls.length, exactBodyPreserved: true, filePreservedThroughRecovery: true, localOptionsPreserved: true, revisionAdvanced: expectedRecord.revision !== a.revision, syntheticPrivateUploadCalls: uploadCalls, consoleMessages })
        console.log(`PASS ${name}`)
      } catch (error) {
        console.error(error.stack ?? error)
        await page.screenshot({ path: '/tmp/quote-entry-photo-failure.png' }).catch(() => {})
        console.error(JSON.stringify({ name, alerts: await page.getByRole('alert').allTextContents(), calls, pageErrors, consoleMessages }))
        throw error
      } finally { closing = true; if (!released) gate.resolve(); await context.close() }
    }
    assert.ok(checks.length > 0, 'At least one selected scenario must execute')
    assert.deepEqual(pageErrors, [])
    return { upstream, fixture: fixture.base, checks, pageErrors, externalRequests, actualProviderRequests: 0, screenshots, scope: 'Actual local quote/auth API and PGlite; intercepted synthetic media/AI/provider/private upload only.' }
  } finally { await browser.close(); await fixture.close() }
}
async function assertEventually(check) { for (let attempt = 0; attempt < 150; attempt++) { try { await check(); return } catch (error) { if (attempt === 149) throw error; await new Promise(resolve => setTimeout(resolve, 100)) } } }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await verifyQuoteEntryPhoto({ upstream: process.env.QUOTE_UI_UPSTREAM ?? 'http://127.0.0.1:3005', port: Number(process.env.QUOTE_UI_FIXTURE_PORT ?? 3020) }), null, 2)) }
  catch (error) { console.error(error); process.exitCode = 1 }
}
