// Real loopback UI and PGlite quote save/read; synthetic media/auth/booking.
// All APIs stay inside this fixture. No company DB, AI, email or Google calls.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { quoteEntryAction } from './verify-quote-journey-ui.mjs'
import { createLiveQuoteFixture } from './verify-live-quote-fixture.mjs'
import { PHOTO_ROLES, PHOTO_ANALYSIS_SCHEMA_VERSION, validatePhotoAnalysis } from '../src/modules/quotes/domain/analysis.ts'
import { calculateEstimatePricing, calculatePreviousEstimatePricing, calculateLegacyEstimatePricing } from '../src/modules/quotes/domain/pricing.ts'
import { BOOKING_ACKNOWLEDGMENT_VERSION, bookingAcknowledgment, validateBookingSignature } from '../src/modules/quotes/domain/booking-flow.ts'
import { parsePhotoWorkspace } from '../src/modules/quotes/presentation/photo-workspace-client.ts'
import { formatQuoteAmount } from '../src/modules/quotes/presentation/quote-money.ts'
import { bookingMonthDates, shiftBookingMonth, sydneyToday, parseBookingState } from '../src/modules/quotes/presentation/booking-flow-client.ts'
import { COMPANY_BOOKING_ACK_VERSION, COMPANY_BOOKING_ACK_TEXT, COMPANY_BOOKING_SITE_DAMAGE_NOTE } from '../src/modules/bookings/domain/live-contracts.ts'
import { parseCompanyState } from '../src/modules/bookings/presentation/live-booking-client.ts'
import { companyClaim } from '../src/modules/bookings/live-test-data.mts'
import { validateReceiptSource } from '../src/modules/quotes/infrastructure/booking-receipt.ts'
import { sydneyLocalToInstant } from '../src/modules/operations/domain/validation.ts'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const out = pathToFileURL(resolve(repoRoot, process.env.QUOTE_UI_SHOT_DIR ?? 'docs/verification/2026-10-14-no-gst-pricing/') + '/')
mkdirSync(out, { recursive: true })
const photoId = '205f3d74-69e5-4cbe-b4b4-31d4a382cfad', jobId = '7332878e-3cb6-4986-a579-865b0244bce7'
const now = () => new Date().toISOString(), future = () => new Date(Date.now() + 600_000).toISOString()
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=', 'base64')
const contact = { name: 'Synthetic GST Customer', email: 'gst-ui@example.invalid', siteAddress: '12A Example Road', suburb: 'Ermington', postcode: '2115' }
const money = cents => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100)
const require = createRequire(import.meta.url)
let playwright
try { playwright = require('playwright') } catch { playwright = require(`${process.env.QUOTE_UI_RUNTIME_PACKAGES ?? '/Users/jimee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'}/playwright`) }

