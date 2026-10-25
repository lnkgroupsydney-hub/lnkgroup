// Synthetic fixture acceptance only. API responses come from the fixture, never page.route mocks.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { setTimeout as pause } from 'node:timers/promises'

const args = process.argv.slice(2), options = new Map()
for (let i = 0; i < args.length; i += 2) {
  assert.ok(['--base', '--playwright', '--channel', '--only'].includes(args[i]), `Unknown option: ${args[i]}`)
  assert.ok(args[i + 1] && !args[i + 1].startsWith('--'), `Missing value for ${args[i]}`)
  assert.equal(options.has(args[i]), false, `Duplicate option: ${args[i]}`)
  options.set(args[i], args[i + 1])
}
const base = new URL(options.get('--base') ?? 'http://127.0.0.1:3063')
assert.ok(base.protocol === 'http:' && base.hostname === '127.0.0.1' && !base.username && !base.password && base.pathname === '/' && !base.search && !base.hash, 'R3a QA requires a loopback HTTP synthetic fixture.')
const screenshots = '/tmp/lk-ems-r3a-ui-assets'
mkdirSync(screenshots, { recursive: true })
async function fixture(path, input) {
  const response = await fetch(new URL(path, base), { redirect: 'error', ...(input ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) } : {}) })
  assert.equal(response.ok, true, `Fixture endpoint failed: ${path}`)
  const value = await response.json()
  assert.equal(value.synthetic, true, 'Refusing an origin without the synthetic marker.')
  return value
}
const control = input => fixture('/__fixture/control', input)
const state = () => fixture('/__fixture/state')
async function eventually(predicate) {
  for (let i = 0; i < 100; i++) { const value = await state(); if (predicate(value)) return value; await pause(50) }
  throw new Error('Timed out waiting for synthetic fixture state.')
}
await control({ reset: true })
const initial = await state()
assert.ok(Array.isArray(initial.r3aEnquiries) && initial.r3aEnquiries.length > 20 && Array.isArray(initial.r3aBookingStates), 'The fixture must implement the R3a contract.')
const { chromium } = options.has('--playwright') ? await import(pathToFileURL(options.get('--playwright')).href) : await import('playwright')
const browser = await chromium.launch({ headless: true, ...(options.has('--channel') ? { channel: options.get('--channel') } : {}) })
const results = [], skipped = [], errors = []
const button = (page, name) => page.getByRole('button', { name, exact: true })
const tab = (page, name) => page.getByRole('tab', { name, exact: true })
// Wrapped labels include help text/options; control IDs also isolate hidden tab forms.
const enquiryField = (page, field) => page.locator(`.enquiry-record :is(input,textarea,select)[id$="-${field}"]`)
const bookingField = (page, field) => page.locator(`.live-company-booking input[id$="-${field}"]`)
const original = value => ({ records: value.records, enquiries: value.enquiries, liveRequests: value.liveRequests, liveAnalysis: value.liveAnalysis, liveBookings: value.liveBookings, enquirySources: value.r3aEnquiries.map(row => row.enquiry), signedSources: value.r3aBookingStates.map(row => ({ requestId: row.requestId, submission: row.submission, proposal: row.proposal, proposals: row.proposals })) })
const writes = (value, path) => value.r3aAttempts.filter(row => row.path === path)
const receipts = (value, key) => value.r3aReceipts.filter(row => row.receipt.idempotencyKey === key)
const failure = (path, status, extra = {}) => control({ failures: { [path]: { status, once: true, ...extra } } })
async function goto(page, path) {
  const response = await page.goto(new URL(path, base).href)
  assert.equal(response.status(), 200)
  assert.equal(response.headers()['x-esn-fixture'], 'synthetic')
  await page.locator('nav a[href="/admin"]').first().waitFor({ state: 'attached' })
  assert.equal(await page.locator('main').count(), 1)
  assert.equal(await page.locator('h1').count(), 1)
}
async function widths(page, name) {
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 }); await pause(120)
    assert.equal(await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)), 0, `${name}: horizontal overflow at ${width}px`)
    await page.screenshot({ path: `${screenshots}/${name}-${width}.png`, fullPage: true })
  }
}
async function enquiry(page, row) { await goto(page, `/admin/enquiries?enquiry=${row.enquiry.id}`); await page.getByRole('heading', { name: row.enquiry.summary.name, exact: true, level: 2 }).waitFor() }
async function addNote(page, body, reason = 'Synthetic internal call record') {
  await page.getByRole('tab', { name: /^Notes/ }).click()
  await enquiryField(page, 'note-body').fill(body)
  await enquiryField(page, 'note-reason').fill(reason)
}
async function quote(page, id) {
  await goto(page, `/admin/quotes/${id}`)
  await tab(page, 'Internal draft').click()
  await page.getByRole('heading', { name: 'Internal draft', exact: true }).waitFor()
  await page.getByLabel('Contact name', { exact: true }).waitFor()
}
async function validQuote(page, name = 'Synthetic staff work copy') {
  await page.getByLabel('Contact name', { exact: true }).fill(name)
  await page.getByLabel('Phone (optional)', { exact: true }).fill('')
  await page.getByLabel('Site address', { exact: true }).fill('Synthetic staff-only work site')
  await page.getByLabel('Reason for this change', { exact: true }).fill('Synthetic internal draft revision')
}
const quoteSaveSettled = (page, id) => page.waitForFunction(id => document.getElementById(id)?.value === '', `staff-draft-reason-${id}`)
const draftSaved = page => page.locator('.live-company-notice').filter({ hasText: 'It is not confirmed: no calendar event, email or held period was created.' }).waitFor()
async function booking(page, id) { await goto(page, `/admin/schedule/${id}`); await button(page, 'Save draft').waitFor() }
const shift = (day, days) => { const value = new Date(`${day}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10) }

async function scenario(name, run, expected = []) {
  if (options.has('--only') && !name.includes(options.get('--only'))) { skipped.push(name); return }
  await control({ reset: true })
  const before = await state(), evidence = { external: [], http: [], page: [], console: [], expected: [] }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== base.origin && !['data:', 'blob:'].includes(url.protocol)) { evidence.external.push(url.origin + url.pathname); return route.abort('blockedbyclient') }
    return route.continue()
  })
  const page = await context.newPage(); page.setDefaultTimeout(15000)
  page.on('pageerror', error => evidence.page.push(error.message))
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) evidence.console.push({ text: message.text(), url: message.location().url }) })
  page.on('response', response => {
    if (response.status() < 400) return
    const path = new URL(response.url()).pathname, status = response.status()
    ;(expected.some(([pattern, code]) => pattern.test(path) && code === status) ? evidence.expected : evidence.http).push({ path, status, url: response.url() })
  })
  try {
    const outcome = await run(page, before)
    assert.deepEqual(original(await state()), original(before), 'Customer originals, signed submissions, pricing versions and original proposal/PDF source data must stay unchanged.')
    const unexpectedConsole = evidence.console.filter(message => {
      const status = /Failed to load resource: the server responded with a status of (\d+)/.exec(message.text)?.[1]
      return !status || !evidence.expected.some(item => item.status === Number(status) && (!message.url || new URL(message.url, base).pathname === item.path))
    })
    assert.deepEqual({ external: evidence.external, http: evidence.http, page: evidence.page, console: unexpectedConsole }, { external: [], http: [], page: [], console: [] }, 'Unexpected browser or HTTP failures.')
    results.push({ name, result: 'passed', evidence: outcome, expectedHttp: evidence.expected.map(({ path, status }) => ({ path, status })) })
    process.stdout.write(`PASS ${name}: ${JSON.stringify(outcome)}\n`)
  } catch (cause) {
    errors.push({ name, message: cause.message, evidence })
    await page.screenshot({ path: `${screenshots}/failure-${results.length + 1}.png`, fullPage: true }).catch(() => {})
    process.stderr.write(`FAIL ${name}: ${cause.message}\n${(await page.locator('body').innerText().catch(() => '')).slice(0, 8000)}\n`)
    throw cause
  } finally { await context.close() }
}

try {
  await scenario('Enquiries list filters owner notes archive restore', async (page, before) => {
    const row = before.r3aEnquiries.find(item => item.management.status === 'active' && item.enquiry.id !== before.enquiries[0].id), owner = before.r3aAssignees.find(item => item.userId !== row.management.assigneeUserId)
    await goto(page, '/admin/enquiries'); await page.getByRole('heading', { name: 'Enquiry inbox', exact: true }).waitFor()
    await page.getByText('22 active enquiries · Page 1 of 2', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: /delete/i }).count(), 0)
    assert.equal(await page.getByRole('link', { name: /delete/i }).count(), 0)
    await widths(page, 'enquiry-list')
    await page.locator('#enquiry-search').fill('no-such-synthetic-r3a-name'); await page.locator('#enquiry-search').press('Enter')
    await page.getByText('No enquiries match “no-such-synthetic-r3a-name”', { exact: true }).waitFor()
    await button(page, 'Clear search').click(); await page.locator('#enquiry-status').selectOption('archived')
    await page.getByText('3 archived enquiries · Page 1 of 1', { exact: true }).waitFor()
    const enquiryPages = page.locator('nav[aria-label="Enquiry pages"]')
    await page.locator('#enquiry-status').selectOption('active'); await button(enquiryPages, 'Next page').click()
    await enquiryPages.getByText('Page 2 of 2', { exact: true }).waitFor(); await button(enquiryPages, 'Previous page').click()
    await page.getByRole('link', { name: `Open enquiry ${row.enquiry.reference}`, exact: true }).click()
    await enquiryField(page, 'owner').selectOption(owner.userId)
    await enquiryField(page, 'owner-reason').fill('Synthetic owner handover'); await button(page, 'Save owner').click()
    await page.getByText('Owner saved.', { exact: true }).waitFor()
    await addNote(page, 'Synthetic call note.\nMorning preferred.'); await button(page, 'Add note').click(); await page.getByText('Internal note added.', { exact: true }).waitFor()
    await button(page, 'Edit note').click(); await enquiryField(page, 'edit-body').fill('Synthetic call note corrected.')
    await enquiryField(page, 'edit-reason').fill('Synthetic correction'); await button(page, 'Save note').click(); await page.getByText('Note changes saved.', { exact: true }).waitFor()
    await tab(page, 'Summary').click(); await button(page, 'Archive enquiry').click(); await button(page, 'Keep active').click()
    assert.equal(writes(await state(), `/api/admin/enquiries/${row.enquiry.id}/archive`).length, 0)
    await button(page, 'Archive enquiry').click(); await enquiryField(page, 'status-reason').fill('Synthetic handled enquiry'); await button(page, 'Confirm archive').click()
    await page.getByText('Enquiry status saved.', { exact: true }).waitFor(); await button(page, 'Restore enquiry').click()
    await enquiryField(page, 'status-reason').fill('Synthetic follow-up'); await button(page, 'Confirm restore').click(); await page.getByText('Enquiry status saved.', { exact: true }).waitFor()
    const after = await state(), saved = after.r3aEnquiries.find(item => item.enquiry.id === row.enquiry.id)
    assert.equal(saved.management.status, 'active'); assert.equal(saved.management.assigneeUserId, owner.userId)
    assert.equal(saved.notes.length, 1); assert.equal(saved.notes[0].body, 'Synthetic call note corrected.'); assert.equal(saved.audit.length, 5)
    assert.equal(after.r3aEnquiries.length, before.r3aEnquiries.length)
    assert.ok(after.requests.some(item => item.path === '/api/admin/enquiries' && item.query.includes('status=archived')))
    assert.ok(after.requests.some(item => item.path === '/api/admin/enquiries' && item.query.includes('page=2')))
    await widths(page, 'enquiry-detail')
    return { ownerSaved: true, noteAddedAndEdited: true, archivedAndRestored: true, deleted: 0, widths: [320, 768, 1440] }
  })

  await scenario('Enquiry409 keeps entry until latest revision reconfirmed', async (page, before) => {
    const row = before.r3aEnquiries[1], path = `/api/admin/enquiries/${row.enquiry.id}`
    await enquiry(page, row); await enquiryField(page, 'owner').selectOption(before.r3aAssignees.find(item => item.userId !== row.management.assigneeUserId).userId)
    await enquiryField(page, 'owner-reason').fill('Synthetic conflict reason retained'); await control({ r3aConflictNext: true, responseDelays: { [path]: 1000 } }); await button(page, 'Save owner').click()
    await page.getByText(/This enquiry changed since you started/).waitFor()
    assert.equal(await enquiryField(page, 'owner-reason').inputValue(), 'Synthetic conflict reason retained')
    assert.equal(await button(page, 'Save owner').isDisabled(), true)
    await button(page, 'I reviewed the latest details; keep my entry').click(); await button(page, 'Save owner').click(); await page.getByText('Owner saved.', { exact: true }).waitFor()
    const attempts = writes(await state(), path); assert.equal(attempts.length, 2)
    assert.notEqual(attempts[0].input.idempotencyKey, attempts[1].input.idempotencyKey)
    assert.equal(attempts[1].input.expectedRevision, attempts[0].input.expectedRevision + 1)
    return { inputRetained: true, explicitReconfirmation: true, newKey: true }
  }, [[/^\/api\/admin\/enquiries\/[^/]+$/, 409]])

  await scenario('Enquiry409 failed reload keeps saves blocked until latest details load', async (page, before) => {
    const row = before.r3aEnquiries[1], path = `/api/admin/enquiries/${row.enquiry.id}`
    await enquiry(page, row); await enquiryField(page, 'owner').selectOption(before.r3aAssignees.find(item => item.userId !== row.management.assigneeUserId).userId)
    await enquiryField(page, 'owner-reason').fill('Synthetic entry retained after failed reload')
    await control({ r3aConflictNext: true, responseDelays: { [path]: 1000 } }); await button(page, 'Save owner').click()
    await eventually(value => !value.flags.r3aConflictNext && writes(value, path).length === 1)
    await failure(path, 503, { error: 'Synthetic latest details unavailable.' })
    await page.getByText(/The latest details could not be loaded\./).waitFor()
    assert.equal(await button(page, 'Save owner').isDisabled(), true)
    assert.equal(await enquiryField(page, 'owner-reason').inputValue(), 'Synthetic entry retained after failed reload')
    await button(page, 'Refresh').click()
    await button(page, 'I reviewed the latest details; keep my entry').click(); await button(page, 'Save owner').click()
    await page.getByText('Owner saved.', { exact: true }).waitFor()
    assert.equal(writes(await state(), path).length, 2)
    return { failedReadBlocksSave: true, entryRetained: true, explicitReviewAfterSuccessfulRead: true }
  }, [[/^\/api\/admin\/enquiries\/[^/]+$/, 409], [/^\/api\/admin\/enquiries\/[^/]+$/, 503]])

  await scenario('Enquiry unknown retry applies identical key and body exactly once', async (page, before) => {
    const row = before.r3aEnquiries[1], path = `/api/admin/enquiries/${row.enquiry.id}/notes`
    await enquiry(page, row); await addNote(page, 'Synthetic uncertain note'); await control({ r3aLoseNextResponse: true }); await button(page, 'Add note').click()
    await page.getByRole('heading', { name: 'Save result not confirmed', exact: true }).waitFor()
    assert.equal(await enquiryField(page, 'note-body').isDisabled(), true)
    await button(page, 'Send the same request again').click(); await page.getByText('Internal note added.', { exact: true }).waitFor()
    const after = await state(), attempts = writes(after, path)
    assert.equal(attempts.length, 2); assert.deepEqual(attempts[0].input, attempts[1].input); assert.equal(attempts[1].replay, true)
    assert.equal(receipts(after, attempts[0].input.idempotencyKey).length, 1)
    assert.equal(after.r3aEnquiries.find(item => item.enquiry.id === row.enquiry.id).notes.filter(note => note.body === 'Synthetic uncertain note').length, 1)
    return { sameKeyAndBody: true, writesApplied: 1, receipts: 1 }
  }, [[/^\/api\/admin\/enquiries\/[^/]+\/notes$/, 503]])

  await scenario('Enquiry503 not_applied is an editable definite failure', async (page, before) => {
    const row = before.r3aEnquiries[1], path = `/api/admin/enquiries/${row.enquiry.id}/notes`
    await enquiry(page, row); await addNote(page, 'Synthetic definite-failure note')
    await failure(path, 503, { code: 'unavailable', outcome: 'not_applied', error: 'Synthetic service unavailable; no change was applied.' }); await button(page, 'Add note').click()
    await page.getByText('Synthetic service unavailable; no change was applied.', { exact: true }).waitFor()
    assert.equal(await page.getByRole('heading', { name: 'Save result not confirmed', exact: true }).count(), 0)
    assert.equal(await enquiryField(page, 'note-body').isEnabled(), true)
    assert.equal((await state()).r3aEnquiries.find(item => item.enquiry.id === row.enquiry.id).notes.length, 0)
    assert.equal((await state()).r3aReceipts.length, 0)
    await button(page, 'Add note').click(); await page.getByText('Internal note added.', { exact: true }).waitFor()
    return { definiteFailure: true, inputEditable: true, newAttemptSaved: true }
  }, [[/^\/api\/admin\/enquiries\/[^/]+\/notes$/, 503]])

  await scenario('Staff quote draft422 field error save409 and source filters', async (page, before) => {
    const request = before.liveRequests[1], path = `/api/admin/quote-requests/${request.id}/staff-draft`
    await quote(page, request.id); await validQuote(page)
    const fields = { 'payload.contact.postcode': 'Synthetic postcode needs staff review.' }
    await failure(path, 422, { code: 'validation', outcome: 'not_applied', error: 'Synthetic draft validation failed.', fields })
    const failed = page.waitForResponse(response => new URL(response.url()).pathname === path && response.status() === 422)
    await button(page, 'Save internal draft').click(); assert.deepEqual((await (await failed).json()).fields, fields)
    await page.locator(`[id="staff-draft-postcode-${request.id}"][aria-invalid="true"]`).waitFor()
    assert.equal(await page.getByLabel('Postcode', { exact: true }).getAttribute('aria-invalid'), 'true')
    const errorId = await page.getByLabel('Postcode', { exact: true }).getAttribute('aria-describedby')
    await page.locator(`[id="${errorId}"]`).waitFor()
    assert.equal(await page.locator(`[id="${errorId}"]`).innerText(), fields['payload.contact.postcode'])
    assert.equal(await page.getByLabel('Contact name', { exact: true }).inputValue(), 'Synthetic staff work copy')
    assert.equal((await state()).r3aStaffDrafts.length, 0)
    await button(page, 'Save internal draft').click(); await page.getByText(/Internal draft saved as revision 1\./).waitFor()
    await quoteSaveSettled(page, request.id)
    await page.getByLabel('Contact name', { exact: true }).fill('Synthetic conflicting staff work copy')
    await page.getByLabel('Reason for this change', { exact: true }).fill('Synthetic staff draft conflict'); await control({ r3aConflictNext: true }); await button(page, 'Save internal draft').click()
    await page.getByRole('heading', { name: 'The internal draft changed', exact: true }).waitFor()
    assert.equal(await page.getByLabel('Contact name', { exact: true }).inputValue(), 'Synthetic conflicting staff work copy')
    assert.equal(await button(page, 'Save internal draft').isDisabled(), true)
    await button(page, 'Keep my changes on the latest revision').click(); await button(page, 'Save internal draft').click(); await page.getByText(/Internal draft saved as revision 3\./).waitFor()
    await quoteSaveSettled(page, request.id)
    await widths(page, 'staff-quote-editor')
    await page.getByRole('link', { name: 'Back to quotes', exact: true }).click()
    await page.getByLabel('Customer request status', { exact: true }).selectOption('draft'); await page.getByText(/0 matching requests/).waitFor()
    await page.getByLabel('Customer request status', { exact: true }).selectOption('review_requested'); await page.getByText(/3 matching requests/).waitFor()
    await page.getByLabel('Internal draft', { exact: true }).selectOption('saved'); await page.getByText(/1 matching request/).waitFor()
    await page.getByText(request.reference, { exact: false }).first().waitFor()
    await page.getByLabel('Internal draft', { exact: true }).selectOption('none'); await page.getByText(/2 matching requests/).waitFor()
    assert.equal(await page.getByText(request.reference, { exact: false }).count(), 0)
    await widths(page, 'staff-quote-list')
    const after = await state(), attempts = writes(after, path)
    assert.ok(after.requests.some(item => item.path === '/api/admin/quote-requests' && item.query.includes('status=draft')))
    assert.ok(after.requests.some(item => item.path === '/api/admin/quote-requests' && item.query.includes('staffDraft=saved')))
    assert.notEqual(attempts.at(-1).input.idempotencyKey, attempts.at(-2).input.idempotencyKey)
    return { fieldsRenderedInline: true, inputRetained: true, internalRevision: 3, sourceFilters: true }
  }, [[/^\/api\/admin\/quote-requests\/[^/]+\/staff-draft$/, 422], [/^\/api\/admin\/quote-requests\/[^/]+\/staff-draft$/, 409]])

  await scenario('Staff quote failed conflict reads preserve entries and require verified latest details', async (page, before) => {
    const request = before.liveRequests[1], path = `/api/admin/quote-requests/${request.id}/staff-draft`
    await quote(page, request.id); await validQuote(page); await button(page, 'Save internal draft').click()
    await page.getByText(/Internal draft saved as revision 1\./).waitFor(); await quoteSaveSettled(page, request.id)
    const name = 'Synthetic unsaved staff entry retained'
    await page.getByLabel('Contact name', { exact: true }).fill(name)
    await page.getByLabel('Reason for this change', { exact: true }).fill('Synthetic conflict with failed latest read')
    await control({ r3aConflictNext: true, responseDelays: { [path]: 1000 } }); await button(page, 'Save internal draft').click()
    await eventually(value => !value.flags.r3aConflictNext && writes(value, path).length === 2)
    await failure(path, 503, { error: 'Synthetic latest internal draft unavailable.' })
    const retry = button(page, 'Retry loading the internal draft'), keep = button(page, 'Keep my changes on the latest revision'), discard = button(page, 'Discard my changes and load latest')
    await retry.waitFor()
    assert.equal(await keep.isDisabled(), true); assert.equal(await discard.isDisabled(), true)
    assert.equal(await page.getByLabel('Contact name', { exact: true }).inputValue(), name)
    await retry.click(); await page.getByText(/The latest saved internal draft is revision 2,/).waitFor()
    await failure(path, 503, { error: 'Synthetic discard reload unavailable.' }); await discard.click(); await retry.waitFor()
    assert.equal(await page.getByLabel('Contact name', { exact: true }).inputValue(), name)
    assert.equal(await button(page, 'Save internal draft').isDisabled(), true)
    assert.equal(await keep.isDisabled(), true)
    await retry.click(); await page.getByText(/The latest saved internal draft is revision 2,/).waitFor()
    await keep.click(); await button(page, 'Save internal draft').click(); await page.getByText(/Internal draft saved as revision 3\./).waitFor()
    await quoteSaveSettled(page, request.id)
    assert.equal((await state()).r3aStaffDrafts.find(row => row.requestId === request.id).payload.contact.name, name)
    return { noCachedRevisionPresentedAsLatest: true, failedDiscardPreservesEntries: true, explicitReviewThenSave: true }
  }, [[/^\/api\/admin\/quote-requests\/[^/]+\/staff-draft$/, 409], [/^\/api\/admin\/quote-requests\/[^/]+\/staff-draft$/, 503]])

  await scenario('Simple booking saves partial draft edits and resolves409', async (page, before) => {
    const source = before.r3aBookingStates[1], id = source.requestId, path = `/api/admin/live-bookings/${id}/draft`
    const takeoff = `${source.submission.preferredDate}T12:30`, install = `${shift(source.submission.preferredDate, 5)}T09:00`, end = `${shift(source.submission.preferredDate, 5)}T15:00`
    await booking(page, id)
    await bookingField(page, 'takeoff-end').fill(takeoff)
    await bookingField(page, 'install-start').fill(install)
    await bookingField(page, 'draft-reason').fill('Synthetic partial visits'); await button(page, 'Save draft').click(); await draftSaved(page)
    let after = await eventually(value => value.r3aSimpleDrafts.some(item => item.requestId === id && item.revision === 1))
    assert.equal(writes(after, path)[0].input.installEndLocal, null)
    assert.equal(after.r3aBookingStates.find(item => item.requestId === id).booking, null)
    await page.reload(); await button(page, 'Save draft').waitFor()
    assert.equal(await bookingField(page, 'install-start').inputValue(), install)
    await bookingField(page, 'install-end').fill(end)
    await bookingField(page, 'draft-reason').fill('Synthetic completed visits'); await button(page, 'Save draft').click()
    await draftSaved(page)
    await eventually(value => value.r3aSimpleDrafts.some(item => item.requestId === id && item.revision === 2))
    await button(page, 'Save draft').waitFor({ state: 'visible' }); await bookingField(page, 'install-end').fill(end.replace('15:00', '16:00'))
    await bookingField(page, 'draft-reason').fill('Synthetic booking draft conflict'); await control({ r3aConflictNext: true }); await button(page, 'Save draft').click()
    await page.getByText(/This booking changed since you started/).waitFor(); await page.getByText(/Latest saved draft:/).waitFor()
    assert.equal(await bookingField(page, 'install-end').inputValue(), end.replace('15:00', '16:00'))
    assert.equal(await button(page, 'Save draft').isDisabled(), true)
    await button(page, 'Keep entries against current saved version').click(); await button(page, 'Save draft').click()
    await draftSaved(page)
    after = await eventually(value => value.r3aSimpleDrafts.some(item => item.requestId === id && item.revision === 4))
    assert.equal(writes(after, path).at(-1).input.expectedRevision, 3)
    assert.equal(after.r3aBookingStates.find(item => item.requestId === id).booking, null)
    await widths(page, 'simple-booking-editor')
    return { partialDraft: true, persistedAfterReload: true, noConfirmationOrOccupancy: true, revision: 4 }
  }, [[/^\/api\/admin\/live-bookings\/[^/]+\/draft$/, 409]])

  await scenario('Simple cancellation holds until verified release and continues original key', async (page, before) => {
    const id = before.r3aBookingStates[2].requestId, path = `/api/admin/live-bookings/${id}/cancel`
    await goto(page, `/admin/schedule/${id}`); await button(page, 'Cancel booking…').click()
    const dialog = page.getByRole('dialog', { name: 'Cancel this confirmed booking?', exact: true }); await dialog.waitFor()
    assert.match(await dialog.innerText(), /Google Calendar events for these visits are deleted/)
    assert.match(await dialog.innerText(), /not notified automatically/)
    await widths(page, 'simple-booking-cancel-dialog')
    await button(dialog, 'Keep booking').click(); assert.equal(writes(await state(), path).length, 0)
    await button(page, 'Cancel booking…').click(); await dialog.locator('input[id^="cancel-dialog-"][id$="-reason"]').fill('Synthetic cancellation by phone'); await dialog.getByRole('checkbox').check()
    await button(dialog, 'Cancel booking').click(); await page.getByText(/Cancellation accepted\./).waitFor()
    await page.getByText('Cancellation accepted · waiting to delete the Google Calendar events', { exact: true }).waitFor()
    assert.match(await page.locator('.live-company-cancellation').innerText(), /Both visits stay held/)
    let after = await state(), cancellation = after.r3aCancellations.find(item => item.requestId === id)
    assert.equal(cancellation.occupancyHeld, true); assert.equal(cancellation.verifiedDeletedEvents, 0)
    const key = writes(after, path)[0].input.idempotencyKey
    await control({ r3aCancellationMode: 'retrying' }); await button(page, 'Refresh cancellation status').click(); await button(page, 'Continue cancellation').waitFor()
    await button(page, 'Continue cancellation').click(); await page.getByText(/Cancellation continued with the original request/).waitFor()
    after = await state(); assert.deepEqual(writes(after, `${path}/retry`).at(-1).input, { idempotencyKey: key })
    assert.equal(after.r3aCancellations.find(item => item.requestId === id).occupancyHeld, true)
    await control({ r3aCancellationMode: 'review_required' }); await button(page, 'Refresh cancellation status').click()
    await page.getByText('Company review required · automatic deletion stopped', { exact: true }).waitFor()
    assert.equal(await button(page, 'Continue cancellation').count(), 0); assert.match(await page.locator('.live-company-cancellation').innerText(), /both visits stay held/i)
    await control({ r3aCancellationMode: 'complete' }); await button(page, 'Refresh cancellation status').click()
    await page.getByText('Released for other bookings', { exact: true }).waitFor()
    after = await state(); cancellation = after.r3aCancellations.find(item => item.requestId === id)
    assert.equal(cancellation.status, 'cancelled'); assert.equal(cancellation.occupancyHeld, false); assert.equal(cancellation.verifiedDeletedEvents, 2)
    assert.equal(await button(page, 'Download original booking confirmation PDF').isVisible(), true)
    await widths(page, 'simple-booking-cancelled')
    await goto(page, '/admin/schedule'); await page.getByRole('heading', { name: 'Bookings & visits', exact: true }).waitFor()
    await page.locator('#schedule-status').selectOption('cancelled')
    const cancelledRow = page.locator('.ems-schedule-list li.ems-record-row').filter({ has: page.locator(`a[href="/admin/schedule/${id}"]`) })
    await cancelledRow.locator('.ems-status').filter({ hasText: /^Cancelled · periods released$/ }).waitFor()
    await widths(page, 'simple-booking-list')
    return { accepted: true, heldDuringRetryAndReview: true, originalKeyContinued: true, verifiedDeletedEvents: 2, releasedTogether: true }
  })

  for (const status of [401, 403]) await scenario(`Enquiry${status} access loss removes private data and typed input`, async (page, before) => {
    const row = before.r3aEnquiries[1], path = `/api/admin/enquiries/${row.enquiry.id}/notes`, privateNote = 'Synthetic unsaved private buffer'
    await enquiry(page, row); assert.ok((await page.locator('main').innerText()).includes(row.enquiry.summary.email))
    await addNote(page, privateNote); await failure(path, status, { code: 'forbidden', outcome: 'not_applied' })
    await control(status === 401 ? { signedOut: true } : { authStage: 'email_verify' })
    await button(page, 'Add note').click()
    const privateTokens = [...Object.values(row.enquiry.summary), privateNote].filter(value => typeof value === 'string' && value.trim())
    await page.waitForFunction(tokens => {
      const text = document.body.textContent ?? '', values = [...document.querySelectorAll('input,textarea')].map(element => element.value)
      return tokens.every(token => !text.includes(token) && values.every(value => !value.includes(token)))
    }, privateTokens)
    assert.equal((await state()).r3aReceipts.length, 0)
    assert.equal(await button(page, 'Add note').count(), 0)
    await page.screenshot({ path: `${screenshots}/enquiry-${status}-access-lost.png`, fullPage: true })
    return { status, contactRemoved: true, typedPrivateInputRemoved: true, writesApplied: 0 }
  }, [[/^\/api\/admin\/enquiries\/[^/]+\/notes$/, status]])
  assert.ok(results.length > 0, `No scenario matched --only ${options.get('--only')}`)
} finally {
  await browser.close()
  writeFileSync(`${screenshots}/results.json`, JSON.stringify({ synthetic: true, base: base.origin, passed: results.length, failed: errors.length, skipped: skipped.length, results, errors, skippedScenarios: skipped }, null, 2))
  process.stdout.write(`${results.length} passed; ${errors.length} failed; ${skipped.length} skipped. Evidence: ${screenshots}/results.json\n`)
}
