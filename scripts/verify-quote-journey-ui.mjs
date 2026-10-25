// Local browser acceptance: real quote save/read API + PGlite, synthetic
// identity/photos/analysis/booking only. No production, AI, email or Google calls.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createLiveQuoteFixture } from './verify-live-quote-fixture.mjs'
import { PHOTO_ROLES, PHOTO_ANALYSIS_SCHEMA_VERSION, validatePhotoAnalysis } from '../src/modules/quotes/domain/analysis.ts'
import { calculateEstimatePricing } from '../src/modules/quotes/domain/pricing.ts'
import { bookingAcknowledgment, validateBookingSignature } from '../src/modules/quotes/domain/booking-flow.ts'
import { parsePhotoWorkspace } from '../src/modules/quotes/presentation/photo-workspace-client.ts'
import { formatQuoteAmount } from '../src/modules/quotes/presentation/quote-money.ts'
import { bookingMonthDates, shiftBookingMonth, sydneyToday, parseBookingState, parseBookingReview } from '../src/modules/quotes/presentation/booking-flow-client.ts'

const photoId = '205f3d74-69e5-4cbe-b4b4-31d4a382cfad'
const jobId = '7332878e-3cb6-4986-a579-865b0244bce7'
const future = () => new Date(Date.now() + 600_000).toISOString()
const now = () => new Date().toISOString()
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=', 'base64')

/** Same evidence shape as saved-photo-analysis.test.mts; real validators/pricing. */
function analysisFor(service) {
  const analysis = { summary: 'Cabinet fronts are visible.', outcome: 'site_review_required',
    photoQuality: [{ photoId, usable: true, issues: [], retakeInstruction: null }],
    coverage: PHOTO_ROLES.map(role => ({ role, covered: true, photoIds: [photoId], note: 'Visible in synthetic photo.' })),
    quantities: {
      doors: { customer: service.doorCount, observed: 10, estimated: 12, needsConfirmation: true, basisPhotoIds: [photoId], confidence: 'medium', note: 'Approximate doors from the overview; confirm on site.' },
      drawers: { customer: service.drawerCount, observed: 4, estimated: 4, needsConfirmation: true, basisPhotoIds: [photoId], confidence: 'high', note: 'Drawer fronts appear in the overview.' },
    }, observedDamage: [], proposedWork: [], unknowns: [], siteChecks: [],
    estimateScope: { status: 'estimable', extent: 'whole_project', anchorPhotoId: photoId, scopePhotoIds: [photoId], contextPhotoIds: [], conflictingPhotoIds: [], description: 'Paint the cabinet fronts shown in the overview.', assumptions: ['Confirm inventory on site.'] },
  }
  return validatePhotoAnalysis(analysis, { photoIds: [photoId], doorCount: service.doorCount, drawerCount: service.drawerCount, coverage: { upperNotApplicable: true, damageNotPresent: true }, schemaVersion: PHOTO_ANALYSIS_SCHEMA_VERSION })
}

