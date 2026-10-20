// Deployment smoke: a new browser, public documents and an empty quote session.
// Saving inputs, uploading photos, AI, email, booking and admin calls are blocked.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const supplied = process.env.GST_SMOKE_URL
assert.ok(supplied, 'The release owner must supply GST_SMOKE_URL; do not infer an external target.')
const target = new URL(supplied)
assert.ok(target.protocol === 'https:' && !target.username && !target.password && target.pathname === '/' && !target.search && !target.hash, 'Supply the exact deployment HTTPS origin.')
const label = process.env.GST_SMOKE_LABEL ?? 'production'
assert.match(label, /^[a-z0-9-]+$/)
const documentOnly = process.env.GST_SMOKE_DOCUMENT_ONLY === 'true'
const output = new URL(`../docs/verification/2026-10-14-no-gst-deployment/${label}/`, import.meta.url)
mkdirSync(output, { recursive: true })
const require = createRequire(import.meta.url)
let playwright
try { playwright = require('playwright') } catch { playwright = require(`${process.env.QUOTE_UI_RUNTIME_PACKAGES ?? '/Users/jimee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'}/playwright`) }
const browser = await playwright.chromium.launch({ headless: true, channel: 'chrome' })
const checks = [], requests = [], responses = [], blocked = [], errors = [], httpFailures = []
const allowedReads = new Set(['/api/quote/requests', '/api/quote/requests/customer', '/api/address/config'])