async function overlayFor(context, base, variant, counts) {
  let verified = false, analysed = false, approval = null, submission = null, selectedId = null
  const denied = [], failures = [], commands = []
  const archivedClaim = companyClaim()
  let originalRequest = null
  async function quote() {
    const state = await (await context.request.get(`${base}/__fixture/state`)).json()
    const request = state.requests.find(row => row.id === selectedId) ?? state.requests.at(-1)
    if (!request) return null
    if (variant !== 'new') {
      if (request.payload.service) originalRequest ??= { ...request, pricingVersion: variant === 'v1' ? null : undefined }
      return originalRequest ?? request
    }
    return request
  }
  function workspace(request) {
    const service = request.payload.service
    const photos = [{ id: photoId, requestId: request.id, role: 'overview', state: 'ready', mimeType: 'image/png', sizeBytes: png.length, storedBytes: png.length, contentHash: 'ab'.repeat(32), width: 1, height: 1, createdAt: now(), expiresAt: future(), contentUrl: `/api/quote/requests/photos/${photoId}/content` }]
    let analysis = null, pricing = null
    if (analysed && service) {
      const quantity = (count, customer) => ({ customer, observed: count, estimated: count, needsConfirmation: variant !== 'v1', basisPhotoIds: [photoId], confidence: 'high', note: 'Synthetic visible fronts; confirm on site.' })
      analysis = validatePhotoAnalysis({ summary: 'Synthetic cabinet fronts are visible.', outcome: variant === 'v1' ? 'analysis_ready' : 'site_review_required', photoQuality: [{ photoId, usable: true, issues: [], retakeInstruction: null }], coverage: PHOTO_ROLES.map(role => ({ role, covered: true, photoIds: [photoId], note: 'Synthetic visible scope.' })), quantities: { doors: quantity(counts[0], service.doorCount), drawers: quantity(counts[1], service.drawerCount) }, observedDamage: [], proposedWork: [], unknowns: [], siteChecks: [], estimateScope: { status: 'estimable', extent: 'whole_project', anchorPhotoId: photoId, scopePhotoIds: [photoId], contextPhotoIds: [], conflictingPhotoIds: [], description: 'Synthetic cabinet fronts.', assumptions: ['Confirm on site.'] } }, { photoIds: [photoId], doorCount: service.doorCount, drawerCount: service.drawerCount, coverage: { upperNotApplicable: true, damageNotPresent: true }, schemaVersion: PHOTO_ANALYSIS_SCHEMA_VERSION })
      pricing = (variant === 'v1' ? calculateLegacyEstimatePricing : variant === 'v2' ? calculatePreviousEstimatePricing : calculateEstimatePricing)(analysis, service)
      assert.equal(pricing.total, variant === 'new' ? Math.max(145000, counts[0] * 15000 + counts[1] * 10000) : Math.max(150000, counts[0] * 15000 + counts[1] * 10000) * 1.1)
    }
    const latest = analysis ? { id: jobId, requestId: request.id, inputRevision: request.revision, status: 'succeeded', stale: false, createdAt: now(), completedAt: now(), attempts: 1, error: null, usage: null, analysis, pricing } : null
    return parsePhotoWorkspace({ request, photos, jobs: latest ? [latest] : [], latest }, request.id)
  }
  function booking(request) { return parseBookingState({ state: { requestId: request.id, verified, canEdit: !submission, approval, submission, acknowledgment: bookingAcknowledgment() } }, request.id, false) }
  function company(request) {
    if (!submission) return null
    if (submission.snapshot.version === BOOKING_ACKNOWLEDGMENT_VERSION) return parseCompanyState({ state: { requestId: request.id, revision: 1, canWrite: true, submission, proposal: archivedClaim.proposal, proposals: [archivedClaim.proposal], acceptance: archivedClaim.acceptance, booking: { ...archivedClaim.booking, status: 'confirmed', emailStatus: 'provider_accepted', receiptReady: true, confirmedAt: archivedClaim.proposal.createdAt }, acknowledgment: { version: COMPANY_BOOKING_ACK_VERSION, text: COMPANY_BOOKING_ACK_TEXT } } }, request.id)
    const source = submission.snapshot.pricing, date = submission.preferredDate
    const segment = (purpose, day, start, end) => ({ purpose, kind: 'timed', startDate: day, endDate: day, startLocal: `${day}T${start}`, endLocal: `${day}T${end}`, startAt: sydneyLocalToInstant(`${day}T${start}`), endAt: sydneyLocalToInstant(`${day}T${end}`) })
    const confirmationBasis = submission.snapshot.version === BOOKING_ACKNOWLEDGMENT_VERSION ? 'customer_proposal' : 'signed_request'
    const proposal = { id: 'synthetic-company-proposal', version: 1, revision: 1, status: 'published', hash: 'synthetic-preserved-proposal-hash', amountExGst: source.subtotal, gst: source.tax, total: source.total, currency: 'AUD', confirmationBasis, companyNote: COMPANY_BOOKING_SITE_DAMAGE_NOTE, scope: 'Saved signed painting scope.', adjustmentReason: '', segments: [segment('take_off', date, submission.preferredTime ?? '10:30', '12:00'), segment('install', new Date(Date.parse(`${date}T12:00:00Z`) + 2 * 86400000).toISOString().slice(0, 10), '10:00', '12:00')], calendarTarget: submission.snapshot.calendarTarget, createdAt: now(), publishedAt: now(), emailStatus: 'provider_accepted', receiptReady: true }
    return parseCompanyState({ state: { requestId: request.id, revision: 1, canWrite: true, submission, proposal, proposals: [proposal], acceptance: null, booking: { id: 'synthetic-confirmed-booking', proposalId: proposal.id, proposalHash: proposal.hash, version: 1, confirmationBasis: 'signed_request', signedSubmissionId: submission.id, status: 'confirmed', emailStatus: 'provider_accepted', error: null, events: [], confirmedAt: now(), receiptReady: true }, acknowledgment: { version: COMPANY_BOOKING_ACK_VERSION, text: COMPANY_BOOKING_ACK_TEXT } } }, request.id)
  }
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname
    if (url.origin !== base) { denied.push(url.origin); return route.abort('blockedbyclient') }
    if (path === '/') return route.fulfill({ status: 200, contentType: 'text/x-component', body: '' })
    if (path.endsWith('/customer/logout') && ['start-new', 'resume-browser-draft'].includes(req.postDataJSON()?.intent)) return route.continue()
    if (path === '/_next/image') return route.fulfill({ status: 200, contentType: 'image/png', body: readFileSync(new URL('../public/images/lk-group-logo-circle-transparent.png', import.meta.url)) })
    const staff = path.startsWith('/api/admin/quote-requests/')
    const synthetic = staff || path === '/api/admin/live-bookings' || path.startsWith('/api/quote/requests/customer') || path.startsWith('/api/quote/requests/analysis') || path.startsWith('/api/quote/requests/photos') || path.startsWith('/api/quote/requests/booking') || path.startsWith('/api/quote/requests/company-booking') || variant !== 'new' && path === '/api/quote/requests' && req.method() === 'GET'
    if (!synthetic) return route.continue()
    const reply = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    try {
      const request = await quote(), body = req.postDataJSON() ?? {}
      if (path.endsWith('/customer/send')) return reply({ sent: true, retryAfterSeconds: 0, expiresInSeconds: 600 })
      if (path.endsWith('/customer/verify')) { assert.equal(body.token, '123456'); verified = true }
      if (path.endsWith('/customer/select')) selectedId = body.requestId
      if (path.endsWith('/customer/logout')) { verified = false; return reply({ ready: true }) }
      if (path.includes('/customer')) return reply({ customer: verified && request ? { email: request.payload.contact.email, expiresAt: future() } : null, requests: verified && request ? [{ id: request.id, reference: request.reference, revision: request.revision, status: request.status, savedAt: request.savedAt }] : [], currentRequestId: verified && request ? request.id : null })
      if (!request) return reply({ request: null })
      if (path === '/api/admin/live-bookings') return reply(url.searchParams.has('requestId') ? { state: company(request) } : { states: [] })
      if (path === '/api/quote/requests' || staff && !/\/(analysis|booking|company-booking)$/.test(path)) return reply({ request, audit: [] })
      if (path.endsWith('/content')) return route.fulfill({ status: 200, contentType: 'image/png', body: png })
      if (path.includes('/analysis') || path.includes('/photos')) { if (req.method() === 'POST') analysed = true; return reply(workspace(request)) }
      if (path.includes('/company-booking')) return reply({ state: company(request) })
      if (path.endsWith('/availability')) { const month = url.searchParams.get('month'), today = sydneyToday(); return reply({ availability: { month, minMonth: today.slice(0, 7), maxMonth: shiftBookingMonth(today.slice(0, 7), 3), days: bookingMonthDates(month).map(date => ({ date, selectable: date > today })), revision: 'synthetic-calendar', checkedAt: now(), expiresAt: future(), accountSub: 'synthetic-company', calendarId: 'synthetic-calendar' } }) }
      if (path.endsWith('/approve')) {
        const current = workspace(request)
        const snapshot = { mode: 'live', kind: 'nonbinding_booking_request', version: bookingAcknowledgment().version, requestId: request.id, reference: request.reference, inputRevision: request.revision, analysisId: jobId, payload: request.payload, verifiedEmail: request.payload.contact.email, analysis: current.latest.analysis, pricing: current.latest.pricing, photos: current.photos, acknowledgment: bookingAcknowledgment(), calendarTarget: { accountSub: 'synthetic-company', calendarId: 'synthetic-calendar' } }
        approval = { id: randomUUID(), version: 1, analysisId: jobId, inputRevision: request.revision, approvedAt: now(), snapshot, snapshotHash: 'b'.repeat(64), stale: false, preferredDate: null, preferredTime: null, selectionRevision: 0, availabilityRevision: null }
      } else if (path.endsWith('/date')) approval = { ...approval, preferredDate: body.preferredDate, preferredTime: body.preferredTime, selectionRevision: approval.selectionRevision + 1, availabilityRevision: body.availabilityRevision }
      else if (path.endsWith('/review')) return reply({ review: { snapshot: { ...approval.snapshot, preferredDate: approval.preferredDate, preferredTime: approval.preferredTime }, snapshotHash: approval.snapshotHash, reviewProof: 'synthetic-review', expiresAt: future(), approvalId: approval.id, selectionRevision: approval.selectionRevision } })
      else if (path.endsWith('/submit')) { validateBookingSignature(body.signature); commands.push(body); submission = { id: randomUUID(), reference: 'REQUEST-GST-SYNTHETIC', requestId: request.id, approvalId: approval.id, submittedAt: now(), preferredDate: approval.preferredDate, preferredTime: approval.preferredTime, snapshot: { ...approval.snapshot, preferredDate: approval.preferredDate, preferredTime: approval.preferredTime }, snapshotHash: approval.snapshotHash, signedContentHash: 'c'.repeat(64), signature: body.signature, emailStatus: 'provider_accepted', calendarStatus: 'not_required', error: null, receiptReady: true, providerMessageId: 'synthetic-no-mail', calendarEventId: null }; validateReceiptSource(submission) }
      return reply({ state: booking(request) })
    } catch (error) { failures.push({ path, message: error.message }); return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: `Synthetic GST fixture: ${error.message}` }) }) }
  })
  return { denied, failures, commands, quote, workspace, get submission() { return submission }, seedArchivedAcknowledgment() {
    // Construct a historical read fixture, before preservation comparisons.
    const acknowledgment = bookingAcknowledgment(BOOKING_ACKNOWLEDGMENT_VERSION)
    submission = { ...submission, preferredTime: null, calendarStatus: 'synced', snapshot: { ...submission.snapshot, version: acknowledgment.version, acknowledgment, preferredTime: null } }
    validateReceiptSource(submission)
    approval = null
  } }
}

