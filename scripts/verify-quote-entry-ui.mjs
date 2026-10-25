// Local acceptance using actual quote/customer APIs and cookies. Providers are synthetic.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createLiveQuoteFixture } from './verify-live-quote-fixture.mjs'
import { attachJourneyOverlay, quoteEntryAction, quoteEntryActionDisabled, quoteViewport } from './verify-quote-journey-ui.mjs'

const contact = { name: 'Synthetic returning customer', email: 'returning@example.invalid', phone: '0412 345 678', siteAddress: '1 Existing Street', suburb: 'Ermington', postcode: '2115', details: 'Existing project notes', consent: true }
const service = { serviceId: 'cabinet-painting', intent: 'full-repainting', surfaces: ['doors'], doorCount: 8, drawerCount: 3, material: 'Existing timber', colourPreference: 'Existing white' }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
async function eventually(check) { for (let i = 0; i < 150; i++) { try { return await check() } catch (error) { if (i === 149) throw error; await new Promise(resolve => setTimeout(resolve, 100)) } } }

export async function verifyQuoteEntry({ upstream = 'http://127.0.0.1:3005', port = 3019 } = {}) {
  const fixture = await createLiveQuoteFixture({ upstream, port, customerAuth: true })
  const require = createRequire(import.meta.url)
  let playwright
  try { playwright = require('playwright') } catch { playwright = require('/Users/jimee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright') }
  const browser = await playwright.chromium.launch({ headless: true, channel: 'chrome' }).catch(async error => { await fixture.close(); throw error })
  const checks = [], pageErrors = [], warnings = [], screenshots = []
  async function scenario(name, run) {
    if (process.env.QUOTE_UI_ENTRY_SCENARIO && !name.includes(process.env.QUOTE_UI_ENTRY_SCENARIO)) return
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
    await context.request.post(`${fixture.base}/__fixture/control`, { data: { reset: true } })
    const overlay = await attachJourneyOverlay(context, fixture.base, { realAuth: true })
    const page = await context.newPage(); page.setDefaultTimeout(15_000)
    page.on('pageerror', error => pageErrors.push({ name, message: error.message }))
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) warnings.push({ name, message: message.text().slice(0, 500) }) })
    async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
      const response = await context.request.fetch(fixture.base + path, { method, headers: { origin: fixture.base }, ...(body === undefined ? {} : { data: body }) })
      const value = await response.json(); assert.equal(response.status(), 200, JSON.stringify(value)); return value
    }
    const state = () => api('/__fixture/state')
    async function authenticate(request, bind = true) {
      await api('/api/quote/requests/customer/send', { email: request.payload.contact.email, ...(bind ? { requestId: request.id, expectedRevision: request.revision } : {}) })
      await api('/api/quote/requests/customer/verify', { token: '12345678' })
      await api('/api/quote/requests/customer/select', { requestId: request.id })
      overlay.flags.verified = true
    }
    async function seed(withService = true, linked = true) {
      await api('/api/quote/requests/session', {})
      const request = (await api('/api/quote/requests', { expectedRevision: 0, idempotencyKey: randomUUID(), storageConsent: true, payload: { contact, service: withService ? service : null } }, 'PUT')).request
      if (linked) await authenticate(request)
      return request
    }
    async function navigate() { await page.goto(`${fixture.base}/quote/start?mode=live`); await page.getByRole('button', { name: 'Start a new quote', exact: true }).waitFor() }
    async function openSaved(request) {
      await (await quoteEntryAction(page, 'View quotes & bookings')).click()
      const list = request ? page.locator('.lq-customer-list li').filter({ hasText: request.reference }) : page.locator('.lq-customer-list')
      await list.getByRole('button', { name: 'Open saved quote', exact: true }).first().click()
    }
    async function peerStart() {
      await api('/api/quote/requests/customer/logout', { intent: 'start-new' })
      await api('/api/quote/requests/session', {})
      await page.evaluate(() => { const channel = new BroadcastChannel('lk-live-quote-access'); channel.postMessage({ type: 'new-quote-started', source: 'synthetic-entry-peer' }); channel.close() })
      await page.getByRole('button', { name: 'Check quote session', exact: true }).waitFor()
    }
    async function reopen(request) {
      await api('/__fixture/control', { expireCustomerSendCooldown: true })
      await authenticate(request, false)
      await (await quoteEntryAction(page, 'View quotes & bookings')).click()
      await page.getByRole('button', { name: 'Refresh saved quotes', exact: true }).click()
      await page.locator('.lq-customer-list li').filter({ hasText: request.reference }).getByRole('button', { name: 'Open saved quote', exact: true }).click()
    }
    async function capture(file) { const path = `/tmp/${file}.png`; await page.screenshot({ path }); screenshots.push(path) }
    async function visit() {
      overlay.flags.analysisStatus = 'succeeded'
      await openSaved(); await page.getByText('Your photo estimate is ready', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Review estimate', exact: false }).click()
      await page.getByRole('button', { name: 'Pick a visit', exact: true }).last().click()
      await page.getByRole('button', { name: /available to request only/ }).first().click()
      await page.locator('input[name="booking-preferred-time"]').fill('10:30')
    }
    try {
      await run({ page, context, overlay, api, state, seed, authenticate, navigate, openSaved, peerStart, reopen, capture, visit })
      assert.deepEqual(overlay.denied, []); checks.push({ name, passed: true }); console.log(`PASS ${name}`)
    } catch (error) {
      await page.screenshot({ path: '/tmp/quote-entry-failure.png' }).catch(() => {})
      console.error(JSON.stringify({ name, alerts: await page.getByRole('alert').allTextContents(), pageErrors, warnings: warnings.filter(item => item.name === name) }))
      throw error
    } finally { await context.close() }
  }
  try {
    await scenario('choice cards require explicit entry and work on desktop/mobile keyboard', async ({ page, navigate, state, overlay, capture }) => {
      await navigate(); assert.equal(await page.locator('#live-name').count(), 0)
      assert.equal((await state()).requests.length, 0); assert.equal(overlay.syntheticCalls.length, 0)
      await capture('quote-entry-desktop')
      await page.setViewportSize({ width: 390, height: 844 })
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal(await page.locator('.quote-route-shell').count(), 1)
      await capture('quote-entry-mobile')
      assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth))
      await page.getByRole('button', { name: 'Start a new quote', exact: true }).focus(); await page.keyboard.press('Enter')
      await page.locator('#live-name').waitFor(); assert.equal(await page.locator('#live-email').inputValue(), ''); await quoteViewport(page)
    })
    await scenario('authorized contact-only prefill creates distinct B and preserves actual A', async ({ page, navigate, seed, state, capture, api }) => {
      const a = await seed(); const before = await api(`/api/admin/quote-requests/${a.id}`)
      await navigate(); assert.equal(await page.locator('.lq-project-summary').count(), 0)
      await (await quoteEntryAction(page, 'Start a new quote')).click(); await page.locator('#live-name').waitFor()
      for (const [id, value] of [['live-name', contact.name], ['live-email', contact.email], ['live-phone', contact.phone]]) assert.equal(await page.locator(`#${id}`).inputValue(), value)
      for (const id of ['live-site', 'live-suburb', 'live-postcode', 'live-details']) assert.equal(await page.locator(`#${id}`).inputValue(), '')
      assert.equal(await page.getByRole('checkbox', { name: /privately saving my details/ }).isChecked(), false)
      assert.equal(await page.getByText('Unsaved changes', { exact: true }).count(), 0)
      assert.equal((await state()).customerAuth.providerCalls.send, 1)
      await capture('quote-entry-prefilled')
      await page.locator('#live-name').fill('Changed name'); await page.getByRole('button', { name: 'Discard changes', exact: true }).click()
      assert.equal(await page.locator('#live-name').inputValue(), contact.name)
      await page.locator('#live-site').fill('2 New Project Street'); await page.locator('#live-suburb').fill('Sydney'); await page.locator('#live-postcode').fill('2000')
      await page.getByRole('checkbox', { name: /privately saving my details/ }).check(); await page.locator('[data-quote-next]:visible').click()
      await page.locator('[data-quote-step="1"]:visible').waitFor()
      const all = (await state()).requests; assert.equal(all.length, 2)
      const b = all.find(item => item.id !== a.id); assert.equal(b.revision, 1); assert.equal(b.payload.service, null); assert.equal(b.payload.contact.details, '')
      assert.deepEqual(await api(`/api/admin/quote-requests/${a.id}`), before)
    })
    await scenario('saved current A opens only after explicit list selection', async ({ page, navigate, seed }) => {
      const a = await seed(); await navigate(); assert.equal(await page.locator('[data-quote-step]').count(), 0)
      await (await quoteEntryAction(page, 'View quotes & bookings')).click()
      const open = page.locator('.lq-customer-list').getByRole('button', { name: 'Open saved quote', exact: true }); await open.waitFor(); assert.equal(await open.isEnabled(), true)
      assert.equal(await page.locator('.lq-project-summary').getByText(a.reference, { exact: false }).count(), 0)
      await open.click(); await page.locator('[data-quote-step="2"]:visible').waitFor()
      assert.ok((await page.locator('.lq-project-summary').innerText()).includes(a.reference))
    })
    await scenario('unlinked guest is protected and exact browser draft resumes without email', async ({ page, navigate, seed, state, api }) => {
      const a = await seed(false, false); const before = await api(`/api/admin/quote-requests/${a.id}`)
      await navigate(); await (await quoteEntryAction(page, 'Start a new quote')).click()
      const resume = page.getByRole('button', { name: 'Continue this browser draft', exact: true }); await resume.waitFor()
      assert.equal(await page.locator('#live-name').count(), 0); assert.equal((await state()).customerAuth.providerCalls.send, 0)
      await resume.click(); await page.locator('[data-quote-step="1"]:visible').waitFor()
      await page.getByRole('button', { name: 'Back', exact: true }).click(); assert.equal(await page.locator('#live-name').inputValue(), contact.name)
      assert.deepEqual(await api(`/api/admin/quote-requests/${a.id}`), before)
    })
    await scenario('selected customer A cannot hide or discard unlinked browser B', async ({ page, navigate, seed, authenticate, api, state }) => {
      const a = await seed(false)
      await api('/api/quote/requests/customer/logout', { intent: 'start-new' }); await api('/api/quote/requests/session', {})
      const b = (await api('/api/quote/requests', { expectedRevision: 0, idempotencyKey: randomUUID(), storageConsent: true, payload: { contact: { ...contact, name: 'Unlinked browser project', email: 'browser@example.invalid' }, service: null } }, 'PUT')).request
      await api('/__fixture/control', { expireCustomerSendCooldown: true }); await authenticate(a, false)
      const before = (await state()).requests
      await navigate(); await (await quoteEntryAction(page, 'Start a new quote')).click()
      await page.getByRole('button', { name: 'Continue this browser draft', exact: true }).waitFor()
      assert.ok((await page.getByRole('status').allTextContents()).some(text => text.includes(b.reference)))
      await page.getByRole('button', { name: 'Continue this browser draft', exact: true }).click(); await page.locator('[data-quote-step="1"]:visible').waitFor()
      assert.ok((await page.locator('.lq-project-summary').innerText()).includes('Unlinked browser project'))
      assert.deepEqual((await state()).requests, before)
    })
    await scenario('peer session metadata check and same-A recovery preserve dirty contact', async ({ page, navigate, seed, openSaved, peerStart, reopen }) => {
      const a = await seed(false); await navigate(); await openSaved(); await page.locator('[data-quote-step="1"]:visible').waitFor()
      await page.getByRole('button', { name: 'Back', exact: true }).click(); await page.locator('#live-name').fill('Kept unsaved name')
      await peerStart(); await page.getByRole('button', { name: 'Check quote session', exact: true }).click()
      await page.getByText('Your session was checked.', { exact: false }).waitFor(); assert.equal(await page.locator('#live-name').inputValue(), 'Kept unsaved name')
      await reopen(a); assert.equal(await page.locator('#live-name').inputValue(), 'Kept unsaved name')
      assert.equal(await page.getByRole('button', { name: 'Save & continue', exact: false }).isEnabled(), true)
    })
    await scenario('contact pending blocks other IDs and email, then retries same body/key in recovered A', async ({ page, context, navigate, seed, openSaved, peerStart, authenticate, api, state }) => {
      const a = await seed(false)
      await api('/api/quote/requests/customer/logout', { intent: 'start-new' }); await api('/api/quote/requests/session', {})
      const b = (await api('/api/quote/requests', { expectedRevision: 0, idempotencyKey: randomUUID(), storageConsent: true, payload: { contact: { ...contact, siteAddress: '2 Another Street' }, service: null } }, 'PUT')).request
      await api('/__fixture/control', { expireCustomerSendCooldown: true }); await authenticate(b); await api('/api/quote/requests/customer/select', { requestId: a.id })
      await navigate(); await openSaved(a); await page.locator('[data-quote-step="1"]:visible').waitFor()
      await page.getByRole('button', { name: 'Back', exact: true }).click(); await page.locator('#live-name').fill('Pending preserved name')
      const entered = deferred(), gate = deferred(), attempts = []
      await context.route(`${fixture.base}/api/quote/requests`, async route => {
        if (route.request().method() !== 'PUT') return route.continue()
        attempts.push({ body: route.request().postData(), id: route.request().headers()['x-lk-quote-request-id'] })
        if (attempts.length === 1) { entered.resolve(); await gate.promise; return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic stale response.' }) }) }
        return route.continue()
      })
      await page.locator('[data-quote-next]:visible').click(); await entered.promise; await peerStart(); gate.resolve()
      const retry = page.getByRole('button', { name: 'Try saving again', exact: true }); await retry.waitFor()
      assert.equal(await retry.isDisabled(), true); assert.equal(await quoteEntryActionDisabled(page, 'Start a new quote'), true)
      await eventually(async () => assert.equal(await page.getByRole('button', { name: 'Check quote session', exact: true }).isEnabled(), true))
      await page.getByRole('button', { name: 'Check quote session', exact: true }).click(); await page.getByText('Your session was checked.', { exact: false }).waitFor()
      assert.equal(attempts.length, 1); assert.equal(await page.locator('#live-name').inputValue(), 'Pending preserved name')
      await (await quoteEntryAction(page, 'View quotes & bookings')).click()
      await page.locator('input[name="customer-email"]').fill('different@example.invalid')
      const sends = (await state()).customerAuth.providerCalls.send
      await page.getByRole('button', { name: 'Send email verification code', exact: true }).click()
      await page.getByText('Confirm or retry the current request before switching customer email.', { exact: true }).waitFor()
      assert.equal((await state()).customerAuth.providerCalls.send, sends)
      await page.getByRole('button', { name: 'Back to quote', exact: true }).first().click()
      await api('/__fixture/control', { expireCustomerSendCooldown: true }); await authenticate(a, false)
      await (await quoteEntryAction(page, 'View quotes & bookings')).click(); await page.getByRole('button', { name: 'Refresh saved quotes', exact: true }).click()
      assert.equal(await page.locator('.lq-customer-list li').filter({ hasText: b.reference }).getByRole('button', { name: 'Open saved quote', exact: true }).isDisabled(), true)
      await page.locator('.lq-customer-list li').filter({ hasText: a.reference }).getByRole('button', { name: 'Open saved quote', exact: true }).click()
      await eventually(async () => assert.equal(await retry.isEnabled(), true)); await retry.click()
      await page.locator('[data-quote-step="1"]:visible').waitFor(); assert.equal(attempts.length, 2); assert.deepEqual(attempts[1], attempts[0])
      assert.equal((await state()).requests.find(item => item.id === a.id).payload.contact.name, 'Pending preserved name')
    })
    await scenario('first PUT completed after peer empty-session start associates exact B and replays original key', async ({ page, context, navigate, peerStart, state }) => {
      await navigate(); await (await quoteEntryAction(page, 'Start a new quote')).click(); await page.locator('#live-name').waitFor()
      for (const [id, value] of [['live-name', contact.name], ['live-email', contact.email], ['live-site', contact.siteAddress], ['live-suburb', contact.suburb], ['live-postcode', contact.postcode]]) await page.locator(`#${id}`).fill(value)
      await page.getByRole('checkbox', { name: /privately saving my details/ }).check()
      const entered = deferred(), gate = deferred(), attempts = []
      await context.route(`${fixture.base}/api/quote/requests`, async route => {
        if (route.request().method() !== 'PUT') return route.continue()
        attempts.push({ body: route.request().postData(), id: route.request().headers()['x-lk-quote-request-id'] })
        if (attempts.length === 1) { entered.resolve(); await gate.promise; const response = await route.fetch(); return route.fulfill({ response }) }
        return route.continue()
      })
      await page.locator('[data-quote-next]:visible').click(); await entered.promise; await peerStart(); gate.resolve()
      await eventually(async () => assert.equal((await state()).requests.length, 1))
      await eventually(async () => assert.equal(await page.getByRole('button', { name: 'Check quote session', exact: true }).isEnabled(), true))
      await page.getByRole('button', { name: 'Check quote session', exact: true }).click()
      await page.getByRole('button', { name: 'Continue this browser draft', exact: true }).click()
      const retry = page.getByRole('button', { name: 'Try saving again', exact: true }); await eventually(async () => assert.equal(await retry.isEnabled(), true)); await retry.click()
      await page.locator('[data-quote-step="1"]:visible').waitFor()
      const all = (await state()).requests; assert.equal(all.length, 1); assert.equal(all[0].revision, 1)
      assert.equal(attempts[0].body, attempts[1].body); assert.equal(attempts[0].id, undefined); assert.equal(attempts[1].id, all[0].id)
    })
    await scenario('local visit and signature require explicit discard before a separate quote', async ({ page, navigate, seed, visit, state }) => {
      const a = await seed(); await navigate(); await visit()
      await page.getByRole('button', { name: 'Continue to sign', exact: true }).click(); await page.locator('input[name="booking-signature-name"]').waitFor()
      await page.locator('input[name="booking-signature-name"]').fill('Kept signature name'); await page.getByRole('radio', { name: /Use my typed full name/ }).check(); await page.locator('input[name="booking-acknowledged"]').check()
      await (await quoteEntryAction(page, 'Start a new quote')).click(); await page.getByRole('button', { name: 'Continue editing', exact: true }).click()
      assert.equal(await page.locator('input[name="booking-signature-name"]').inputValue(), 'Kept signature name'); assert.equal(await page.locator('input[name="booking-acknowledged"]').isChecked(), true)
      assert.equal(await page.locator('input[name="booking-preferred-time"]').inputValue(), '10:30')
      await (await quoteEntryAction(page, 'Start a new quote')).click(); await page.getByRole('button', { name: 'Discard changes & start new quote', exact: true }).click()
      await page.locator('#live-name').waitFor(); assert.equal(await page.locator('#live-site').inputValue(), '')
      assert.equal(await page.locator('input[name="booking-signature-name"]').count(), 0); assert.equal((await state()).requests[0].id, a.id)
    })
    await scenario('repeated same-quote access checks keep an unsaved visit time', async ({ page, navigate, seed, visit, openSaved }) => {
      const a = await seed(); await navigate(); await visit(); await page.getByRole('button', { name: 'Continue to sign', exact: true }).click()
      await page.locator('input[name="booking-signature-name"]').waitFor(); await page.getByRole('button', { name: 'Change visit', exact: true }).click()
      await page.locator('input[name="booking-preferred-time"]').fill('11:00')
      for (let i = 0; i < 2; i++) {
        await openSaved(a)
        await eventually(async () => assert.equal(await page.locator('input[name="booking-preferred-time"]').isEnabled(), true))
        await page.getByRole('button', { name: /available to request only/ }).first().waitFor()
        assert.equal(await page.locator('input[name="booking-preferred-time"]').inputValue(), '11:00')
      }
    })
    await scenario('a delayed first booking read still restores the saved visit time', async ({ page, context, navigate, seed, visit, openSaved }) => {
      const a = await seed(); await navigate(); await visit(); await page.getByRole('button', { name: 'Continue to sign', exact: true }).click(); await page.locator('input[name="booking-signature-name"]').waitFor()
      const saved = await page.evaluate(async id => (await fetch('/api/quote/requests/booking', { headers: { 'x-lk-quote-request-id': id } })).json(), a.id)
      await context.route(`${fixture.base}/api/quote/requests/booking`, async route => { await new Promise(resolve => setTimeout(resolve, 250)); return route.fulfill({ json: saved }) })
      await page.reload(); await openSaved(a); await page.getByText('Your photo estimate is ready', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Review estimate', exact: false }).click(); await page.getByRole('button', { name: 'Pick a visit', exact: true }).last().click()
      await eventually(async () => assert.equal(await page.locator('input[name="booking-preferred-time"]').inputValue(), '10:30'))
      assert.equal(await page.getByRole('button', { name: 'Send verification code', exact: true }).count(), 0)
    })
    await scenario('server visit revision changes invalidate the old signing review', async ({ page, context, navigate, seed, visit, openSaved }) => {
      const a = await seed(); await navigate(); await visit(); await page.getByRole('button', { name: 'Continue to sign', exact: true }).click()
      await page.locator('input[name="booking-signature-name"]').fill(contact.name); await page.getByRole('radio', { name: /Use my typed full name/ }).check(); await page.locator('input[name="booking-acknowledged"]').check()
      const saved = await page.evaluate(async id => (await fetch('/api/quote/requests/booking', { headers: { 'x-lk-quote-request-id': id } })).json(), a.id)
      saved.state.approval.selectionRevision++; saved.state.approval.preferredTime = '11:30'
      await context.route(`${fixture.base}/api/quote/requests/booking`, route => route.fulfill({ json: saved }))
      await openSaved(a)
      await page.getByRole('heading', { name: 'Pick a visit', exact: true }).waitFor()
      await page.getByText('Your saved visit changed or its review expired.', { exact: false }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Submit booking request', exact: true }).count(), 0)
    })
    await scenario('aborted late availability 401 preserves raw signature and dirty visit', async ({ page, navigate, seed, visit, peerStart, reopen }) => {
      const a = await seed(); await navigate(); await visit(); await page.getByRole('button', { name: 'Continue to sign', exact: true }).click()
      await page.locator('input[name="booking-signature-name"]').fill('Kept across late calendar error'); await page.getByRole('radio', { name: /Use my typed full name/ }).check(); await page.locator('input[name="booking-acknowledged"]').check()
      await page.evaluate(() => {
        // Trigger the existing read lane while signing, then delay the error body
        // past scope invalidation. This is a client fault injection, not a user click.
        const refresh = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Refresh availability')
        if (!refresh || refresh.disabled) throw new Error('The calendar read lane must be available before fault injection')
        const original = window.fetch
        window.fetch = async (...args) => {
          if (String(args[0]).includes('/booking/availability')) {
            window.fetch = original
            return new Response(new ReadableStream({ start(controller) { window.releaseSyntheticAvailability = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify({ error: 'Synthetic late availability access ended.' }))); controller.close() } } }), { status: 401, headers: { 'content-type': 'application/json' } })
          }
          return original(...args)
        }
        refresh.click()
      })
      await page.waitForFunction(() => typeof window.releaseSyntheticAvailability === 'function')
      await peerStart(); await page.evaluate(() => window.releaseSyntheticAvailability())
      await page.getByRole('button', { name: 'Check quote session', exact: true }).click(); await page.getByText('Your session was checked.', { exact: false }).waitFor()
      await reopen(a)
      await page.locator('input[name="booking-signature-name"]').waitFor()
      assert.equal(await page.locator('input[name="booking-signature-name"]').inputValue(), 'Kept across late calendar error')
      assert.equal(await page.locator('input[name="booking-acknowledged"]').isChecked(), true)
      assert.equal(await page.locator('input[name="booking-preferred-time"]').inputValue(), '10:30')
    })
    await scenario('receipt PDF finishing after peer start releases busy for metadata recovery', async ({ page, context, navigate, seed, visit, peerStart }) => {
      await seed(); await navigate(); await visit(); await page.getByRole('button', { name: 'Continue to sign', exact: true }).click()
      await page.locator('input[name="booking-signature-name"]').fill(contact.name); await page.getByRole('radio', { name: /Use my typed full name/ }).check(); await page.locator('input[name="booking-acknowledged"]').check()
      await page.getByRole('button', { name: 'Submit booking request', exact: true }).click(); await page.locator('.lq-receipt-highlights').waitFor()
      const entered = deferred(), gate = deferred()
      await context.route(`${fixture.base}/api/quote/requests/booking/documents/receipt`, async route => { entered.resolve(); await gate.promise; return route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' }) })
      await page.getByRole('button', { name: 'Download saved receipt PDF', exact: true }).click(); await entered.promise; await peerStart()
      const check = page.getByRole('button', { name: 'Check quote session', exact: true }); assert.equal(await check.isDisabled(), true); gate.resolve()
      await eventually(async () => assert.equal(await check.isEnabled(), true)); await check.click(); await page.getByText('Your session was checked.', { exact: false }).waitFor()
      assert.equal(await page.locator('.lq-receipt-highlights').count(), 1)
    })
    await scenario('email expiry during delayed start clears inputs only after confirmed success', async ({ page, context, navigate, seed, openSaved }) => {
      await seed(false)
      await context.route(`${fixture.base}/api/quote/requests/customer`, async route => {
        const response = await route.fetch(), body = await response.json()
        if (body.customer) body.customer.expiresAt = new Date(Date.now() + 1500).toISOString()
        return route.fulfill({ response, json: body })
      })
      await navigate(); await openSaved(); await page.locator('[data-quote-step="1"]:visible').waitFor(); await page.getByRole('button', { name: 'Back', exact: true }).click()
      const entered = deferred(), gate = deferred()
      await context.route(`${fixture.base}/api/quote/requests/customer/logout`, async route => { const response = await route.fetch(); entered.resolve(); await gate.promise; return route.fulfill({ response }) })
      await (await quoteEntryAction(page, 'Start a new quote')).click(); await entered.promise; await page.waitForTimeout(1700)
      assert.equal(await page.locator('#live-name').inputValue(), contact.name); assert.equal(await page.locator('#live-site').inputValue(), contact.siteAddress)
      gate.resolve(); await eventually(async () => assert.equal(await page.locator('#live-site').inputValue(), ''))
      assert.equal(await page.locator('#live-name').inputValue(), contact.name)
    })
    await scenario('uncertain start preserves inputs and checks session without repeating logout', async ({ page, context, seed, navigate, openSaved, state }) => {
      await seed(false); await navigate(); await openSaved(); await page.locator('[data-quote-step="1"]:visible').waitFor()
      await page.getByRole('button', { name: 'Back', exact: true }).click()
      let logoutCalls = 0
      await context.route(`${fixture.base}/api/quote/requests/customer/logout`, async route => {
        logoutCalls++; const response = await route.fetch()
        return route.fulfill({ response, status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic uncertain new session.' }) })
      })
      await (await quoteEntryAction(page, 'Start a new quote')).click()
      await page.getByRole('button', { name: 'Check quote session', exact: true }).waitFor(); assert.equal(await page.locator('#live-name').inputValue(), contact.name)
      assert.equal(await quoteEntryActionDisabled(page, 'Start a new quote'), true)
      await page.getByRole('button', { name: 'Check quote session', exact: true }).click(); await eventually(async () => assert.equal(await page.locator('#live-name').inputValue(), ''))
      assert.equal(logoutCalls, 1); assert.equal((await state()).requests.length, 1)
    })
    assert.ok(checks.length); assert.deepEqual(pageErrors, [])
    return { checks, pageErrors, warnings, screenshots, externalRequests: 0, actualProviderRequests: 0, scope: 'Real local APIs/PGlite/cookies, synthetic authentication and media/booking providers.' }
  } finally { await browser.close(); await fixture.close() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await verifyQuoteEntry({ upstream: process.env.QUOTE_UI_UPSTREAM ?? 'http://127.0.0.1:3005', port: Number(process.env.QUOTE_UI_FIXTURE_PORT ?? 3019) }), null, 2)) }
  catch (error) { console.error(error); process.exitCode = 1 }
}