async function screenshot(page, name) {
  const bounds = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, height: innerHeight, routeHeader: document.querySelector('.quote-route-header')?.getBoundingClientRect().right ?? null, actions: [...document.querySelectorAll('.lq-stage-actions button')].filter(el => el.getClientRects().length).map(el => ({ text: el.textContent.trim(), left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right })) }))
  assert.ok(bounds.document <= bounds.viewport + 1, `Horizontal overflow: ${JSON.stringify(bounds)}`)
  if (bounds.routeHeader !== null) assert.ok(bounds.routeHeader <= bounds.viewport + 1)
  for (const button of bounds.actions) assert.ok(button.left >= -1 && button.right <= bounds.viewport + 1, `Clipped action: ${button.text}`)
  await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, output)) })
  return bounds
}
async function emptyRead(context, path, width) {
  const response = await context.request.get(`${target.origin}${path}`)
  requests.push({ width, method: 'GET', path, status: response.status(), kind: 'explicit-empty-session-read' })
  assert.equal(response.status(), 200)
  const value = await response.json()
  if (path.endsWith('/customer')) assert.deepEqual(value, { customer: null, requests: [], currentRequestId: null })
  else assert.equal(value.request, null, 'A fresh browser must not open any saved customer request.')
}
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: width === 1280 ? 800 : 852 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.setDefaultTimeout(20000)
    const scopeErrors = []
    page.on('pageerror', error => { scopeErrors.push(error.message); errors.push({ width, type: 'pageerror', message: error.message }) })
    page.on('console', message => { if (message.type() === 'error') { scopeErrors.push(message.text()); errors.push({ width, type: 'console', message: message.text() }) } })
    page.on('response', response => { const result = { width, path: new URL(response.url()).pathname, status: response.status() }; responses.push(result); if (response.status() >= 400) httpFailures.push(result) })
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method(), path = url.pathname
      const read = ['GET', 'HEAD'].includes(method)
      const sameOrigin = url.origin === target.origin
      const publicRead = sameOrigin && read && (!path.startsWith('/api/') || !documentOnly && allowedReads.has(path))
      let emptyTransition = false
      if (!documentOnly && sameOrigin && method === 'POST') {
        if (path === '/api/quote/requests/session') emptyTransition = !request.postData()
        if (path === '/api/quote/requests/customer/logout') { const body = request.postDataJSON(); emptyTransition = body?.intent === 'start-new' && Object.keys(body).length === 1 }
      }
      if (!publicRead && !emptyTransition) { blocked.push({ width, method, path, origin: url.origin }); return route.abort('blockedbyclient') }
      requests.push({ width, method, path, kind: emptyTransition ? 'empty-session-cookie-transition' : 'read' })
      return route.continue()
    })
    try {
      const preflight = await context.request.get(`${target.origin}/quote/start`, { maxRedirects: 0 })
      requests.push({ width, method: 'GET', path: '/quote/start', status: preflight.status(), kind: 'document-preflight-without-redirects' })
      assert.equal(preflight.status(), 200, 'Public document access is required; use the release owner’s existing authentication for protected staging.')
      const response = await page.goto(`${target.origin}/quote/start`, { waitUntil: 'networkidle' })
      assert.equal(response.status(), 200)
      assert.equal(new URL(page.url()).origin, target.origin, 'Deployment protection or a redirect changed the requested origin.')
      await page.getByRole('heading', { name: 'How can we help with your kitchen?', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Start a new quote', exact: true }).waitFor()
      await page.getByRole('button', { name: 'View quotes & bookings', exact: true }).waitFor()
      const entryBounds = await screenshot(page, `${width}-entry`)
      if (documentOnly) {
        checks.push({ width, documentStatus: response.status(), entryBounds, passed: true, mode: 'public-document-only', priceInteractionNotPerformed: 'The staged host differs from the configured company API origin.' })
        continue
      }
      await emptyRead(context, '/api/quote/requests/customer', width)
      await emptyRead(context, '/api/quote/requests', width)
      await page.getByRole('button', { name: 'Start a new quote', exact: true }).click()
      await page.locator('[data-quote-step="0"]:visible').waitFor()
      for (const id of ['live-name', 'live-email', 'live-phone', 'live-site', 'live-suburb', 'live-postcode']) assert.equal(await page.locator(`#${id}`).inputValue(), '', `Fresh field ${id} must remain empty.`)
      assert.equal(await page.getByRole('checkbox', { name: /privately saving|saving these details/ }).isChecked(), false)
      const price = page.locator('.lq-summary-price'), tax = page.locator('.lq-project-summary > span')
      assert.equal((await price.textContent()).trim(), 'From A$1,450')
      assert.match(await tax.textContent(), /No GST charged/)
      assert.doesNotMatch(await tax.textContent(), /including GST|\bgst\b/)
      assert.equal(await price.isVisible(), width === 1280, 'The existing mobile sidebar intentionally hides the starting-price summary.')
      const formBounds = await screenshot(page, `${width}-new-empty-form`)
      if (width === 1280) {
        await tax.scrollIntoViewIfNeeded()
        const bounds = await tax.boundingBox()
        assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 800, 'The no-GST label must be reachable in the desktop sidebar.')
        await page.locator('.lq-project-summary').screenshot({ path: fileURLToPath(new URL(`${width}-starting-price-summary.png`, output)) })
      }
      await page.locator('#live-name').focus(); await page.keyboard.press('Tab')
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'live-email')
      await page.getByRole('button', { name: 'View quotes & bookings', exact: true }).click()
      await page.locator('#quote-email-access:visible').waitFor()
      assert.equal(await page.locator('.lq-customer-list button').count(), 0, 'An unauthenticated fresh browser must not expose saved records.')
      await screenshot(page, `${width}-saved-entry-empty`)
      await page.locator('.lq-workspace-header').getByRole('button', { name: 'Back to quote', exact: true }).click()
      await page.locator('[data-quote-step="0"]:visible').waitFor()
      await emptyRead(context, '/api/quote/requests', width)
      assert.deepEqual(scopeErrors, [])
      checks.push({ width, documentStatus: response.status(), entryBounds, formBounds, startingAmount: 'A$1,450', taxStatus: 'No GST charged', startingSummaryVisible: width === 1280, fieldsEmpty: true, currentRequestNull: true, savedRecordsExposed: false, passed: true, mode: 'empty-session-smoke' })
    } catch (error) { await page.screenshot({ path: fileURLToPath(new URL(`${width}-failure.png`, output)) }).catch(() => {}); throw error }
    finally { await context.close() }
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(httpFailures, [])
  assert.deepEqual(blocked, [])
  writeFileSync(new URL('ui-results.json', output), JSON.stringify({ target: target.origin, checkedAt: new Date().toISOString(), documentOnly, checks, requests, responses, errors, httpFailures, blocked, limits: ['No contact input was entered or saved. No photos, AI, email, booking, admin or Google calls were permitted.', 'Existing customer data and confirmed bookings were not opened. Their preservation is covered separately by migration/database evidence and isolated local fixtures.', 'For mobile, the starting-price summary remains hidden in the existing sidebar layout; the deployed DOM policy is checked without claiming visible mobile estimate totals.'] }, null, 2))
  console.log(`PASS ${label}: ${checks.length}/3 viewport scenarios; ${requests.length} allowlisted requests; no saved quote created.`)
} catch (error) {
  writeFileSync(new URL('ui-failure.json', output), JSON.stringify({ target: target.origin, checkedAt: new Date().toISOString(), documentOnly, checks, requests, responses, errors, httpFailures, blocked, message: error.message }, null, 2))
  throw error
} finally { await browser.close() }