const fixture = await createLiveQuoteFixture({ upstream: process.env.GST_UI_UPSTREAM ?? 'http://127.0.0.1:3045', port: Number(process.env.GST_UI_PORT ?? 0), customerAuth: true })
const browser = await playwright.chromium.launch({ headless: true, channel: 'chrome' })
const checks = [], errors = [], layouts = []
async function layout(page, name) {
  const measure = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, height: innerHeight, scrollHeight: document.documentElement.scrollHeight, routeHeader: document.querySelector('.quote-route-header')?.getBoundingClientRect().right ?? null, actions: [...document.querySelectorAll('.lq-stage-actions button')].filter(el => el.getClientRects().length).map(el => ({ text: el.textContent.trim(), left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right })) }))
  assert.ok(measure.scrollWidth <= measure.width + 1, `${name}: horizontal overflow ${JSON.stringify(measure)}`)
  if (measure.routeHeader !== null) assert.ok(measure.routeHeader <= measure.width + 1)
  for (const button of measure.actions) assert.ok(button.left >= -1 && button.right <= measure.width + 1, `${name}: clipped action ${button.text}`)
  layouts.push({ name, ...measure })
  await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, out)) })
}
async function totalAt(page, selector, expected, variant, customer = false) {
  const box = page.locator(selector).filter({ visible: true }).first()
  await box.waitFor()
  const text = await box.innerText()
  if (customer) assert.ok(text.includes(formatQuoteAmount(expected)), `Expected ${formatQuoteAmount(expected)} in ${text}`)
  else assert.ok(text.includes(money(expected)) || expected % 100 === 0 && text.includes(money(expected).replace(/\.00$/, '')), `Expected ${money(expected)} in ${text}`)
  assert.match(text, variant === 'new' ? /No GST charged|GST not charged|Not charged/i : /GST/i)
  if (variant === 'new') assert.doesNotMatch(text, /including GST|incl GST|GST \(10%\)/i)
}
async function scenario(variant, counts, viewport, archived = false) {
  const name = `${variant}${archived ? '-ack1-restoration' : ''}-${counts.join('-')}-${viewport.width}`
  if (process.env.GST_UI_SCENARIO && !process.env.GST_UI_SCENARIO.split(',').some(filter => name.includes(filter))) return
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' })
  await context.request.post(`${fixture.base}/__fixture/control`, { data: { reset: true } })
  const overlay = await overlayFor(context, fixture.base, variant, counts), page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push({ name, message: error.message }))
  page.on('console', message => { if (message.type() === 'error') errors.push({ name, message: message.text() }) })
  page.on('response', response => { if (response.status() >= 400) console.error(`HTTP ${response.status()} ${new URL(response.url()).pathname}`) })
  const forward = () => page.locator('[data-quote-next]:visible').click()
  const step = n => page.locator(`[data-quote-step="${n}"]:visible`).waitFor()
  try {
    await page.goto(`${fixture.base}/quote/start?service=cabinet-painting&mode=live`)
    await page.getByRole('button', { name: 'Start a new quote', exact: true }).click()
    await step(0)
    if (variant === 'new' && viewport.width === 1280) { assert.match(await page.locator('body').innerText(), /1,450/); assert.match(await page.locator('body').innerText(), /No GST charged/i) }
    await page.locator('#live-name').fill(contact.name); await page.locator('#live-email').fill(contact.email)
    await page.locator('#live-site').fill(contact.siteAddress); await page.locator('#live-suburb').fill(contact.suburb); await page.locator('#live-postcode').fill(contact.postcode)
    await page.getByRole('checkbox', { name: /privately saving|saving these details/ }).check()
    await forward(); await step(1)
    await page.getByRole('radio', { name: /Full cabinet repainting/ }).check()
    await page.getByRole('checkbox', { name: /Cabinet doors/, exact: true }).check(); await page.getByRole('checkbox', { name: /Drawer fronts/, exact: true }).check()
    await page.getByRole('textbox', { name: /Cabinet doors/ }).fill(String(counts[0])); await page.getByRole('textbox', { name: /Drawer fronts/ }).fill(String(counts[1]))
    await forward(); await step(2)
    // Freeze an explicit historical saved request only after its service is saved.
    await overlay.quote()
    await page.getByRole('checkbox', { name: /agree to sending these photos/ }).check(); await page.locator('[data-quote-next]:visible').filter({ hasText: /^Get my photo estimate$/ }).click()
    await page.getByText(/Your photo estimate is ready/).waitFor()
    await forward(); await step(3)
    if (variant === 'v1') await page.getByText('View assessment and price breakdown', { exact: true }).click()
    const pricing = overlay.workspace(await overlay.quote()).latest.pricing, expected = pricing.total
    await totalAt(page, '[data-quote-step="3"]', expected, variant, true); await layout(page, `${name}-estimate`)
    {
      if (variant !== 'v1') await page.getByText('View assessment and price breakdown', { exact: true }).click()
      const table = page.locator('[data-quote-step="3"] .lq-price-table')
      await table.getByRole('row', { name: variant === 'new' ? 'GST Not charged' : 'GST (10%) A$150', exact: true }).waitFor()
      await layout(page, `${name}-price-breakdown`)
      await table.scrollIntoViewIfNeeded()
      await table.focus(); await page.keyboard.press('ArrowRight')
      assert.equal(await table.getAttribute('tabindex'), '0')
      const size = await table.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }))
      if (viewport.width < 700) assert.ok(size.scroll > size.client, 'Only the contained wide price table should scroll horizontally')
      await table.evaluate(el => { el.scrollLeft = el.scrollWidth })
      await table.locator('tfoot tr:last-child td').scrollIntoViewIfNeeded()
      const end = await table.locator('tfoot tr:last-child td').evaluate(el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, viewport: innerWidth }))
      assert.ok(end.left >= 0 && end.right <= end.viewport + 1, 'The total amount must be reachable at the right edge of the price table')
      await layout(page, `${name}-price-breakdown-right`)
      if (variant !== 'v1') await page.getByText('View assessment and price breakdown', { exact: true }).click()
    }
    if (variant === 'v1') {
      const preserved = JSON.stringify(pricing)
      await page.reload(); await (await quoteEntryAction(page, 'View quotes & bookings')).click()
      await page.getByRole('button', { name: 'Continue this browser draft', exact: true }).click(); await step(2)
      await forward(); await step(3); await page.getByText('View assessment and price breakdown', { exact: true }).click(); await totalAt(page, '[data-quote-step="3"]', expected, variant, true)
      await page.goto(`${fixture.base}/admin/quotes`); await page.getByRole('button', { name: /View request/ }).first().click()
      await page.locator('.lq-admin-detail').getByText('Estimated total (incl GST)', { exact: true }).waitFor()
      await totalAt(page, '.lq-admin-detail', expected, variant); await layout(page, `${name}-ems`)
      assert.equal(JSON.stringify(overlay.workspace(await overlay.quote()).latest.pricing), preserved)
      assert.deepEqual(overlay.failures, []); assert.deepEqual(overlay.denied, [])
      checks.push({ name, expectedTotalCents: expected, taxCents: pricing.tax, pricingVersion: pricing.pricingVersion, savedAnalysisPreserved: true, bookingNotApplicable: 'Historical pricing v1 has estimate_ready, not bookable provisional_estimate.', passed: true })
      console.log(`PASS ${name}`)
      return
    }
    await forward(); await page.getByRole('heading', { name: 'Pick a visit', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Send verification code', exact: true }).click(); await page.locator('input[name="customer-code"]').fill('123456'); await page.getByRole('button', { name: 'Verify code', exact: true }).click()
    await page.getByRole('button', { name: /available to request only/ }).first().click(); await page.locator('input[name="booking-preferred-time"]').fill('10:30')
    await page.getByRole('button', { name: 'Continue to sign', exact: true }).click(); await step(5)
    await totalAt(page, '[data-quote-step="5"]', expected, variant, true)
    await page.locator('input[name="booking-signature-name"]').fill(contact.name); await page.getByRole('radio', { name: /Use my typed full name/ }).check(); await page.locator('input[name="booking-acknowledged"]').check()
    await layout(page, `${name}-signature`)
    await page.getByRole('button', { name: 'Submit booking request', exact: true }).focus(); await page.keyboard.press('Enter'); await step(6)
    if (archived) overlay.seedArchivedAcknowledgment()
    const frozen = JSON.stringify(overlay.submission)
    assert.equal(overlay.submission.snapshot.pricing.total, expected); assert.equal(overlay.submission.snapshot.pricing.tax, variant === 'new' ? 0 : expected / 11)
    await totalAt(page, '[data-quote-step="6"]', expected, variant, true); await layout(page, `${name}-receipt`)
    await page.reload(); await (await quoteEntryAction(page, 'View quotes & bookings')).click(); await page.locator('.lq-customer-list').getByRole('button', { name: 'Open saved quote', exact: true }).first().click(); await step(6)
    await totalAt(page, '[data-quote-step="6"]', expected, variant, true); assert.equal(JSON.stringify(overlay.submission), frozen, 'Saved booking snapshot and signature preserved on reload')
    await page.goto(`${fixture.base}/admin/quotes`)
    await page.getByRole('button', { name: /View request/ }).first().click(); await page.locator('.lq-admin-detail').waitFor()
    await page.getByRole('heading', { name: 'Company booking review and confirmation', exact: true }).waitFor()
    await page.getByRole('heading', { name: archived ? 'Company proposal · Version 1 · Published for customer review' : 'Company booking schedule', exact: true }).waitFor()
    await totalAt(page, '.lq-admin-detail', expected, variant)
    const companyTotal = page.getByRole('region', { name: 'Company booking review and confirmation', exact: true }).locator('.live-company-price')
    assert.match(await companyTotal.innerText(), variant === 'new' ? /no GST charged/ : /including GST/)
    assert.doesNotMatch(await companyTotal.innerText(), /\bgst\b/)
    if (archived) {
      const companyProposal = page.getByRole('region', { name: 'Company booking review and confirmation', exact: true })
      assert.ok((await companyProposal.innerText()).includes(money(198001)))
      assert.match(await companyProposal.innerText(), /including GST/i)
    }
    await layout(page, `${name}-ems`)
    await page.getByRole('heading', { name: 'Company booking review and confirmation', exact: true }).click()
    await page.getByRole('region', { name: 'Company booking review and confirmation', exact: true }).screenshot({ path: fileURLToPath(new URL(`${name}-ems-company.png`, out)) })
    assert.equal(JSON.stringify(overlay.submission), frozen, 'EMS read preserves signed snapshot')
    assert.equal(overlay.commands.length, 1); assert.deepEqual(overlay.failures, []); assert.deepEqual(overlay.denied, [])
    checks.push({ name, expectedTotalCents: expected, taxCents: pricing.tax, pricingVersion: pricing.pricingVersion, acknowledgmentVersion: overlay.submission.snapshot.version, savedSubmissionPreserved: true, historicalAcknowledgmentSeededForRead: archived, passed: true })
    console.log(`PASS ${name}`)
  } catch (error) { await page.screenshot({ path: fileURLToPath(new URL(`${name}-failure.png`, out)) }).catch(() => {}); console.error(JSON.stringify({ name, errors, fixtureErrors: overlay.failures, alerts: await page.getByRole('alert').allTextContents(), overflow: await page.evaluate(() => [...document.querySelectorAll('*')].filter(el => el.getClientRects().length && el.getBoundingClientRect().right > innerWidth + 1).slice(0, 20).map(el => ({ tag: el.tagName, class: el.className, width: el.getBoundingClientRect().width, minWidth: getComputedStyle(el).minWidth, display: getComputedStyle(el).display }))), text: (await page.locator('body').innerText()).slice(-5000) })); throw error }
  finally { await context.close() }
}
try {
  for (const width of [1280, 390, 320]) await scenario('new', [3, 2], { width, height: width === 1280 ? 800 : 852 })
  await scenario('new', [12, 4], { width: 390, height: 852 })
  for (const variant of ['v1', 'v2']) await scenario(variant, [3, 2], { width: 390, height: 852 })
  await scenario('v1', [3, 2], { width: 320, height: 852 })
  await scenario('v2', [3, 2], { width: 390, height: 852 }, true)
  assert.deepEqual(errors, [])
  const previous = process.env.GST_UI_SCENARIO ? JSON.parse(readFileSync(new URL('ui-results.json', out), 'utf8')) : null
  const mergedChecks = [...new Map([...(previous?.checks ?? []), ...checks].map(check => [check.name, check])).values()]
  const mergedLayouts = [...new Map([...(previous?.layouts ?? []), ...layouts].map(layout => [layout.name, layout])).values()]
  writeFileSync(new URL('ui-results.json', out), JSON.stringify({ synthetic: true, upstream: process.env.GST_UI_UPSTREAM ?? 'http://127.0.0.1:3045', checks: mergedChecks, errors, layouts: mergedLayouts, latestRun: { checkedAt: now(), scenarios: checks.map(check => check.name), targeted: Boolean(process.env.GST_UI_SCENARIO) }, limitations: ['Quote save/read is real PGlite API. Media, OTP, booking and company confirmation are validated synthetic browser fixtures.', 'No production DB, real email, AI, Google Calendar or real customer records used. PDF/mail content and immutable DB preservation are verified separately.'] }, null, 2))
} finally { await browser.close(); await fixture.close() }