export async function attachJourneyOverlay(context, base, { realAuth = false } = {}) {
  const flags = { verified: false, analysisStatus: null, stale: false, submitLoss: false, accessStatus: 0, analysisDelayMs: 0, bookingReadFailure: false, reviewLifetimeMs: 600_000, legacyInvalidFields: false, accessMode: 'linked', verifyDifferentRequest: false, verifyDelayMs: 0, bookingDateDelayMs: 0, bookingReviewDelayMs: 0, includeOlderOnVerify: false, olderRequest: null, primaryRequest: null, bookingReadDelayMs: 0 }
  let approval = null, submission = null, sentBinding = null, submitAttempts = [], photoPresent = true
  const denied = [], syntheticCalls = [], reviewProofs = [], customerSends = [], customerVerifies = [], bookingDateAttempts = [], bookingReviewAttempts = []
  const savedDateKeys = new Set()
  const olderId = '9c26b6f4-3f62-4a68-95ab-fbf3f64231a6'
  function legacyRequest(request) {
    if (!request || !flags.legacyInvalidFields) return request
    return { ...request, payload: { ...request.payload, contact: { ...request.payload.contact, phone: '+1 202 555 0123' }, service: request.payload.service ? { ...request.payload.service, material: '<b>Old oak</b>' } : null } }
  }
  async function saved(requestId) {
    const state = await (await context.request.get(`${base}/__fixture/state`)).json()
    if (requestId === olderId && flags.olderRequest) return flags.olderRequest
    return legacyRequest(state.requests.find(request => request.id === requestId) ?? state.requests.at(-1) ?? null)
  }
  function workspace(request) {
    const service = request.payload.service
    const photos = photoPresent ? [{ id: photoId, requestId: request.id, role: 'overview', state: 'ready', mimeType: 'image/png', sizeBytes: tinyPng.length, storedBytes: tinyPng.length, contentHash: 'ab'.repeat(32), width: 1, height: 1, createdAt: now(), expiresAt: future(), contentUrl: `/api/quote/requests/photos/${photoId}/content` }] : []
    const status = flags.analysisStatus
    const analysis = status === 'succeeded' ? analysisFor(service) : null
    const latest = status ? { id: jobId, requestId: request.id, inputRevision: request.revision, status, stale: flags.stale, createdAt: now(), completedAt: ['queued', 'running'].includes(status) ? null : now(), attempts: status === 'queued' ? 0 : 1, error: ['failed', 'uncertain'].includes(status) ? 'Synthetic analysis recovery case.' : null, usage: null, analysis, pricing: analysis ? calculateEstimatePricing(analysis, service) : null } : null
    return parsePhotoWorkspace({ request, photos, jobs: latest ? [latest] : [], latest }, request.id)
  }
  function access(request) {
    if (!flags.verified || !request) return { customer: null, requests: [], currentRequestId: null }
    const primary = flags.primaryRequest ?? request
    const current = { id: primary.id, reference: primary.reference, status: primary.status, revision: primary.revision, savedAt: primary.savedAt }
    return { customer: { email: request.payload.contact.email, expiresAt: future() }, requests: flags.accessMode === 'unlinked' ? [] : flags.accessMode.startsWith('other') ? [{ ...current, id: olderId, reference: 'RQ-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }, ...(flags.accessMode === 'other-linked' ? [current] : [])] : flags.accessMode === 'linked-with-older' ? [current, { ...current, id: olderId, reference: 'RQ-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }] : [current], currentRequestId: flags.accessMode === 'unlinked' ? null : flags.accessMode.startsWith('other') ? olderId : request.id }
  }
  function bookingState(request) {
    const older = request.id === olderId && flags.olderRequest
    const snapshotFor = snapshot => ({ ...snapshot, requestId: request.id, reference: request.reference, payload: request.payload, photos: snapshot.photos.map(photo => ({ ...photo, requestId: request.id })) })
    const savedSubmission = older && submission ? { ...submission, requestId: request.id, reference: 'REQUEST-SYNTHETIC-OLDER', snapshot: snapshotFor(submission.snapshot) } : submission
    const savedApproval = older && approval ? { ...approval, snapshot: snapshotFor(approval.snapshot) } : approval
    return parseBookingState({ state: { requestId: request.id, verified: flags.verified, canEdit: !savedSubmission, approval: savedApproval, submission: savedSubmission, acknowledgment: bookingAcknowledgment() } }, request.id, false)
  }
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== base) { denied.push(`${request.method()} ${url.origin}`); return route.abort('blockedbyclient') }
    const path = url.pathname
    if (path.startsWith('/api/quote/requests/customer') && realAuth) return route.continue()
    if (path.endsWith('/customer/logout') && ['start-new', 'resume-browser-draft'].includes(request.postDataJSON()?.intent)) return route.continue()
    if (path === '/_next/image' && url.searchParams.get('url') === '/images/lk-group-logo-circle-transparent.png') return route.fulfill({ status: 200, contentType: 'image/png', body: readFileSync(new URL('../public/images/lk-group-logo-circle-transparent.png', import.meta.url)) })
    const overlay = path.startsWith('/api/quote/requests/customer') || path.startsWith('/api/quote/requests/analysis') || path.startsWith('/api/quote/requests/photos') || path.startsWith('/api/quote/requests/booking') || path.startsWith('/api/quote/requests/company-booking')
    if (!overlay) return route.continue()
    syntheticCalls.push({ path, method: request.method() })
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'cache-control': 'no-store', 'x-quote-journey-fixture': 'synthetic' }, body: JSON.stringify(body) })
    if (flags.accessStatus) return reply({ error: 'Synthetic customer access ended.' }, flags.accessStatus)
    try {
      const quote = await saved(request.headers()['x-lk-quote-request-id'])
      const body = request.postDataJSON() ?? {}
      if (path.endsWith('/customer/send')) { customerSends.push(body); sentBinding = body.requestId; return reply({ sent: true, retryAfterSeconds: 0, expiresInSeconds: 600 }) }
      if (path.endsWith('/customer/verify')) { customerVerifies.push(body); assert.equal(body.token, '123456'); assert.equal(sentBinding, quote.id); if (flags.verifyDelayMs) await new Promise(resolve => setTimeout(resolve, flags.verifyDelayMs)); flags.verified = true; flags.accessMode = flags.verifyDifferentRequest ? 'other' : flags.includeOlderOnVerify ? 'linked-with-older' : 'linked'; return reply(access(quote)) }
      if (path.endsWith('/customer/select')) { flags.accessMode = body.requestId === olderId ? 'other-linked' : 'linked'; return reply(access(quote)) }
      if (path.endsWith('/customer/logout')) { flags.verified = false; return reply({ ready: true }) }
      if (path.endsWith('/customer')) return reply(access(quote))
      if (!quote) return reply({ error: 'Save contact details first.' }, 409)
      if (path.endsWith('/content')) return route.fulfill({ status: 200, contentType: 'image/png', body: tinyPng })
      if (path.includes('/photos')) {
        if (request.method() === 'DELETE') photoPresent = false
        return reply(workspace(quote))
      }
      if (path.includes('/analysis')) {
        if (request.method() === 'POST') flags.analysisStatus = path.endsWith('/process') ? 'succeeded' : 'queued'
        if (request.method() === 'GET' && flags.analysisDelayMs) await new Promise(resolve => setTimeout(resolve, flags.analysisDelayMs))
        return reply(workspace(quote))
      }
      if (path.includes('/company-booking')) return reply({ state: null })
      // Keep the fault until the scenario explicitly recovers: a cancelled
      // duplicate read must not silently consume this regression fixture.
      if (path.endsWith('/booking') && quote.id === olderId && flags.bookingReadDelayMs) await new Promise(resolve => setTimeout(resolve, flags.bookingReadDelayMs))
      if (path.endsWith('/booking') && flags.bookingReadFailure) return reply({ error: 'Synthetic initial booking read unavailable.' }, 503)
      if (path.endsWith('/availability')) {
        const month = url.searchParams.get('month'), today = sydneyToday(), dates = bookingMonthDates(month)
        return reply({ availability: { month, minMonth: today.slice(0, 7), maxMonth: shiftBookingMonth(today.slice(0, 7), 3), days: dates.map(date => ({ date, selectable: date >= today && !date.endsWith('-20'), ...(date.endsWith('-20') ? { reason: 'busy' } : {}) })), revision: 'synthetic-calendar-v1', checkedAt: now(), expiresAt: future(), accountSub: 'synthetic-company', calendarId: 'synthetic-calendar' } })
      }
      if (path.endsWith('/approve')) {
        assert.equal(body.expectedRevision, quote.revision); assert.equal(body.analysisId, jobId)
        const current = workspace(quote), snapshot = { mode: 'live', kind: 'nonbinding_booking_request', version: bookingAcknowledgment().version, requestId: quote.id, reference: quote.reference, inputRevision: quote.revision, analysisId: jobId, payload: quote.payload, verifiedEmail: quote.payload.contact.email, analysis: current.latest.analysis, pricing: current.latest.pricing, photos: current.photos, acknowledgment: bookingAcknowledgment(), calendarTarget: { accountSub: 'synthetic-company', calendarId: 'synthetic-calendar' } }
        approval ??= { id: randomUUID(), version: 1, analysisId: jobId, inputRevision: quote.revision, approvedAt: now(), snapshot, snapshotHash: 'synthetic-snapshot-hash', stale: false, preferredDate: null, preferredTime: null, selectionRevision: 0, availabilityRevision: null }
      } else if (path.endsWith('/date')) {
        bookingDateAttempts.push(request.postData())
        assert.equal(body.approvalId, approval.id)
        if (!savedDateKeys.has(body.idempotencyKey)) { savedDateKeys.add(body.idempotencyKey); approval = { ...approval, preferredDate: body.preferredDate, preferredTime: body.preferredTime, availabilityRevision: body.availabilityRevision, selectionRevision: approval.selectionRevision + 1 } }
        if (flags.bookingDateDelayMs) await new Promise(resolve => setTimeout(resolve, flags.bookingDateDelayMs))
      } else if (path.endsWith('/review')) {
        bookingReviewAttempts.push(request.postData())
        if (flags.bookingReviewDelayMs) await new Promise(resolve => setTimeout(resolve, flags.bookingReviewDelayMs))
        const review = { snapshot: { ...approval.snapshot, preferredDate: approval.preferredDate, preferredTime: approval.preferredTime }, snapshotHash: approval.snapshotHash, reviewProof: `synthetic-review-proof-${approval.selectionRevision}`, expiresAt: new Date(Date.now() + flags.reviewLifetimeMs).toISOString(), approvalId: approval.id, selectionRevision: approval.selectionRevision }
        reviewProofs.push(review.reviewProof)
        return reply({ review: parseBookingReview({ review }, quote.id, approval.id, approval.selectionRevision, { date: approval.preferredDate, time: approval.preferredTime }) })
      } else if (path.endsWith('/submit')) {
        submitAttempts.push(request.postData()); validateBookingSignature(body.signature); assert.equal(body.reviewProof, `synthetic-review-proof-${approval.selectionRevision}`)
        submission ??= { id: randomUUID(), reference: 'REQUEST-SYNTHETIC', requestId: quote.id, approvalId: approval.id, submittedAt: now(), preferredDate: approval.preferredDate, preferredTime: approval.preferredTime, snapshot: { ...approval.snapshot, preferredDate: approval.preferredDate, preferredTime: approval.preferredTime }, snapshotHash: approval.snapshotHash, signedContentHash: 'synthetic-signed-content', signature: body.signature, emailStatus: 'provider_accepted', calendarStatus: 'not_required', error: null, receiptReady: true, providerMessageId: 'synthetic-no-mail', calendarEventId: null }
        if (flags.submitLoss) { flags.submitLoss = false; return reply({ error: 'Synthetic saved submit response lost. Retry same request.' }, 503) }
      } else if (path.endsWith('/documents/receipt')) return route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-1.4\n% Synthetic receipt download only; not a company document.\n%%EOF') })
      return reply({ state: bookingState(quote) })
    } catch (error) { return reply({ error: `Synthetic overlay error: ${error.message}` }, 500) }
  })
  return { flags, denied, syntheticCalls, submitAttempts, reviewProofs, customerSends, customerVerifies, bookingDateAttempts, bookingReviewAttempts, olderId, workspace, legacyRequest, get submission() { return submission } }
}

