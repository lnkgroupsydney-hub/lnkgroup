// Browser validation against production UI and synthetic loopback APIs only.
// Reuses the EMS fixture and existing company domain data; no real Auth/DB/provider calls.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { setTimeout as pause } from 'node:timers/promises'
import { companyClaim } from '../src/modules/bookings/live-test-data.mts'
import { COMPANY_BOOKING_ACK_TEXT, COMPANY_BOOKING_ACK_VERSION } from '../src/modules/bookings/domain/live-contracts.ts'

const upstream = new URL(process.env.EMS_FIXTURE_UPSTREAM ?? 'http://127.0.0.1:3002')
const port = Number(process.env.EMS_INPUT_FIXTURE_PORT ?? 3018), base = new URL(`http://127.0.0.1:${port}`)
assert.equal(upstream.protocol, 'http:'); assert.equal(upstream.hostname, '127.0.0.1')
assert.equal(upstream.pathname, '/'); assert.equal(upstream.search + upstream.hash + upstream.username + upstream.password, '')
assert(Number.isInteger(port) && port >= 1024 && port <= 65535 && port !== Number(upstream.port || 80))
const require = createRequire(import.meta.url)
let playwright
try { playwright = require('playwright') } catch { playwright = require('/Users/jimee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright') }
const fixture = spawn(process.execPath, ['scripts/verify-esn-ui-fixture.mjs'], { env: { ...process.env, EMS_FIXTURE_PORT: String(port), EMS_FIXTURE_UPSTREAM: upstream.origin }, stdio: ['ignore', 'pipe', 'pipe'] })
let fixtureOutput = ''; fixture.stdout.on('data', chunk => { fixtureOutput += chunk }); fixture.stderr.on('data', chunk => { fixtureOutput += chunk })
let browser
const results = [], external = [], pageErrors = [], resources = []
async function state() {
  const response = await fetch(new URL('/__fixture/state', base)); assert.equal(response.status, 200)
  const value = await response.json(); assert.equal(value.synthetic, true); return value
}
async function reset() {
  const response = await fetch(new URL('/__fixture/control', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reset: true }) })
  assert.equal(response.status, 200); assert.equal((await response.json()).synthetic, true)
}
async function waitForState(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) { const value = await state(); if (predicate(value)) return value; await pause(30) }
  throw new Error('Synthetic state did not reach the expected condition.')
}
async function scenario(name, run, overlay) {
  await reset()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== base.origin && !['data:', 'blob:'].includes(url.protocol)) { external.push(url.origin + url.pathname); return route.abort('blockedbyclient') }
    if (overlay && await overlay(route, url)) return
    return route.continue()
  })
  const page = await context.newPage(); page.setDefaultTimeout(12_000)
  page.on('pageerror', error => pageErrors.push({ name, message: error.message }))
  page.on('response', response => { if (response.status() >= 400) resources.push({ name, path: new URL(response.url()).pathname, status: response.status() }) })
  page.on('requestfailed', request => resources.push({ name, path: new URL(request.url()).pathname, failure: request.failure()?.errorText }))
  try {
    const evidence = await run(page); results.push({ name, result: 'passed', evidence }); process.stdout.write(`PASS ${name}: ${JSON.stringify(evidence)}\n`)
  } catch (error) {
    process.stderr.write(`FAIL ${name}: ${page.url()}\n${(await page.locator('body').innerText().catch(() => '')).slice(0, 5000)}\n${JSON.stringify({ pageErrors, resources, fixtureOutput })}\n`)
    await page.screenshot({ path: '/tmp/lk-admin-input-validation-failure.png', fullPage: true }).catch(() => {})
    throw error
  } finally { await context.close() }
}
async function expectInvalid(control) {
  await control.blur()
  assert.equal(await control.evaluate(element => element.validity.valid), false)
  assert.equal(await control.getAttribute('aria-invalid'), 'true')
  const described = await control.getAttribute('aria-describedby'); assert(described)
  assert(await control.page().locator(`[id="${described.split(' ').at(-1)}"]`).isVisible())
}
try {
  for (let attempt = 0; ; attempt++) {
    try { await state(); break } catch (error) { if (attempt >= 100 || fixture.exitCode !== null) throw new Error(`Fixture did not start: ${fixtureOutput}`, { cause: error }); await pause(50) }
  }
  browser = await playwright.chromium.launch({ headless: true, channel: process.env.EMS_INPUT_BROWSER_CHANNEL ?? 'chrome' })
  await scenario('Customer native form rejects malformed fields without posting', async page => {
    await page.goto(new URL('/admin/customers', base).href)
    const fields = { name: page.locator('#customer-name'), email: page.locator('#customer-email'), phone: page.locator('#customer-phone'), address: page.locator('#customer-address') }
    await fields.name.waitFor(); const original = await state()
    const good = { name: "合成 고객 O'Brien & Sons 2", email: 'Synthetic.Contact@Example.invalid', phone: '+61 (4) 1234-5678', address: "Unit 2/18 O'Brien-Street, 合成 Sydney" }
    const invalid = [['name', '12345'], ['name', '<b>Synthetic</b>'], ['email', 'bad..mail@example.invalid'], ['email', 'good@-example.invalid'], ['phone', '+1 212 555 0100'], ['phone', '0412 345 678 ext 4'], ['address', '<script>Synthetic</script>'], ['address', '18 Synthetic\u007f Street']]
    for (const [key, value] of invalid) {
      for (const [field, text] of Object.entries(good)) await fields[field].fill(text)
      await fields[key].fill(value); await expectInvalid(fields[key])
      await page.getByRole('button', { name: 'Create customer', exact: true }).click()
      // Exercise the native submit path as well as the visible submit button.
      await fields.name.evaluate(element => element.form.requestSubmit())
      await pause(60)
      const current = await state()
      assert.equal(current.customers.length, original.customers.length)
      assert.equal(current.requests.filter(request => request.path === '/api/admin/customers' && request.method === 'POST').length, 0)
      assert.equal(await fields[key].inputValue(), value)
    }
    const phones = ['+61 (4) 1234-5678', '0061 2 1234 5678', '13 12 34', '']
    for (const [index, phone] of phones.entries()) {
      const name = `${good.name} ${index}`, email = index === phones.length - 1 ? '' : good.email
      for (const [field, text] of Object.entries({ ...good, name, email, phone })) await fields[field].fill(text)
      assert.equal(await fields.phone.evaluate(element => element.validity.valid), true)
      assert.equal(await fields.phone.getAttribute('aria-invalid'), null)
      const before = (await state()).customers.length
      await fields.name.evaluate(element => element.form.requestSubmit())
      const saved = await waitForState(value => value.customers.length === before + 1)
      assert.deepEqual(Object.fromEntries(['name', 'email', 'phone', 'address'].map(key => [key, saved.customers[0][key]])), { name, email: email || null, phone: phone || null, address: good.address })
      await page.getByText(`Customer ${name} was created. Follow-up refresh errors do not undo the saved customer.`, { exact: true }).waitFor()
      await page.waitForFunction(() => document.querySelector('#customer-name').value === '')
    }
    assert.equal((await state()).requests.filter(request => request.path === '/api/admin/customers' && request.method === 'POST').length, phones.length)
    return { rejectedCases: invalid.length, invalidPostRequests: 0, acceptedPhoneFormats: phones, caseAndUnicodePreserved: true, nativeSubmit: true }
  })
  await scenario('Provisional schedule onClick blocks invalid time and notes', async page => {
    await page.goto(new URL('/admin/enquiries', base).href)
    await page.getByRole('button', { name: /^SYNTHETIC-ENQ-1/ }).click()
    const start = page.getByLabel('Start (Sydney)', { exact: true }), end = page.getByLabel('End (Sydney)', { exact: true }), notes = page.getByLabel(/Internal schedule note/), save = page.getByRole('button', { name: 'Save provisional time', exact: true })
    await start.fill('2099-10-20T11:00'); await end.fill('2099-10-20T10:00')
    await save.click(); await page.getByText('End time must be after start time.', { exact: true }).waitFor()
    assert.equal((await state()).requests.filter(request => request.method === 'POST' && request.path.endsWith('/schedule')).length, 0)
    await end.fill('2099-10-20T12:00')
    for (const value of ['Synthetic\u007f note', '<b>Synthetic note</b>']) {
      await notes.fill(value); await expectInvalid(notes); await save.click(); await pause(60)
      assert.equal((await state()).requests.filter(request => request.method === 'POST' && request.path.endsWith('/schedule')).length, 0)
    }
    const text = '합성 work note\nRepair < 2 mm\tKeep existing scope.'
    await notes.fill(text); await save.click()
    const saved = await waitForState(value => value.enquiries[0].revision === 2)
    assert.equal(saved.enquiries[0].scheduleNotes, text); assert.equal(saved.enquiries[0].endAt, '2099-10-20T12:00:00+11:00')
    assert.equal(saved.requests.filter(request => request.method === 'POST' && request.path.endsWith('/schedule')).length, 1)
    return { invalidPostRequests: 0, notesUnicodeLfTabAndComparisonPreserved: true, validSchedulePosts: 1, revision: 2 }
  })
  const claim = companyClaim('proposal_notice'), id = claim.requestId
  const request = { id, reference: `RQ-${id.replaceAll('-', '').toUpperCase()}`, mode: 'live', companyId: 'lk-group', revision: 1, status: 'draft', createdAt: claim.submission.submittedAt, savedAt: claim.submission.submittedAt, consentVersion: 'quote-storage-review-v1', customerId: null, reviewRequestedAt: null, payload: claim.submission.snapshot.payload }
  let company = { requestId: id, revision: 0, submission: claim.submission, proposals: [], proposal: null, acceptance: null, booking: null, canWrite: true, acknowledgment: { version: COMPANY_BOOKING_ACK_VERSION, text: COMPANY_BOOKING_ACK_TEXT } }
  const commands = []
  async function overlay(route, url) {
    const respond = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname === '/api/admin/quote-requests') { await respond({ requests: [request], total: 1, page: 1, pageSize: 10 }); return true }
    if (url.pathname === `/api/admin/quote-requests/${id}`) { await respond({ request, audit: [] }); return true }
    if (url.pathname === `/api/admin/quote-requests/${id}/booking`) { await respond({ state: { requestId: id, verified: true, canEdit: true, approval: null, submission: null, acknowledgment: claim.submission.snapshot.acknowledgment } }); return true }
    if (url.pathname === `/api/admin/quote-requests/${id}/analysis`) { await respond({ request, photos: [], jobs: [], latest: null }); return true }
    if (url.pathname === '/api/admin/live-bookings') { await respond({ state: company }); return true }
    if (url.pathname === `/api/admin/live-bookings/${id}/proposal` && route.request().method() === 'PUT') {
      const input = route.request().postDataJSON(); commands.push(input)
      const proposal = { ...claim.proposal, status: 'draft', amountExGst: input.amountExGst, gst: Math.round(input.amountExGst / 10), total: input.amountExGst + Math.round(input.amountExGst / 10), scope: input.scope, adjustmentReason: input.adjustmentReason, segments: input.segments.map(segment => ({ ...segment, startAt: `${segment.startDate}T00:00:00.000Z`, endAt: `${segment.endDate}T00:00:00.000Z` })) }
      company = { ...company, revision: company.revision + 1, proposals: [proposal], proposal }
      await respond({ state: company }); return true
    }
    return false
  }
  await scenario('Company currency and changing date minimum reject then recover', async page => {
    await page.goto(new URL('/admin/quotes', base).href)
    await page.getByRole('button', { name: `View request ${request.reference}`, exact: true }).click()
    const section = page.getByRole('region', { name: 'Company booking review and confirmation', exact: true })
    // Inline feedback is inside labels, so use stable input IDs after locating once.
    const field = async label => section.locator(`[id="${await section.getByLabel(label, { exact: true }).getAttribute('id')}"]`)
    const amount = await field('Final supply price (AUD, excluding GST)'), scope = await field('Included and excluded work scope'), reason = await field('Reason for the final price or scope adjustment'), start = await field('First work day (Sydney)'), end = await field('Last work day, included (Sydney)'), save = section.getByRole('button', { name: 'Save company draft', exact: true })
    await scope.fill('합성 scope\nRepair < 2 mm'); await reason.fill('Synthetic review\nScope confirmed'); await start.fill('2099-10-20'); await end.fill('2099-10-21')
    for (const value of ['12.345', '1e3', '-1', '0', '1000000.01']) {
      await amount.fill(value); await save.click(); await pause(60); assert.equal(commands.length, 0)
      assert.equal(await amount.inputValue(), value)
    }
    await amount.fill('1800.01'); await start.fill('2099-10-22'); await save.click(); await expectInvalid(end)
    assert.equal(await end.getAttribute('min'), '2099-10-22'); assert.equal(commands.length, 0)
    // Leave the end unchanged: changing the dependent min must clear stale feedback.
    await start.fill('2099-10-20'); await start.blur()
    assert.equal(await end.inputValue(), '2099-10-21'); assert.equal(await end.evaluate(element => element.validity.valid), true)
    assert.equal(await end.getAttribute('aria-invalid'), null)
    await save.click(); await section.getByText('Saved company booking status has been verified.', { exact: true }).waitFor()
    assert.equal(commands.length, 1); assert.equal(commands[0].amountExGst, 180001)
    assert.equal(commands[0].scope, '합성 scope\nRepair < 2 mm'); assert.equal(commands[0].segments[0].startDate, '2099-10-20'); assert.equal(commands[0].segments[0].endDate, '2099-10-22')
    return { rejectedAmounts: 5, invalidPutRequests: 0, acceptedCents: 180001, dateMinFeedbackRecoveredWithoutEditingEnd: true, validPutRequests: 1 }
  }, overlay)
  assert.deepEqual(pageErrors, []); assert.deepEqual(external, [])
  process.stdout.write(JSON.stringify({ synthetic: true, results, pageErrors, deniedExternalRequests: external, notExecuted: ['Real staff Auth, customer/company persistence and Google services', 'Real company proposal publication or confirmation'] }, null, 2) + '\n')
} finally {
  if (browser) await browser.close()
  fixture.kill('SIGTERM')
}