function playwrightPackage() {
  const require = createRequire(import.meta.url)
  try { return require('playwright') } catch { return require(`${process.env.QUOTE_UI_RUNTIME_PACKAGES ?? '/Users/jimee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'}/playwright`) }
}
const contact = { name: 'Synthetic Quote Customer', email: 'quote-ui@example.invalid', siteAddress: '12A Example Road', suburb: 'Ermington', postcode: '2115' }

// Entry cards stay direct; an active quote exposes the same actions in My quotes.
export async function quoteEntryAction(page, name) {
  const menu = page.getByRole('button', { name: 'My quotes', exact: true }).and(page.locator('[aria-haspopup="menu"]'))
  const card = page.getByRole('button', { name, exact: true })
  await menu.or(card).first().waitFor()
  if (await menu.isVisible()) {
    if (await menu.getAttribute('aria-expanded') !== 'true') await menu.click()
    await menu.and(page.locator('[aria-expanded="true"]')).waitFor()
    return page.getByRole('menu', { name: 'My quotes', exact: true }).getByRole('menuitem', { name, exact: true })
  }
  return card
}

export async function quoteEntryActionDisabled(page, name) {
  const action = await quoteEntryAction(page, name)
  try { return await action.isDisabled() }
  finally {
    const menu = page.getByRole('button', { name: 'My quotes', exact: true })
    if (await menu.isVisible()) {
      await page.keyboard.press('Escape')
      assert.equal(await menu.getAttribute('aria-expanded'), 'false', 'Inspecting a menu action must leave the menu closed')
    }
  }
}

async function quoteProgressButton(page, index) {
  if (page.viewportSize().width <= 700) {
    const toggle = page.getByRole('button', { name: /^Step \d of 6 ·/ }).and(page.locator('.lq-progress-toggle'))
    await toggle.waitFor()
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
  }
  return page.locator('.lq-progress button').nth(index)
}

export async function quoteViewport(page) {
  if (page.viewportSize().width <= 700) {
    const size = await page.evaluate(() => {
      const next = document.querySelector('[data-quote-next]')
      // A received quote has Manage saved quote instead of a next-step button.
      const action = next ?? [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Manage saved quote')
      const bar = action?.closest('.lq-stage-actions')
      const rect = bar?.getBoundingClientRect()
      return { width: innerWidth, height: innerHeight, bodyWidth: document.scrollingElement?.scrollWidth, panels: document.querySelectorAll('[data-quote-step]:not([hidden])').length, bar: rect ? { top: rect.top, bottom: rect.bottom, width: rect.width } : null }
    })
    assert.ok(size.bodyWidth <= size.width, `Horizontal overflow: ${size.bodyWidth}/${size.width}`)
    assert.ok(size.bar, 'The primary action must belong to the bottom action bar')
    assert.ok(size.bar.top >= 0 && size.bar.bottom <= size.height && size.bar.width > 0, `Bottom action bar outside viewport: ${JSON.stringify(size.bar)}/${size.height}`)
    assert.equal(size.panels, 1, 'Exactly one step must be active, regardless of document scroll position')
    return
  }
  const size = await page.evaluate(() => ({ windowY: scrollY, bodyHeight: document.documentElement.scrollHeight, height: innerHeight, width: innerWidth, bodyWidth: document.documentElement.scrollWidth, panels: [...document.querySelectorAll('[data-quote-step]')].filter(el => el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== 'hidden').length }))
  assert.equal(size.windowY, 0); assert.ok(size.bodyHeight <= size.height + 1, `Document grew to ${size.bodyHeight}/${size.height}`); assert.ok(size.bodyWidth <= size.width + 1); assert.equal(size.panels, 1)
}

export async function verifyQuoteJourney({ upstream = 'http://127.0.0.1:3002', port = 3017 } = {}) {
  const fixture = await createLiveQuoteFixture({ upstream, port, customerAuth: true })
  const { chromium } = playwrightPackage()
  // Use an isolated Chrome profile; the runtime's matching bundled browser may
  // not be installed. No browser download or user's existing profile is needed.
  const browser = await chromium.launch({ headless: true, channel: process.env.QUOTE_UI_BROWSER_CHANNEL ?? 'chrome' }).catch(async error => { await fixture.close(); throw error })
  const checks = [], consoleErrors = []
  async function scenario(name, viewport, run, options = {}) {
    if (process.env.QUOTE_UI_SCENARIO && !name.includes(process.env.QUOTE_UI_SCENARIO)) return
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' })
    const reset = await context.request.post(`${fixture.base}/__fixture/control`, { data: { reset: true } })
    assert.equal(reset.ok(), true, 'The local PGlite fixture must reset between scenarios')
    const overlay = await attachJourneyOverlay(context, fixture.base, options), page = await context.newPage()
    page.setDefaultTimeout(15_000)
    const networkFailures = []
    const browserConsole = []
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) browserConsole.push(message.text().slice(0, 800)) })
    page.on('response', response => { if (response.status() >= 400) networkFailures.push({ path: new URL(response.url()).pathname, status: response.status() }) })
    page.on('requestfailed', request => networkFailures.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }))
    page.on('pageerror', error => consoleErrors.push({ scenario: name, message: error.message }))
    try {
      await page.goto(`${fixture.base}/quote/start?service=cabinet-painting&mode=live`)
      await page.getByRole('button', { name: 'Start a new quote', exact: true }).waitFor()
      if (!options.entry) {
        await (await quoteEntryAction(page, 'Start a new quote')).click()
        await page.getByRole('textbox', { name: /Your name|Full name/, exact: false }).first().waitFor()
      }
      await run(page, context, overlay)
      assert.deepEqual(overlay.denied, [], 'No external requests may leave the fixture')
      checks.push({ name, passed: true })
      console.log(`PASS ${name}`)
    } catch (error) {
      await page.screenshot({ path: '/tmp/quote-one-page-failure.png' }).catch(() => {})
      console.error(JSON.stringify({ scenario: name, alerts: await page.getByRole('alert').allTextContents(), title: await page.locator('.lq-stage-top h2').allTextContents(), denied: overlay.denied, networkFailures, consoleErrors, browserConsole, syntheticCalls: overlay.syntheticCalls }))
      throw error
    } finally { await context.close() }
  }
  async function fillContact(page) {
    await page.getByLabel(/Your name|Full name/).first().fill(contact.name)
    await page.getByLabel(/^Email\s*\*/).fill(contact.email)
    await page.locator('#live-site').fill(contact.siteAddress)
    await page.locator('#live-suburb').fill(contact.suburb)
    await page.locator('#live-postcode').fill(contact.postcode)
    await page.getByRole('checkbox', { name: /privately saving|saving these details/ }).check()
  }
  async function reloadQuote(page) {
    await page.reload()
    await (await quoteEntryAction(page, 'View quotes & bookings')).click()
    const draft = page.getByRole('button', { name: 'Continue this browser draft', exact: true })
    const linked = page.locator('.lq-customer-list').getByRole('button', { name: 'Open saved quote', exact: true }).first()
    const ended = page.getByText(/private access has ended|writing access ended|Synthetic customer access ended/, { exact: false }).first()
    await Promise.race([draft.waitFor(), linked.waitFor(), ended.waitFor()])
    if (await draft.isVisible()) await draft.click()
    else if (await linked.isVisible()) await linked.click()
  }
  async function forward(page) { await page.locator('[data-quote-next]:visible').click() }
  async function panel(page, number) {
    // The visit's auth card is a sibling of its empty calendar container until
    // verified. Check the visible stage heading rather than that empty box.
    if (number === 4) await page.getByRole('heading', { name: 'Pick a visit', exact: true }).waitFor()
    else await page.locator(`[data-quote-step="${number}"]:visible`).waitFor()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
  }
  async function saveContact(page) { await fillContact(page); await forward(page); await panel(page, 1) }
  async function saveCabinets(page) {
    await page.getByRole('radio', { name: /Full cabinet repainting/ }).check()
    await page.getByRole('checkbox', { name: /Cabinet doors/, exact: true }).check()
    await page.getByRole('checkbox', { name: /Drawer fronts/, exact: true }).check()
    await forward(page); await panel(page, 2)
  }
  async function readyVisit(page, overlay) {
    overlay.flags.analysisStatus = 'succeeded'
    await reloadQuote(page); await panel(page, 2)
    await page.getByText(/Your photo estimate is ready/).waitFor()
    await forward(page); await panel(page, 3); await forward(page); await panel(page, 4)
  }
  async function verifyBookingEmail(page) {
    await page.getByRole('button', { name: 'Send verification code', exact: true }).click()
    await page.locator('input[name="customer-code"]').fill('123456')
    await page.getByRole('button', { name: 'Verify code', exact: true }).click()
  }
  async function accessBroadcast(page) {
    await page.evaluate(() => { const channel = new BroadcastChannel('lk-live-quote-access'); channel.postMessage('access-changed'); channel.close() })
  }
  try {
    await scenario('contact validation preserves invalid typing and paste, connects inline errors and blocks save', { width: 1280, height: 800 }, async (page, context) => {
      await fillContact(page)
      const puts = []
      page.on('request', request => { if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/quote/requests') puts.push(request.postData()) })
      const cases = [
        ['#live-name', '12345', contact.name], ['#live-name', 'https://example.com', contact.name],
        ['#live-email', 'a@@example.com', contact.email], ['#live-email', `${'a'.repeat(65)}@example.com`, contact.email],
        ['#live-phone', '+1 202 555 0123', ''], ['#live-phone', 'call Lisa', ''],
        ['#live-site', '12345', contact.siteAddress], ['#live-suburb', '12345', contact.suburb],
        ['#live-postcode', '21a5', contact.postcode], ['#live-postcode', '12345', contact.postcode],
      ]
      for (const [selector, raw, recovery] of cases) {
        const field = page.locator(selector)
        await field.fill(raw); await field.press('Tab')
        assert.equal(await field.inputValue(), raw, 'Invalid text must remain available to correct')
        assert.equal(await field.getAttribute('aria-invalid'), 'true')
        const description = (await field.getAttribute('aria-describedby')).split(' ').find(id => id.endsWith('-validation-error'))
        assert.ok(description); assert.ok((await page.locator(`[id="${description}"]`).innerText()).length)
        await forward(page); await panel(page, 0)
        await page.waitForFunction(id => document.activeElement?.id === id, await field.getAttribute('id'))
        assert.equal(puts.length, 0)
        await field.fill(recovery); await field.press('Tab')
        assert.notEqual(await field.getAttribute('aria-invalid'), 'true')
      }
      const name = page.locator('#live-name')
      await name.fill(''); await name.pressSequentially('12345'); await name.press('Tab')
      assert.equal(await name.inputValue(), '12345'); await forward(page); assert.equal(puts.length, 0)
      await name.evaluate(element => {
        element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, '김지미 李')
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: '김지미 李', isComposing: true }))
        element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '김지미 李' }))
      })
      await name.press('Tab'); assert.equal(await name.inputValue(), '김지미 李')
      assert.notEqual(await name.getAttribute('aria-invalid'), 'true')
      await forward(page); await panel(page, 1)
      const state = await (await context.request.get(`${fixture.base}/__fixture/state`)).json()
      assert.equal(puts.length, 1); assert.equal(state.requests[0].payload.contact.name, '김지미 李')
    })
    await scenario('optional phone, domestic, +61, 0061 and business numbers save; leading zero postcode remains a string', { width: 1280, height: 800 }, async (page, context) => {
      await fillContact(page)
      const phone = page.locator('#live-phone')
      const variants = ['', ' ', '0491 570 159', '(02) 5550 1234', '+61 491 570 159', '0061 491 570 159', '13 12 34', '1300 123 456']
      for (const value of variants) {
        await phone.fill(value); await phone.press('Tab')
        assert.notEqual(await phone.getAttribute('aria-invalid'), 'true')
        await page.locator('#live-postcode').fill('0123')
        await forward(page); await panel(page, 1)
        const state = await (await context.request.get(`${fixture.base}/__fixture/state`)).json()
        assert.equal(state.requests.length, 1)
        assert.equal(state.requests[0].payload.contact.phone, value.trim())
        assert.equal(state.requests[0].payload.contact.postcode, '0123')
        await page.locator('[data-quote-back]:visible').click(); await panel(page, 0)
      }
    })
    await scenario('whole cabinet counts preserve raw invalid input, block exponent coercion and accept blank, zero and 500', { width: 393, height: 852 }, async (page, context) => {
      await saveContact(page)
      await page.getByRole('radio', { name: /Full cabinet repainting/ }).check()
      await page.getByRole('checkbox', { name: /Cabinet doors/, exact: true }).check()
      const doors = page.getByRole('textbox', { name: /Cabinet doors/ })
      const drawers = page.getByRole('textbox', { name: /Drawer fronts/ })
      for (const raw of ['-1', '501', '1.5', '1e2', '+12', '１２', ' ']) {
        await doors.fill(raw); await doors.press('Tab')
        assert.equal(await doors.inputValue(), raw); assert.equal(await doors.getAttribute('aria-invalid'), 'true')
        await forward(page); await panel(page, 1)
        const state = await (await context.request.get(`${fixture.base}/__fixture/state`)).json()
        assert.equal(state.calls.filter(call => call.command === 'save').length, 1)
      }
      await doors.fill('0'); await drawers.fill('500'); await forward(page); await panel(page, 2)
      let state = await (await context.request.get(`${fixture.base}/__fixture/state`)).json()
      assert.equal(state.requests[0].payload.service.doorCount, 0); assert.equal(state.requests[0].payload.service.drawerCount, 500)
      await page.locator('[data-quote-back]:visible').click(); await panel(page, 1)
      await doors.fill(''); await drawers.fill(''); await forward(page); await panel(page, 2)
      state = await (await context.request.get(`${fixture.base}/__fixture/state`)).json()
      assert.equal(state.requests[0].payload.service.doorCount, null); assert.equal(state.requests[0].payload.service.drawerCount, null)
    })
    await scenario('multiline notes keep line breaks, reject control characters and overflow without clipping pasted text', { width: 1280, height: 800 }, async (page, context) => {
      await fillContact(page); await page.getByText('Add project notes', { exact: false }).click()
      const notes = page.locator('#live-details')
      for (const raw of ['A note\u0007', 'A'.repeat(3001)]) {
        await notes.fill(raw); await notes.press('Tab')
        assert.equal(await notes.inputValue(), raw); assert.equal(await notes.getAttribute('aria-invalid'), 'true')
        await forward(page); await panel(page, 0)
        const state = await (await context.request.get(`${fixture.base}/__fixture/state`)).json()
        assert.equal(state.calls.filter(call => call.command === 'save').length, 0)
      }
      const value = '김지미\nPlease keep these details.\tAccess after 9 am.'
      await notes.fill(value); await notes.press('Tab'); await forward(page); await panel(page, 1)
      const state = await (await context.request.get(`${fixture.base}/__fixture/state`)).json()
      assert.equal(state.requests[0].payload.contact.details, value)
    })
    await scenario('legacy contact and hidden service errors recover together; discard clears an existing inline error', { width: 1280, height: 800 }, async (page, context, overlay) => {
      await saveContact(page); await saveCabinets(page)
      // Read-only overlay models an old stored row. The correction below goes
      // through the real save API and PGlite rather than the synthetic overlay.
      overlay.flags.legacyInvalidFields = true
      await context.route(`${fixture.base}/api/quote/requests`, async route => {
        if (route.request().method() !== 'GET') return route.continue()
        const response = await route.fetch(), body = await response.json()
        return route.fulfill({ response, json: { ...body, request: overlay.legacyRequest(body.request) } })
      })
      await reloadQuote(page); await panel(page, 2)
      const saves = []
      page.on('request', request => { if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/quote/requests') saves.push(request.postData()) })
      await (await quoteProgressButton(page, 1)).click(); await panel(page, 1)
      await forward(page); await panel(page, 0)
      const phone = page.locator('#live-phone')
      assert.equal(await phone.inputValue(), '+1 202 555 0123')
      await page.waitForFunction(() => document.activeElement?.id === 'live-phone')
      assert.equal(saves.length, 0)
      await phone.fill('0491 570 159'); await forward(page); await panel(page, 1)
      const material = page.locator('#live-material')
      assert.equal(await material.inputValue(), '<b>Old oak</b>')
      assert.equal(await material.getAttribute('aria-invalid'), 'true')
      await page.waitForFunction(() => document.activeElement?.id === 'live-material')
      assert.equal(saves.length, 0)
      await material.fill('Corrected oak')
      overlay.flags.legacyInvalidFields = false
      await forward(page); await panel(page, 2)
      const state = await (await context.request.get(`${fixture.base}/__fixture/state`)).json()
      assert.equal(saves.length, 1)
      assert.equal(state.requests[0].payload.contact.phone, '0491 570 159')
      assert.equal(state.requests[0].payload.service.material, 'Corrected oak')
      await (await quoteProgressButton(page, 0)).click(); await panel(page, 0)
      await phone.fill('call Lisa'); await phone.press('Tab')
      assert.equal(await phone.getAttribute('aria-invalid'), 'true')
      await page.getByRole('button', { name: 'Discard changes', exact: true }).click()
      assert.equal(await phone.inputValue(), '0491 570 159')
      assert.notEqual(await phone.getAttribute('aria-invalid'), 'true')
      assert.equal(await page.locator('#live-phone-validation-error').count(), 0)
    })
    await scenario('contact lost response retries same save; service and back preserve fields', { width: 1280, height: 800 }, async (page, context) => {
      await context.request.post(`${fixture.base}/__fixture/control`, { data: { loseNextSaveResponse: true } })
      await fillContact(page); await forward(page)
      await page.getByRole('button', { name: /Try saving again/ }).click(); await panel(page, 1)
      const state = await (await context.request.get(`${fixture.base}/__fixture/state`)).json(), saves = state.calls.filter(call => call.command === 'save')
      assert.equal(state.requests.length, 1); assert.equal(saves.length, 2); assert.equal(saves[0].idempotencyKey, saves[1].idempotencyKey)
      await saveCabinets(page); await quoteViewport(page)
      await page.locator('[data-quote-back]:visible').click(); await panel(page, 1)
      assert.equal(await page.getByRole('radio', { name: /Full cabinet repainting/ }).isChecked(), true)
      await page.locator('[data-quote-back]:visible').click(); await panel(page, 0)
      assert.equal(await page.getByLabel(/Your name|Full name/).first().inputValue(), contact.name)
      assert.equal(await page.locator('#live-site').inputValue(), contact.siteAddress)
      await page.screenshot({ path: '/tmp/quote-one-page-desktop.png' })
    })
    await scenario('320px keyboard, long details, one active panel and visible fixed actions', { width: 320, height: 568 }, async page => {
      await fillContact(page)
      await page.getByText('Add project notes', { exact: false }).click()
      const details = page.locator('#quote-details-form textarea')
      const longNote = 'A long retained project note. '.repeat(70).trim()
      await details.fill(longNote); await details.press('Tab')
      await quoteViewport(page); await forward(page); await panel(page, 1)
      await page.locator('[data-quote-back]:visible').click(); await panel(page, 0)
      await page.getByText('Add project notes', { exact: false }).click()
      assert.equal(await details.inputValue(), longNote)
      await quoteViewport(page)
      await page.screenshot({ path: '/tmp/quote-one-page-mobile.png' })
    })
    await scenario('409 preserves unsaved entries and access loss clears private view', { width: 1280, height: 800 }, async (page, context, overlay) => {
      await saveContact(page)
      await page.locator('[data-quote-back]:visible').click(); await panel(page, 0)
      await page.getByLabel(/Your name|Full name/).first().fill('Unsaved correction')
      await context.request.post(`${fixture.base}/__fixture/control`, { data: { conflictNextSave: true } }); await forward(page)
      await page.getByRole('button', { name: /Load latest saved details/ }).waitFor()
      assert.equal(await page.getByLabel(/Your name|Full name/).first().inputValue(), 'Unsaved correction')
      await page.getByRole('button', { name: /Load latest saved details/ }).click(); await panel(page, 1)
      overlay.flags.accessStatus = 401
      await context.request.post(`${fixture.base}/__fixture/control`, { data: { customerAccessStatus: 401 } }); await reloadQuote(page)
      await page.getByText(/private access has ended|writing access ended|Synthetic customer access ended/).first().waitFor()
      assert.equal(await page.locator('input[name="booking-signature-name"]:visible').count(), 0)
    })
    await scenario('queued/running/stale/failed/uncertain keep photo work and recovery controls', { width: 1280, height: 800 }, async (page, context, overlay) => {
      await saveContact(page); await saveCabinets(page)
      await page.getByRole('button', { name: 'Ask the team to review instead', exact: true }).click(); await panel(page, 3)
      assert.equal(await page.getByRole('button', { name: 'Ask our team to review', exact: true }).isEnabled(), true)
      assert.equal(await page.locator('[data-quote-next]:visible').isEnabled(), false, 'A missing numeric estimate must block date selection')
      overlay.flags.analysisStatus = 'queued'; await reloadQuote(page); await panel(page, 2)
      await page.getByText('Your analysis is queued', { exact: true }).waitFor()
      assert.equal(await page.locator('[data-quote-next]:visible').filter({ hasText: /^Analysing photos…$/ }).isEnabled(), false)
      overlay.flags.analysisStatus = 'running'; await reloadQuote(page); await panel(page, 2)
      await page.getByText('AI is reviewing your cabinets…', { exact: true }).waitFor()
      assert.equal(await page.locator('[data-quote-next]:visible').innerText(), 'Analysing photos…')
      assert.equal(await page.locator('[data-quote-next]:visible').isDisabled(), true)
      assert.equal(await page.locator('input[name="booking-signature-name"]:visible').count(), 0)
      overlay.flags.analysisStatus = 'succeeded'; overlay.flags.stale = true; await reloadQuote(page); await panel(page, 2)
      await page.getByText('Earlier photo assessment — details changed', { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Continue to sign', exact: true }).count(), 0)
      for (const [status, text] of [['failed', 'Your analysis could not be completed'], ['uncertain', 'Let’s check your analysis status']]) {
        overlay.flags.analysisStatus = status; overlay.flags.stale = false; await reloadQuote(page); await panel(page, 2)
        await page.getByText(text, { exact: true }).waitFor()
        await page.locator('[data-quote-next]:visible').getByText('Try a new photo analysis', { exact: true }).waitFor()
        assert.equal(await page.getByRole('button', { name: 'Check saved status', exact: true }).isEnabled(), true)
        assert.equal(await page.getByRole('img', { name: /uploaded for this request/ }).count(), 1)
        await page.getByRole('button', { name: 'Ask the team to review instead', exact: true }).click(); await panel(page, 3)
        assert.equal(await page.getByRole('button', { name: 'Ask our team to review', exact: true }).isEnabled(), true)
        assert.equal(await page.locator('[data-quote-next]:visible').isEnabled(), false)
      }
      await quoteViewport(page)
    })
    await scenario('late hidden photo read cannot erase unsaved contact edits', { width: 1280, height: 800 }, async (page, context, overlay) => {
      await saveContact(page); await saveCabinets(page)
      overlay.flags.analysisDelayMs = 1200
      const lateRead = page.waitForResponse(response => new URL(response.url()).pathname === '/api/quote/requests/analysis')
      await reloadQuote(page); await panel(page, 2)
      await (await quoteProgressButton(page, 0)).click(); await panel(page, 0)
      await page.getByLabel(/Your name|Full name/).first().fill('Unsaved contact correction')
      await lateRead; await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal(await page.getByLabel(/Your name|Full name/).first().inputValue(), 'Unsaved contact correction')
      assert.equal(await (await quoteProgressButton(page, 2)).isEnabled(), false, 'Unsaved edits must be saved before opening analysis or booking')
      await quoteViewport(page)
    })
    await scenario('booking email verification binds the new quote once and never opens an older quote for the same email', { width: 1280, height: 800 }, async (page, context, overlay) => {
      overlay.flags.includeOlderOnVerify = true
      await saveContact(page); await saveCabinets(page)
      assert.equal(overlay.customerSends.length, 0); assert.equal(overlay.customerVerifies.length, 0)
      await readyVisit(page, overlay)
      assert.equal(await page.locator('input[name="customer-email"]:visible').count(), 0)
      assert.equal(await page.locator('input[name="booking-saved-email"]').inputValue(), contact.email)
      assert.equal(await page.locator('input[name="booking-saved-email"]').getAttribute('readonly'), '')
      await page.screenshot({ path: '/tmp/quote-booking-email-desktop.png' })
      const before = await (await context.request.get(`${fixture.base}/__fixture/state`)).json(), quote = before.requests[0]
      await verifyBookingEmail(page)
      await page.getByRole('button', { name: /available to request only/ }).first().waitFor()
      assert.equal(overlay.customerSends.length, 1); assert.equal(overlay.customerVerifies.length, 1)
      assert.deepEqual(overlay.customerSends[0], { email: contact.email, requestId: quote.id, expectedRevision: quote.revision })
      const state = await (await context.request.get(`${fixture.base}/__fixture/state`)).json()
      assert.equal(state.requests[0].id, quote.id); assert.equal(state.requests[0].revision, quote.revision)
      assert.equal(await page.locator('.lq-project-summary').innerText().then(text => text.includes(quote.reference)), true)
      assert.equal(await page.getByRole('heading', { name: 'Pick a visit', exact: true }).count(), 1)
      assert.equal(await page.getByText(/Your photo estimate is ready/).count() > 0, true)
      assert.equal(overlay.syntheticCalls.filter(call => call.path.endsWith('/customer/select')).length, 0)
      await page.getByRole('button', { name: 'Back to estimate', exact: true }).click(); await panel(page, 3)
      await forward(page); await panel(page, 4)
      await page.getByRole('button', { name: /available to request only/ }).first().waitFor()
      assert.equal(overlay.customerSends.length, 1); assert.equal(overlay.customerVerifies.length, 1)
    })
    await scenario('a current linked valid email session skips OTP; generic unlinked access needs one bound challenge', { width: 1280, height: 800 }, async (page, context, overlay) => {
      await saveContact(page); await saveCabinets(page)
      overlay.flags.verified = true; await readyVisit(page, overlay)
      await page.getByRole('button', { name: /available to request only/ }).first().waitFor()
      assert.equal(overlay.customerSends.length, 0); assert.equal(overlay.customerVerifies.length, 0)
      await page.getByRole('button', { name: 'Back to estimate', exact: true }).click(); await panel(page, 3)
      await forward(page); await panel(page, 4)
      await page.getByRole('button', { name: /available to request only/ }).first().waitFor()
      assert.equal(overlay.customerSends.length, 0)
      overlay.flags.accessMode = 'unlinked'
      await (await quoteEntryAction(page, 'View quotes & bookings')).click()
      await page.getByText('No quotes have been linked', { exact: false }).waitFor()
      await page.getByRole('button', { name: 'Back to quote', exact: true }).last().click(); await panel(page, 4)
      await verifyBookingEmail(page)
      await page.getByRole('button', { name: /available to request only/ }).first().waitFor()
      assert.equal(overlay.customerSends.length, 1); assert.equal(overlay.customerVerifies.length, 1)
    })
    await scenario('a verify response for another quote preserves the current quote and reports an error', { width: 1280, height: 800 }, async (page, context, overlay) => {
      await saveContact(page); await saveCabinets(page); await readyVisit(page, overlay)
      const quote = (await (await context.request.get(`${fixture.base}/__fixture/state`)).json()).requests[0]
      overlay.flags.verifyDifferentRequest = true; await verifyBookingEmail(page)
      await page.getByText('The code did not confirm access to this quote.', { exact: false }).waitFor()
      assert.equal(await page.getByRole('heading', { name: 'Pick a visit', exact: true }).count(), 1)
      assert.ok((await page.locator('.lq-project-summary').innerText()).includes(quote.reference))
      assert.equal(await page.getByRole('button', { name: /available to request only/ }).count(), 0)
      assert.equal(overlay.syntheticCalls.filter(call => call.path.endsWith('/customer/select')).length, 0)
    })
    await scenario('late booking verify is ignored after management opens; cross-tab changes preserve dirty entries until explicit continuation', { width: 1280, height: 800 }, async (page, context, overlay) => {
      await saveContact(page); await saveCabinets(page); await readyVisit(page, overlay)
      overlay.flags.verifyDelayMs = 500; overlay.flags.verifyDifferentRequest = true
      const response = page.waitForResponse(item => new URL(item.url()).pathname.endsWith('/customer/verify'))
      await verifyBookingEmail(page)
      await (await quoteEntryAction(page, 'View quotes & bookings')).click()
      await response; await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal(await page.locator('input[name="customer-email"]:visible').count(), 1)
      assert.equal(await page.getByText('The code did not confirm access', { exact: false }).count(), 0)
      await page.getByRole('button', { name: 'Back to quote', exact: true }).last().click(); await panel(page, 4)
      await page.getByRole('button', { name: 'Back to estimate', exact: true }).click(); await panel(page, 3)
      await (await quoteProgressButton(page, 0)).click(); await panel(page, 0)
      const name = page.locator('#live-name'); await name.fill('Unsaved current quote correction')
      overlay.flags.accessMode = 'other-linked'; await accessBroadcast(page)
      await page.getByText('Another saved quote is active', { exact: false }).first().waitFor()
      assert.equal(await name.inputValue(), 'Unsaved current quote correction')
      assert.equal(await page.locator('[data-quote-step="0"]:visible').count(), 1)
      assert.equal(await page.locator('[data-quote-next]:visible').isEnabled(), false)
      await (await quoteEntryAction(page, 'View quotes & bookings')).click()
      await page.getByRole('button', { name: 'Continue this quote', exact: true }).click()
      await page.getByText('You are continuing this quote.', { exact: false }).waitFor()
      const savesBeforeClosing = (await (await context.request.get(`${fixture.base}/__fixture/state`)).json()).calls.filter(call => call.command === 'save').length
      await page.getByRole('button', { name: 'Back to quote', exact: true }).last().click(); await panel(page, 0)
      assert.equal((await (await context.request.get(`${fixture.base}/__fixture/state`)).json()).calls.filter(call => call.command === 'save').length, savesBeforeClosing, 'Closing management must not submit the quote form')
      assert.equal(await name.inputValue(), 'Unsaved current quote correction')
      await page.waitForFunction(() => { const next = document.querySelector('[data-quote-next]'); return next && !next.disabled })
      assert.equal(await page.locator('[data-quote-next]:visible').isEnabled(), true)
      await forward(page); await panel(page, 1)
      assert.equal((await (await context.request.get(`${fixture.base}/__fixture/state`)).json()).requests[0].payload.contact.name, 'Unsaved current quote correction')
    })
    await scenario('a cross-tab notification preserves an unsaved first-step form and permits explicit local discard', { width: 1280, height: 800 }, async (page, context, overlay) => {
      await fillContact(page); await accessBroadcast(page)
      await page.getByText('Another saved quote is active', { exact: false }).first().waitFor()
      assert.equal(await page.locator('#live-name').inputValue(), contact.name)
      assert.equal(await page.locator('#live-email').inputValue(), contact.email)
      assert.equal(await page.locator('[data-quote-step="0"]:visible').count(), 1)
      assert.equal(await page.locator('[data-quote-next]:visible').isEnabled(), false)
      assert.equal((await (await context.request.get(`${fixture.base}/__fixture/state`)).json()).requests.length, 0)
      await page.getByRole('button', { name: 'Discard changes', exact: true }).click()
      assert.equal(await page.locator('#live-name').inputValue(), '')
      assert.equal(await page.locator('[data-quote-next]:visible').isEnabled(), true)
      assert.equal(overlay.customerSends.length, 0)
    })
    await scenario('cross-tab access recovery preserves a pending booking payload and retries the same date command', { width: 1280, height: 800 }, async (page, context, overlay) => {
      await saveContact(page); await saveCabinets(page)
      overlay.flags.verified = true; await readyVisit(page, overlay)
      await page.getByRole('button', { name: /available to request only/ }).first().click()
      await page.locator('input[name="booking-preferred-time"]').fill('10:30')
      overlay.flags.bookingDateDelayMs = 500
      const delayed = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/booking/date'))
      const started = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/booking/date'))
      await page.getByRole('button', { name: 'Continue to sign', exact: true }).click(); await started
      overlay.flags.accessMode = 'other-linked'; await accessBroadcast(page)
      await page.getByText('Another saved quote is active', { exact: false }).first().waitFor()
      await delayed
      await page.getByRole('button', { name: 'Continue this quote', exact: true }).click()
      await page.getByText('You are continuing this quote.', { exact: false }).waitFor()
      overlay.flags.bookingDateDelayMs = 0
      await page.getByRole('button', { name: 'Retry same request', exact: true }).click(); await panel(page, 5)
      assert.equal(overlay.bookingDateAttempts.length, 2)
      assert.equal(overlay.bookingDateAttempts[0], overlay.bookingDateAttempts[1])
      await page.locator('input[name="booking-signature-name"]').waitFor()
      await page.getByRole('button', { name: 'Change visit', exact: true }).click(); await panel(page, 4)
      await page.locator('input[name="booking-preferred-time"]').fill('11:00')
      const reviewCount = overlay.bookingReviewAttempts.length
      overlay.flags.bookingReviewDelayMs = 500
      const reviewStarted = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/booking/review'))
      const reviewDelayed = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/booking/review'))
      await page.getByRole('button', { name: 'Continue to sign', exact: true }).click(); await reviewStarted
      overlay.flags.accessMode = 'other-linked'; await accessBroadcast(page)
      await page.getByText('Another saved quote is active', { exact: false }).first().waitFor(); await reviewDelayed
      await page.getByRole('button', { name: 'Continue this quote', exact: true }).click()
      await page.getByText('You are continuing this quote.', { exact: false }).waitFor()
      overlay.flags.bookingReviewDelayMs = 0
      await page.getByRole('button', { name: 'Retry same request', exact: true }).click(); await panel(page, 5)
      await page.locator('input[name="booking-signature-name"]').waitFor()
      assert.equal(overlay.bookingReviewAttempts.length, reviewCount + 2)
      assert.equal(overlay.bookingReviewAttempts.at(-2), overlay.bookingReviewAttempts.at(-1))
      assert.equal(overlay.customerSends.length, 0); assert.equal(overlay.customerVerifies.length, 0)
    })
    await scenario('explicit management selection restores the chosen linked quote after a delayed private read', { width: 1280, height: 800 }, async (page, context, overlay) => {
      await saveContact(page); await saveCabinets(page)
      const original = (await (await context.request.get(`${fixture.base}/__fixture/state`)).json()).requests[0]
      overlay.flags.verified = true; overlay.flags.accessMode = 'other'
      await context.route(`${fixture.base}/api/quote/requests`, async route => {
        if (route.request().method() !== 'GET' || route.request().headers()['x-lk-quote-request-id'] !== overlay.olderId) return route.continue()
        await new Promise(resolve => setTimeout(resolve, 75))
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ request: { ...original, id: overlay.olderId, reference: 'RQ-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', payload: { ...original.payload, contact: { ...original.payload.contact, name: 'Older linked customer' } } } }) })
      })
      await (await quoteEntryAction(page, 'View quotes & bookings')).click()
      await page.locator('.lq-customer-list').getByRole('button', { name: 'Open saved quote', exact: true }).click()
      await panel(page, 2)
      assert.ok((await page.locator('.lq-project-summary').innerText()).includes('Older linked customer'))
      assert.ok((await page.locator('.lq-project-summary').innerText()).includes('RQ-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'))
    })
    await scenario('photo estimate, date, typed signature, lost-submit retry and reload receipt', { width: 393, height: 852 }, async (page, context, overlay) => {
      await saveContact(page); await saveCabinets(page)
      await page.locator('[data-quote-next]:visible').and(page.getByRole('button', { name: 'Get my photo estimate', exact: true })).waitFor()
      assert.equal(await page.locator('[data-quote-next]:visible').isDisabled(), true, 'AI consent is required before analysis')
      await page.getByRole('checkbox', { name: /agree to sending these photos/ }).check()
      await page.locator('[data-quote-next]:visible').filter({ hasText: /^Get my photo estimate$/ }).click()
      await page.getByText(/Your photo estimate is ready/).waitFor()
      assert.equal(await page.locator('[data-quote-next]:visible').innerText(), 'Review estimate')
      await page.screenshot({ path: '/tmp/quote-one-page-photos.png' })
      await forward(page); await panel(page, 3); await quoteViewport(page)
      await page.screenshot({ path: '/tmp/quote-one-page-estimate.png' })
      await forward(page); await panel(page, 4)
      await page.getByRole('button', { name: 'Send verification code', exact: true }).click()
      await page.locator('input[name="customer-code"]').waitFor()
      await page.screenshot({ path: '/tmp/quote-booking-email-mobile.png' })
      overlay.flags.bookingReadFailure = true
      await page.locator('input[name="customer-code"]').fill('123456'); await page.getByRole('button', { name: 'Verify code', exact: true }).click()
      await panel(page, 4) // Email verification returns to the same visit step.
      await page.getByText('Synthetic initial booking read unavailable.', { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Back to estimate', exact: true }).isEnabled(), true, 'A failed initial read must not lock navigation')
      overlay.flags.bookingReadFailure = false
      await page.getByRole('button', { name: 'Check saved request status', exact: true }).first().click()
      const date = page.getByRole('button', { name: /available to request only/ }).first(); await date.click()
      await page.getByText('Your preferred door-removal visit', { exact: true }).waitFor()
      await page.getByLabel('Door-removal time (Sydney) *', { exact: true }).fill('10:30')
      await page.getByText('Selected door-removal visit:', { exact: false }).waitFor()
      await page.screenshot({ path: '/tmp/quote-one-page-date.png' })
      await page.getByRole('button', { name: 'Continue to sign', exact: true }).click(); await panel(page, 5)
      await page.getByText('Door-removal date and time:', { exact: false }).waitFor()
      await page.locator('input[name="booking-signature-name"]').fill(contact.name)
      await page.getByRole('radio', { name: /Use my typed full name/ }).check(); await page.locator('input[name="booking-acknowledged"]').check()
      await page.getByRole('radio', { name: 'Draw signature', exact: true }).check()
      const pad = page.locator('canvas:visible')
      await pad.press('Space'); await pad.press('ArrowRight'); await pad.press('ArrowRight'); await pad.press('Enter')
      assert.equal(await page.getByRole('button', { name: 'Clear signature', exact: true }).isEnabled(), true)
      await page.getByRole('button', { name: 'Change visit', exact: true }).click(); await panel(page, 4)
      await page.locator('input[name="booking-preferred-time"]').fill('11:00')
      overlay.flags.reviewLifetimeMs = 1200
      await page.getByRole('button', { name: 'Continue to sign', exact: true }).click(); await panel(page, 5)
      assert.equal(await page.locator('input[name="booking-signature-name"]').inputValue(), '')
      assert.equal(await page.locator('input[name="booking-acknowledged"]').isChecked(), false)
      assert.equal(await page.getByRole('button', { name: 'Clear signature', exact: true }).isEnabled(), false, 'Changing the saved visit must clear drawn strokes')
      await panel(page, 4) // The active short-lived review expires back to the date step.
      await page.getByRole('button', { name: 'Continue to sign', exact: true }).click(); await panel(page, 5)
      await page.getByRole('button', { name: 'Change visit', exact: true }).click(); await panel(page, 4)
      await page.getByRole('button', { name: 'Back to estimate', exact: true }).click(); await panel(page, 3)
      await page.waitForTimeout(1400) // Exercise expiry while its signing panel is inactive.
      await panel(page, 3)
      overlay.flags.reviewLifetimeMs = 600_000
      await forward(page); await panel(page, 4)
      await page.getByRole('button', { name: 'Continue to sign', exact: true }).click(); await panel(page, 5)
      await page.getByText('Door-removal date and time:', { exact: false }).waitFor()
      await page.locator('input[name="booking-signature-name"]').fill(contact.name)
      await page.getByRole('radio', { name: /Use my typed full name/ }).check(); await page.locator('input[name="booking-acknowledged"]').check()
      await page.screenshot({ path: '/tmp/quote-one-page-sign.png' })
      overlay.flags.submitLoss = true
      await page.getByRole('button', { name: 'Submit booking request', exact: true }).click()
      await page.getByRole('button', { name: 'Retry same request', exact: true }).click(); await panel(page, 6)
      assert.equal(overlay.submitAttempts.length, 2); assert.equal(overlay.submitAttempts[0], overlay.submitAttempts[1])
      assert.equal(new Set(overlay.reviewProofs).size, overlay.reviewProofs.length)
      assert.equal(overlay.submission.signature.method, 'typed'); assert.equal(overlay.submission.preferredTime, '11:00')
      await reloadQuote(page); await panel(page, 6); await quoteViewport(page)
      const highlights = page.locator('.lq-receipt-highlights')
      await highlights.getByText('Requested door-removal visit', { exact: true }).waitFor()
      assert.equal(await highlights.locator(':scope > div').count(), 3)
      assert.equal(await highlights.locator('strong').first().innerText(), formatQuoteAmount(overlay.submission.snapshot.pricing.total))
      assert.ok((await highlights.innerText()).includes(overlay.submission.reference))
      assert.ok((await highlights.innerText()).includes(overlay.submission.preferredTime))
      const receiptDetails = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Receipt and delivery details' }) })
      assert.equal(await receiptDetails.evaluate(element => element.open), false)
      await receiptDetails.locator('summary').click()
      assert.ok((await receiptDetails.innerText()).includes(overlay.submission.signature.name))
      await receiptDetails.locator('summary').click(); await quoteViewport(page)
      await page.locator('[data-quote-viewport]').evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' }))
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
      await page.screenshot({ path: '/tmp/quote-one-page-complete.png' })
      assert.equal(await page.locator('input[name="booking-signature-name"]:visible').count(), 0)
      const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download saved receipt PDF', exact: true }).click()
      assert.equal((await download).suggestedFilename(), 'REQUEST-SYNTHETIC.pdf')
      // Explicit management verification restores this submitted quote after a
      // delayed read, rather than leaving it locked on the hidden photo stage.
      overlay.flags.verified = false
      await context.route(`${fixture.base}/api/quote/requests`, async route => {
        if (route.request().method() !== 'GET' || !route.request().headers()['x-lk-quote-request-id']) return route.continue()
        await new Promise(resolve => setTimeout(resolve, 75))
        if (route.request().headers()['x-lk-quote-request-id'] === overlay.olderId && overlay.flags.olderRequest) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ request: overlay.flags.olderRequest }) })
        const response = await route.fetch(); return route.fulfill({ response })
      })
      await (await quoteEntryAction(page, 'View quotes & bookings')).click()
      await page.getByRole('button', { name: 'Verify email and keep this quote', exact: true }).click()
      await page.locator('input[name="customer-code"]').fill('123456'); await page.getByRole('button', { name: 'Verify code', exact: true }).click()
      await page.locator('.lq-customer-list').getByRole('button', { name: 'Open saved quote', exact: true }).click()
      await panel(page, 6)
      assert.ok((await page.locator('.lq-receipt-highlights').innerText()).includes('REQUEST-SYNTHETIC'))
      const primary = (await (await context.request.get(`${fixture.base}/__fixture/state`)).json()).requests[0]
      overlay.flags.primaryRequest = primary
      overlay.flags.olderRequest = { ...primary, id: overlay.olderId, reference: 'RQ-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', payload: { ...primary.payload, contact: { ...primary.payload.contact, name: 'Earlier submitted customer' } } }
      overlay.flags.accessMode = 'other-linked'
      await (await quoteEntryAction(page, 'View quotes & bookings')).click()
      await page.locator('.lq-customer-list li').filter({ hasText: 'RQ-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }).getByRole('button', { name: 'Open saved quote', exact: true }).click()
      await panel(page, 6)
      await page.getByText('REQUEST-SYNTHETIC-OLDER', { exact: true }).first().waitFor()
      assert.ok((await page.locator('.lq-project-summary').innerText()).includes('Earlier submitted customer'))
      // An A receipt read delayed across explicit management switching to B must
      // never replace B's current request or reopen A after the switch.
      overlay.flags.bookingReadDelayMs = 700
      const oldRead = Promise.race([page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/booking') && response.request().headers()['x-lk-quote-request-id'] === overlay.olderId), page.waitForEvent('requestfailed', { predicate: request => new URL(request.url()).pathname.endsWith('/booking') && request.headers()['x-lk-quote-request-id'] === overlay.olderId })])
      await page.getByRole('button', { name: 'Refresh receipt status', exact: true }).click()
      overlay.flags.accessMode = 'linked-with-older'; await accessBroadcast(page)
      await page.getByText('Another saved quote is active', { exact: false }).first().waitFor()
      await (await quoteEntryAction(page, 'View quotes & bookings')).click()
      await page.locator('.lq-customer-list li').filter({ hasText: primary.reference }).getByRole('button', { name: 'Open saved quote', exact: true }).click()
      await panel(page, 6); await oldRead
      assert.ok((await page.locator('.lq-project-summary').innerText()).includes(primary.reference))
      assert.ok((await page.locator('.lq-receipt-highlights').innerText()).includes('REQUEST-SYNTHETIC'))
      assert.equal(await page.getByText('REQUEST-SYNTHETIC-OLDER', { exact: true }).count(), 0)
    })
    assert.deepEqual(consoleErrors, [], 'No browser runtime errors')
    return { synthetic: true, checks, consoleErrors, google: 'Real Google autocomplete not executed; this fixture permits local origins only', production: 'No production API, AI, email or Google calls' }
  } finally { await browser.close(); await fixture.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await verifyQuoteJourney({ upstream: process.env.QUOTE_UI_UPSTREAM ?? 'http://127.0.0.1:3002', port: Number(process.env.QUOTE_UI_FIXTURE_PORT ?? 3017) }), null, 2)) }
  catch (error) { console.error(error); process.exitCode = 1 }
}
