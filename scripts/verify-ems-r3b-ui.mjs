// Synthetic acceptance only: application API responses always come from the fixture.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as pause } from 'node:timers/promises'

const options = new Map(), args = process.argv.slice(2)
for (let index = 0; index < args.length; index += 2) {
  const key = args[index], value = args[index + 1]
  assert.ok(['--base', '--playwright', '--channel', '--only', '--output'].includes(key), `Unknown option: ${key}`)
  assert.ok(value && !value.startsWith('--'), `Missing value for ${key}`)
  assert.equal(options.has(key), false, `Duplicate option: ${key}`)
  options.set(key, value)
}
const base = new URL(options.get('--base') ?? 'http://127.0.0.1:3063')
assert.ok(base.protocol === 'http:' && base.hostname === '127.0.0.1' && !base.username && !base.password && base.pathname === '/' && !base.search && !base.hash, 'R3b QA requires a loopback HTTP synthetic fixture.')
const output = resolve(options.get('--output') ?? 'docs/verification/2026-10-21-ems-r3b')
mkdirSync(output, { recursive: true })
const results = [], errors = [], skipped = [], screenshots = []
const button = (scope, name) => scope.getByRole('button', { name, exact: true })
const tab = (page, name) => page.getByRole('tab', { name, exact: true })
const panel = page => page.locator('[role=tabpanel]:not([hidden])')
const revisions = (state, id) => state.r3bRevisions.find(([key]) => key === id)?.[1] ?? []
const attempts = (state, action) => state.r3bAttempts.filter(row => row.action === action)
const committed = rows => rows.filter(row => row.outcome === 'committed' && !row.replay)
const receiptCount = (state, key) => state.r3bReceipts.filter(([, row]) => row.result.receipt.idempotencyKey === key).length
const originals = state => ({ records: state.records, enquiries: state.enquiries, liveRequests: state.liveRequests, liveAnalysis: state.liveAnalysis, signed: state.r3aBookingStates.map(row => ({ requestId: row.requestId, submission: row.submission })) })
async function fixture(path, input) {
  const response = await fetch(new URL(path, base), { redirect: 'error', ...(input ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) } : {}) })
  assert.equal(response.ok, true, `Fixture endpoint failed: ${path} (${response.status})`)
  const value = await response.json()
  assert.equal(value.synthetic, true, 'Refusing an origin without the synthetic marker.')
  return value
}
const control = input => fixture('/__fixture/control', input)
const state = () => fixture('/__fixture/state')
async function capture(page, name) {
  const path = resolve(output, `${name}.png`)
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
  await page.screenshot({ path, fullPage: true })
  screenshots.push({ name, path, viewport: page.viewportSize(), url: page.url() })
  return path
}
async function widths(page, name) {
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await pause(120)
    const detail = await page.evaluate(() => ({ overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth), elements: [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 5).map(element => `${element.tagName}.${element.className}`) }))
    assert.equal(detail.overflow, 0, `${name}: horizontal overflow at ${width}px: ${JSON.stringify(detail)}`)
  }
}
async function goto(page, path) {
  const response = await page.goto(new URL(path, base).href)
  assert.equal(response.status(), 200)
  assert.equal(response.headers()['x-esn-fixture'], 'synthetic')
  assert.equal(await page.locator('main').count(), 1)
}
async function exchange(page, path, status, run) {
  const response = page.waitForResponse(value => new URL(value.url()).pathname === path && value.request().method() !== 'GET' && value.status() === status)
  await run()
  const value = await response
  assert.equal(value.headers()['x-esn-fixture'], 'synthetic')
  return value.json()
}
const revisionPath = id => `/api/admin/quote-requests/${id}/company-revisions`
async function quote(page, id, name = 'Revised quote') {
  await goto(page, `/admin/quotes/${id}`)
  await tab(page, name).click()
  await panel(page).getByRole('heading', { name: name === 'Internal draft' ? 'Internal draft' : /New revised quote|Draft version|Waiting for the customer/ }).waitFor()
}
async function saveRevision(page, id, reason = 'Synthetic measured quantities') {
  const scope = panel(page)
  await scope.getByLabel('Reason for this change (staff only)', { exact: true }).fill(reason)
  const result = await exchange(page, revisionPath(id), 200, () => button(scope, 'Save draft').click())
  await scope.getByText(/Draft version \d+ saved/).waitFor()
  assert.equal(result.detail.current.status, 'draft')
  return result
}
async function publish(page, id, status = 200) {
  const scope = panel(page)
  await scope.getByRole('button', { name: /Send version \d+ to customer/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Reason (staff only, recorded in the history)').fill('Synthetic explicit publication review')
  await dialog.getByLabel('I checked the quantities, additional items and new total.').check()
  return exchange(page, `${revisionPath(id)}/publish`, status, () => button(dialog, 'Send revised quote').click())
}
async function signedGstComparison(scope) {
  const table = scope.getByRole('table', { name: 'Price breakdown', exact: true })
  const cells = async label => {
    const row = table.getByRole('row').filter({ has: scope.page().getByRole('rowheader', { name: label, exact: true }) })
    assert.equal(await row.isVisible(), true, `The ${label} comparison row must be visible.`)
    return row.getByRole('cell').allTextContents()
  }
  const subtotal = await cells('Subtotal'), tax = await cells('GST (as signed)'), total = await cells('Total')
  assert.equal(subtotal[0], '$2,200.00')
  assert.deepEqual(tax, ['$220.00', 'No GST'])
  assert.equal(total[0], '$2,420.00')
  assert.equal(subtotal[1], total[1], 'The revised quote has no GST.')
  assert.equal(await scope.getByText('Difference (includes removing the original GST)', { exact: true }).isVisible(), true)
  return { originalSubtotal: subtotal[0], originalGst: tax[0], originalTotal: total[0], revisedGst: tax[1], differenceIncludesRemovingOriginalGst: true }
}
async function preparePublished(page, id) {
  await quote(page, id)
  await panel(page).getByLabel('Cabinet doors', { exact: true }).fill('6')
  await saveRevision(page, id)
  await publish(page, id)
  await panel(page).getByRole('heading', { name: 'Waiting for the customer', exact: true }).waitFor()
  assert.equal((await state()).r3bOutbox.filter(row => row.kind === 'revision_notice').length, 1)
}
async function customer(page, id) {
  await goto(page, '/quote/start?mode=live')
  await button(page, 'View quotes & bookings').click()
  const list = page.getByRole('list', { name: 'Your linked quotes' })
  await list.waitFor()
  const reference = (await state()).liveRequests.find(row => row.id === id).reference
  await button(list.locator('li').filter({ hasText: reference }), 'Open saved quote').click()
  await page.locator('.lq-revision').getByRole('heading', { name: /The company revised your quote|Revised quote accepted|Revised quote withdrawn/ }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/quote/start', 'The real customer journey must render this screen.')
}
async function reviewAndSign(page, id, label = 'Review and accept the revised quote') {
  const reviewed = await exchange(page, '/api/quote/requests/company-revision/review', 200, () => button(page, label).click())
  await page.getByText('Accept and sign the revised quote', { exact: true }).waitFor()
  const published = revisions(await state(), id).find(row => row.status === 'published')
  assert.equal(await page.locator('.lq-revision-ack').innerText(), published.snapshot.acknowledgment.text)
  assert.match(await page.locator('.lq-revision-ack').innerText(), /not a contract, work authorisation or payment obligation/)
  assert.equal(reviewed.review.snapshotHash, published.snapshotHash)
  assert.equal(await button(page, 'Accept revised quote').isDisabled(), true)
  await page.getByLabel(/I have read the statement above and accept revised quote/).check()
  await page.locator('input[name="revision-signature-name"]').fill('Synthetic New Revision Signature')
  await page.getByLabel('Use my typed full name as my signature', { exact: true }).check()
  assert.equal(await button(page, 'Accept revised quote').isEnabled(), true)
}
async function acceptedOnce(page, id) {
  await reviewAndSign(page, id)
  await exchange(page, '/api/quote/requests/company-revision/accept', 200, () => button(page, 'Accept revised quote').click())
  await page.getByRole('heading', { name: 'Revised quote accepted', exact: true }).waitFor()
  const after = await state()
  assert.equal(revisions(after, id).filter(row => row.acceptance).length, 1)
  assert.equal(after.r3bOutbox.filter(row => row.kind === 'revision_acceptance_receipt').length, 1)
  return after
}
async function modalFocus(page) {
  const trigger = panel(page).getByRole('button', { name: /Send version \d+ to customer/ })
  await trigger.click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  // Native modal dialog contract (lead decision B): browser chrome may receive focus;
  // page elements outside this showModal() dialog must remain inert, as in the existing dialogs.
  const focusState = () => dialog.evaluate(element => {
    const active = document.activeElement
    const controls = [...element.querySelectorAll('a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]')].filter(control => control.tabIndex >= 0 && !control.matches(':disabled') && control.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
    return {
      active: active ? { tag: active.tagName, id: active.id, html: active.outerHTML.slice(0, 500) } : null,
      documentHasFocus: document.hasFocus(), open: element.open, modal: element.matches(':modal'), contained: Boolean(active && element.contains(active)),
      headingFocused: active === element.querySelector('h2'), controlIndex: controls.indexOf(active),
      controls: controls.map(control => ({ tag: control.tagName, id: control.id, type: control.getAttribute('type'), text: control.textContent?.trim() ?? '' })),
    }
  })
  const initial = await focusState(), transitions = [], reached = new Set()
  assert.equal(initial.headingFocused, true, `Dialog initial H2 focus: ${JSON.stringify(initial)}`)
  assert.equal(initial.open && initial.modal && initial.contained, true, `Dialog must open modally: ${JSON.stringify(initial)}`)
  assert.ok(initial.controls.length > 0, 'The modal must have enabled, visible, tabbable interactive controls.')
  assert.match(await dialog.innerText(), /Booking confirmation is blocked/)
  for (const key of ['Tab', 'Shift+Tab']) for (let index = 0; index < initial.controls.length + 2; index++) {
    const before = await focusState()
    await page.keyboard.press(key)
    const after = await focusState(), transition = { key, index, before, after }
    transitions.push(transition)
    assert.equal(after.open && after.modal, true, `Dialog lost native modality: ${JSON.stringify(transition)}`)
    assert.deepEqual(after.controls, initial.controls, 'The interactive control inventory changed during keyboard traversal.')
    const browserChrome = !after.documentHasFocus && after.active?.tag === 'BODY'
    assert.equal(after.contained || browserChrome, true, `Native modal focused an outside page element: ${JSON.stringify(transition)}`)
    if (after.controlIndex >= 0) reached.add(after.controlIndex)
  }
  assert.deepEqual([...reached].sort((a, b) => a - b), initial.controls.map((_, index) => index), 'Every enabled, visible, tabbable dialog control must be reached by the real keyboard traversal.')

  const outside = await dialog.evaluateHandle(element => {
    const modalRect = element.getBoundingClientRect()
    for (const target of document.querySelectorAll('button')) {
      if (element.contains(target) || target.matches(':disabled') || !target.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue
      const rect = target.getBoundingClientRect()
      const left = Math.max(1, rect.left), right = Math.min(innerWidth - 1, rect.right), top = Math.max(1, rect.top), bottom = Math.min(innerHeight - 1, rect.bottom)
      if (left >= right || top >= bottom) continue
      // A button can have an exposed area beside the modal even when its centre is covered.
      const exposed = [
        { left, right: Math.min(right, modalRect.left), top, bottom },
        { left: Math.max(left, modalRect.right), right, top, bottom },
        { left, right, top, bottom: Math.min(bottom, modalRect.top) },
        { left, right, top: Math.max(top, modalRect.bottom), bottom },
      ].filter(part => part.left < part.right && part.top < part.bottom).sort((a, b) => (b.right - b.left) * (b.bottom - b.top) - (a.right - a.left) * (a.bottom - a.top))[0]
      if (!exposed) continue
      const point = { x: (exposed.left + exposed.right) / 2, y: (exposed.top + exposed.bottom) / 2 }
      const insideButton = point.x > rect.left && point.x < rect.right && point.y > rect.top && point.y < rect.bottom
      const insideViewport = point.x > 0 && point.x < innerWidth && point.y > 0 && point.y < innerHeight
      const outsideDialog = point.x < modalRect.left || point.x > modalRect.right || point.y < modalRect.top || point.y > modalRect.bottom
      const probe = { target, point, text: target.textContent.trim(), enabled: !target.matches(':disabled'), insideButton, insideViewport, outsideDialog, clicks: 0, listener: null }
      probe.listener = () => { probe.clicks++ }
      target.addEventListener('click', probe.listener, true)
      return probe
    }
    return null
  })
  let inert
  try {
    const candidate = await outside.evaluate(probe => probe && ({ point: probe.point, text: probe.text, enabled: probe.enabled, insideButton: probe.insideButton, insideViewport: probe.insideViewport, outsideDialog: probe.outsideDialog }))
    assert.ok(candidate, 'An enabled outside button must have a visible viewport point outside the dialog for the inertness probe.')
    assert.equal(candidate.enabled && candidate.insideButton && candidate.insideViewport && candidate.outsideDialog, true, `Outside click coordinates must be inside the enabled button and viewport, outside the modal: ${JSON.stringify(candidate)}`)
    const domain = value => ({ revisions: value.r3bRevisions, receipts: value.r3bReceipts, attempts: value.r3bAttempts, outbox: value.r3bOutbox, originals: originals(value) })
    const beforeClick = { url: page.url(), text: await page.locator('main').innerText(), domain: domain(await state()) }
    await page.mouse.click(candidate.point.x, candidate.point.y)
    await pause(120)
    const afterClick = await focusState()
    assert.equal(await outside.evaluate(probe => probe.clicks), 0, 'A real mouse click must not reach an inert outside page button.')
    assert.equal(afterClick.open && afterClick.modal, true, `Outside click closed or demoted the native modal: ${JSON.stringify(afterClick)}`)
    assert.deepEqual({ url: page.url(), text: await page.locator('main').innerText(), domain: domain(await state()) }, beforeClick, 'The outside click must not change page or business state.')
    inert = { ...candidate, outsideButtonClicks: 0, pageAndBusinessStateUnchanged: true }
  } finally {
    await outside.evaluate(probe => { if (probe) probe.target.removeEventListener('click', probe.listener, true) })
    await outside.dispose()
  }
  await widths(page, 'publish-dialog')
  const beforeEscape = await focusState()
  assert.equal(beforeEscape.open && beforeEscape.modal, true, 'Dialog must remain modal after responsive checks.')
  assert.equal(await dialog.locator('form').getAttribute('aria-busy'), 'false', 'Escape is tested only while the dialog is not busy.')
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  await page.waitForFunction(() => /^Send version \d+ to customer/.test(document.activeElement?.textContent ?? ''))
  assert.equal(await trigger.evaluate(element => element === document.activeElement), true)
  return { contract: 'native modal dialog contract', initial, transitions, reachedControls: [...reached].sort((a, b) => a - b), inert, escapeRestoredTrigger: true }
}
let browser
async function scenario(name, run, expectedHttp = [], setup = {}) {
  if (options.has('--only') && !name.includes(options.get('--only'))) { skipped.push(name); return }
  await control({ reset: true })
  await control({ r3bLegacyInvalidPhone: false, ...setup })
  const before = await state(), evidence = { external: [], http: [], page: [], console: [], expected: [] }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== base.origin && !['data:', 'blob:'].includes(url.protocol)) { evidence.external.push(url.origin + url.pathname); return route.abort('blockedbyclient') }
    return route.continue()
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => evidence.page.push(error.message))
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) evidence.console.push({ text: message.text(), url: message.location().url }) })
  page.on('response', response => {
    if (response.status() < 400) return
    const item = { path: new URL(response.url()).pathname, status: response.status() }
    ;(expectedHttp.some(expected => expected.path.test(item.path) && expected.status === item.status) ? evidence.expected : evidence.http).push(item)
  })
  try {
    const outcome = await run(page, before)
    assert.deepEqual(originals(await state()), originals(before), 'Customer source requests, original pricing and signed submissions must stay unchanged.')
    for (const expected of expectedHttp) {
      const count = evidence.expected.filter(row => expected.path.test(row.path) && row.status === expected.status).length
      assert.ok(count >= (expected.min ?? 1) && count <= (expected.max ?? expected.min ?? 1), `Expected HTTP ${expected.status} ${expected.path}: observed ${count}, required ${expected.min ?? 1}..${expected.max ?? expected.min ?? 1}`)
    }
    const consoleErrors = evidence.console.filter(message => {
      const status = /Failed to load resource: the server responded with a status of (\d+)/.exec(message.text)?.[1]
      return !status || !evidence.expected.some(item => item.status === Number(status) && message.url && new URL(message.url, base).pathname === item.path)
    })
    assert.deepEqual({ external: evidence.external, http: evidence.http, page: evidence.page, console: consoleErrors }, { external: [], http: [], page: [], console: [] }, 'Unexpected browser, external request or HTTP failure.')
    results.push({ name, result: 'passed', evidence: outcome, expectedHttp: evidence.expected })
    process.stdout.write(`PASS ${name}: ${JSON.stringify(outcome)}\n`)
  } catch (cause) {
    const screenshot = await capture(page, `failure-${errors.length + 1}`).catch(() => null)
    errors.push({ name, message: cause.message, stack: cause.stack, url: page.url(), viewport: page.viewportSize(), screenshot, evidence })
    process.stderr.write(`FAIL ${name}: ${cause.message}\n${(await page.locator('body').innerText().catch(() => '')).slice(0, 6000)}\n`)
  } finally { await context.close() }
}

async function main() {
  await control({ reset: true })
  const initial = await state()
  assert.ok(Array.isArray(initial.r3bRevisions) && Array.isArray(initial.r3bAttempts) && initial.liveRequests.length >= 3, 'The fixture must implement the R3b contract.')
  const { chromium } = options.has('--playwright') ? await import(pathToFileURL(resolve(options.get('--playwright'))).href) : await import('playwright')
  browser = await chromium.launch({ headless: true, ...(options.has('--channel') ? { channel: options.get('--channel') } : {}) })

  await scenario('D1 source issues unchanged legacy save changed invalid rejection and server fields', async (page, before) => {
    const id = before.liveRequests[1].id, path = `/api/admin/quote-requests/${id}/staff-draft`
    await quote(page, id, 'Internal draft')
    await page.getByRole('heading', { name: /original request has values that don’t meet/ }).waitFor()
    const phone = page.getByLabel('Phone (optional)', { exact: true })
    assert.match(await phone.getAttribute('aria-describedby'), /-source/)
    assert.equal(await phone.getAttribute('aria-invalid'), null)
    await widths(page, 'source-issues')
    await page.getByLabel('Reason for this change', { exact: true }).fill('Synthetic keep unchanged original phone')
    const saved = await exchange(page, path, 200, () => button(page, 'Save internal draft').click())
    assert.ok(saved)
    await page.getByText(/Internal draft saved as revision 1/).waitFor()
    const savedState = await state(), saves = savedState.r3aReceipts.length
    assert.equal(savedState.r3aStaffDrafts.find(row => row.requestId === id).payload.contact.phone, 'Legacy invalid phone')
    const name = page.getByLabel('Contact name', { exact: true })
    await name.fill('<b>bad</b>')
    await page.getByLabel('Reason for this change', { exact: true }).fill('Synthetic invalid changed field')
    await button(page, 'Save internal draft').click()
    await page.getByRole('alert').filter({ hasText: /name/i }).first().waitFor()
    assert.equal(await name.inputValue(), '<b>bad</b>')
    assert.equal((await state()).r3aReceipts.length, saves)
    await name.fill('Synthetic Corrected Name')
    const fields = { 'payload.contact.phone': 'Synthetic server phone correction required.' }
    await control({ failures: { [path]: { status: 422, once: true, code: 'validation', outcome: 'not_applied', error: 'Synthetic draft validation failed.', fields } } })
    const rejected = await exchange(page, path, 422, () => button(page, 'Save internal draft').click())
    assert.deepEqual(rejected.fields, fields)
    await page.getByText(fields['payload.contact.phone'], { exact: true }).last().waitFor()
    assert.equal(await phone.getAttribute('aria-invalid'), 'true')
    assert.match(await phone.getAttribute('aria-describedby'), /-error/)
    assert.match(await phone.getAttribute('aria-describedby'), /-source/)
    assert.equal((await state()).r3aReceipts.length, saves)
    return { sourceIssues: true, unchangedLegacySaved: true, changedInvalidRejected: true, serverFieldsDisplayed: true, widths: [320, 768, 1440] }
  }, [{ path: /\/staff-draft$/, status: 422 }], { r3bLegacyInvalidPhone: true })

  await scenario('Company save conflict unknown identical retry strict publication and modal focus', async (page, before) => {
    const id = before.liveRequests[1].id, path = revisionPath(id)
    await quote(page, id)
    const scope = panel(page)
    await scope.getByLabel('Cabinet doors', { exact: true }).fill('6')
    await button(scope, 'Add additional item').click()
    await scope.getByLabel('Description (shown to the customer)').fill('Synthetic pantry door preparation')
    await scope.getByLabel('Amount (A$)').fill('120.50')
    await scope.getByLabel('Why it’s needed (shown to the customer)').fill('Synthetic extra preparation found during the site measure')
    const first = await saveRevision(page, id)
    assert.equal(first.detail.current.totalCents, 157050)
    assert.equal(first.detail.current.pricing.tax, 0)
    const original = first.detail.current.comparison.original
    assert.deepEqual({ subtotalCents: original.subtotalCents, taxCents: original.taxCents, totalCents: original.totalCents }, { subtotalCents: 220000, taxCents: 22000, totalCents: 242000 })
    assert.equal(original.subtotalCents + original.taxCents, original.totalCents)
    const inEffect = scope.locator('.cr-in-effect')
    assert.equal(await inEffect.locator('dt').innerText(), 'Amount in effect:')
    assert.match(await inEffect.locator('dd').innerText(), /\$2,420\.00.*original signed request/)
    await scope.getByLabel('Drawer fronts', { exact: true }).fill('3')
    await scope.getByLabel('Reason for this change (staff only)', { exact: true }).fill('Synthetic conflict input retained')
    await control({ r3bConflictNext: true })
    await exchange(page, path, 409, () => button(scope, 'Save draft').click())
    await scope.getByRole('heading', { name: 'The revised quote changed', exact: true }).waitFor()
    assert.equal(await scope.getByLabel('Drawer fronts', { exact: true }).inputValue(), '3')
    assert.equal(await scope.getByLabel('Reason for this change (staff only)', { exact: true }).inputValue(), 'Synthetic conflict input retained')
    assert.equal(await button(scope, 'Save draft').isDisabled(), true)
    await button(scope, 'Keep my changes on the latest revision').click()
    await saveRevision(page, id, 'Synthetic conflict input retained')
    const conflict = attempts(await state(), 'save').slice(-2)
    assert.notEqual(conflict[0].input.idempotencyKey, conflict[1].input.idempotencyKey)
    assert.equal(conflict[1].input.expectedRevision, conflict[0].input.expectedRevision + 1)
    await scope.getByLabel('Note to the customer (optional, shown on the revised quote)').fill('Synthetic same-key retry note')
    await scope.getByLabel('Reason for this change (staff only)', { exact: true }).fill('Synthetic uncertain save')
    await control({ r3bLoseNextResponse: true })
    await exchange(page, path, 503, () => button(scope, 'Save draft').click())
    await scope.getByRole('heading', { name: /Result of the draft save is unknown/ }).waitFor()
    assert.equal(await scope.getByLabel('Cabinet doors', { exact: true }).isDisabled(), true)
    await exchange(page, path, 200, () => button(scope, 'Send the same request again').click())
    await scope.getByText(/Draft version 1 saved/).waitFor()
    const afterRetry = await state(), retry = attempts(afterRetry, 'save').slice(-2)
    assert.deepEqual(retry[0].input, retry[1].input)
    assert.equal(committed(retry).length, 1)
    assert.equal(retry.filter(row => row.replay).length, 1)
    assert.equal(receiptCount(afterRetry, retry[0].input.idempotencyKey), 1)
    const modal = await modalFocus(page)
    const invalid = await publish(page, id, 422)
    assert.ok(invalid.fields['payload.contact.phone'])
    const phone = scope.getByLabel('Phone (optional)', { exact: true })
    await page.waitForFunction(id => document.getElementById(id)?.getAttribute('aria-invalid') === 'true', await phone.getAttribute('id'))
    await phone.fill('0400 000 000')
    await saveRevision(page, id, 'Synthetic strict publication phone correction')
    await publish(page, id)
    await scope.getByRole('heading', { name: 'Waiting for the customer', exact: true }).waitFor()
    await scope.getByText('Version 1 sent.', { exact: true }).waitFor()
    const gst = await signedGstComparison(scope.getByRole('region', { name: 'Waiting for the customer', exact: true }))
    const after = await state()
    assert.equal(revisions(after, id).at(-1).status, 'published')
    assert.equal(after.r3bOutbox.filter(row => row.kind === 'revision_notice').length, 1)
    assert.equal(after.r3bOutbox.length, 1)
    await widths(page, 'admin-company')
    await capture(page, 'admin-company-1440')
    return { conflictInputRetained: true, retryCommits: 1, retryReceipts: 1, publicationStrictFields: true, noticeOutbox: 1, signedGstComparison: gst, modalFocus: modal }
  }, [{ path: /\/company-revisions$/, status: 409 }, { path: /\/company-revisions$/, status: 503 }, { path: /\/company-revisions\/publish$/, status: 422 }], { r3bLegacyInvalidPhone: true })

  await scenario('Booking draft warning nonblocking published gate and schedule server409', async (page, before) => {
    const id = before.liveRequests[1].id
    await quote(page, id)
    await saveRevision(page, id)
    await tab(page, 'Booking').click()
    let scope = panel(page)
    await scope.getByText(/An unsent revised quote draft \(version 1\) exists/).waitFor()
    const field = suffix => scope.locator(`input[id$="-${suffix}"]`)
    const signed = before.r3aBookingStates.find(row => row.requestId === id).submission
    const day = signed.preferredDate, shift = new Date(`${day}T00:00:00Z`)
    shift.setUTCDate(shift.getUTCDate() + 7)
    const install = shift.toISOString().slice(0, 10)
    await field('takeoff-end').fill(`${day}T23:00`)
    await field('install-start').fill(`${install}T08:00`)
    await field('install-end').fill(`${install}T15:00`)
    assert.equal(await button(scope, 'Booking confirm').isEnabled(), true, 'An unsent draft must not disable confirmation.')
    await tab(page, 'Revised quote').click()
    await publish(page, id)
    await tab(page, 'Booking').click()
    scope = panel(page)
    await scope.getByText('Booking confirmation is waiting for the customer.', { exact: true }).waitFor()
    assert.equal(await button(scope, 'Booking confirm').isDisabled(), true)
    await widths(page, 'confirmation-blocked')
    await capture(page, 'confirmation-blocked')
    await button(scope, 'Open revised quote').click()
    assert.equal(await tab(page, 'Revised quote').getAttribute('aria-selected'), 'true')
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'tab' && document.activeElement.textContent === 'Revised quote')
    await goto(page, `/admin/schedule/${id}`)
    scope = page.locator('.live-company-booking')
    await button(scope, 'Save draft').waitFor()
    await field('takeoff-end').fill(`${day}T23:00`)
    await field('install-start').fill(`${install}T08:00`)
    await field('install-end').fill(`${install}T15:00`)
    const rejected = await exchange(page, `/api/admin/live-bookings/${id}/confirm-request`, 409, () => button(scope, 'Booking confirm').click())
    assert.equal(rejected.code, 'revision_awaiting_customer')
    await page.getByRole('alert').filter({ hasText: /customer acceptance/ }).waitFor()
    assert.equal((await state()).r3aBookingStates.find(row => row.requestId === id).booking, null)
    await capture(page, 'confirmation-server409')
    return { draftWarningNonblocking: true, publishedConfirmationDisabled: true, tabNavigation: true, serverCode: rejected.code, bookingsCreated: 0 }
  }, [{ path: /\/confirm-request$/, status: 409 }])

  await scenario('Customer real journey proof expiry new signature unknown retry acceptance exactly once', async (page, before) => {
    const id = before.liveRequests[1].id
    await preparePublished(page, id)
    await customer(page, id)
    let snapshot = await state()
    assert.equal(revisions(snapshot, id).filter(row => row.acceptance).length, 0, 'Opening the page must not accept a revision.')
    assert.equal(snapshot.r3bOutbox.filter(row => row.kind === 'revision_acceptance_receipt').length, 0)
    assert.equal(await page.getByRole('button', { name: /decline|reject/i }).count(), 0)
    await reviewAndSign(page, id)
    await control({ r3bExpireProofs: true })
    const expired = await exchange(page, '/api/quote/requests/company-revision/accept', 409, () => button(page, 'Accept revised quote').click())
    assert.equal(expired.code, 'review_proof_expired')
    await button(page, 'Review again to sign').waitFor()
    assert.equal(await page.locator('input[name="revision-signature-name"]').count(), 0)
    snapshot = await state()
    assert.equal(revisions(snapshot, id).filter(row => row.acceptance).length, 0)
    await reviewAndSign(page, id, 'Review again to sign')
    await control({ r3bLoseNextResponse: true })
    await exchange(page, '/api/quote/requests/company-revision/accept', 503, () => button(page, 'Accept revised quote').click())
    await button(page, 'Send the same acceptance again').waitFor()
    assert.equal(await page.locator('input[name="revision-signature-name"]').isDisabled(), true)
    await exchange(page, '/api/quote/requests/company-revision/accept', 200, () => button(page, 'Send the same acceptance again').click())
    await page.getByRole('heading', { name: 'Revised quote accepted', exact: true }).waitFor()
    const after = await state(), rows = attempts(after, 'accept').slice(-2), accepted = revisions(after, id).filter(row => row.acceptance)
    assert.deepEqual(rows[0].input, rows[1].input)
    assert.equal(committed(rows).length, 1)
    assert.equal(rows.filter(row => row.replay).length, 1)
    assert.equal(receiptCount(after, rows[0].input.idempotencyKey), 1)
    assert.equal(accepted.length, 1)
    assert.equal(accepted[0].acceptance.signature.name, 'Synthetic New Revision Signature')
    assert.notEqual(accepted[0].acceptance.signature.name, before.r3aBookingStates.find(row => row.requestId === id).submission.signature.name)
    assert.equal(after.r3bOutbox.filter(row => row.kind === 'revision_acceptance_receipt').length, 1)
    await page.getByText('Show what you accepted', { exact: true }).click()
    const gst = await signedGstComparison(page.locator('.lq-revision'))
    await widths(page, 'customer-accepted')
    await page.setViewportSize({ width: 320, height: 1000 })
    await capture(page, 'customer-accepted-320')
    return { realCustomerPath: '/quote/start', expiredProofRejected: true, newSignature: true, acceptanceCommits: 1, receipts: 1, receiptOutbox: 1, signedGstComparison: gst }
  }, [{ path: /\/company-revision\/accept$/, status: 409 }, { path: /\/company-revision\/accept$/, status: 503 }])

  await scenario('Withdraw pending second version sends no mail and keeps accepted first version', async (page, before) => {
    const id = before.liveRequests[1].id
    await preparePublished(page, id)
    await customer(page, id)
    const acceptedState = await acceptedOnce(page, id), accepted = structuredClone(revisions(acceptedState, id)[0])
    await quote(page, id)
    const scope = panel(page)
    await scope.getByLabel('Drawer fronts', { exact: true }).fill('3')
    await saveRevision(page, id, 'Synthetic second revision for withdrawal')
    await publish(page, id)
    await scope.getByRole('heading', { name: 'Waiting for the customer', exact: true }).waitFor()
    const beforeWithdraw = await state()
    await scope.getByRole('button', { name: 'Withdraw version 2…', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    assert.equal(await dialog.getByText('No withdrawal email is sent. A notice email that has not been sent yet is cancelled; one already sent can’t be recalled. Contact the customer separately if needed.', { exact: true }).isVisible(), true)
    assert.match(await dialog.innerText(), /Accepted version 1/)
    await dialog.getByLabel('Reason (staff only, recorded in the history)').fill('Synthetic keep accepted version one')
    await exchange(page, `${revisionPath(id)}/withdraw`, 200, () => button(dialog, 'Withdraw revised quote').click())
    await scope.getByText('Version 2 withdrawn. No withdrawal email is sent to the customer.', { exact: true }).waitFor()
    const withdrawnVersion = scope.locator('.cr-versions > li').filter({ has: page.getByText('Version 2', { exact: true }) })
    assert.equal(await withdrawnVersion.getByText('Revised quote notice email: cancelled — the version was withdrawn before sending · Revised quote PDF saved (saving it does not mean it was delivered)', { exact: true }).isVisible(), true)
    const after = await state()
    const withdrawnId = revisions(after, id)[1].id
    const expectedOutbox = beforeWithdraw.r3bOutbox.map(row => row.revisionId === withdrawnId && row.kind === 'revision_notice' ? { ...row, emailStatus: 'cancelled', errorCode: 'revision_withdrawn' } : row)
    assert.deepEqual(after.r3bOutbox, expectedOutbox, 'Withdrawal changes only the unattempted notice status and reason; it must not enqueue email or alter unrelated evidence.')
    const notice = after.r3bOutbox.filter(row => row.revisionId === withdrawnId && row.kind === 'revision_notice')
    assert.equal(notice.length, 1)
    assert.equal(notice[0].emailStatus, 'cancelled')
    assert.equal(notice[0].errorCode, 'revision_withdrawn')
    assert.equal(notice[0].emailFirstAttemptAt, null)
    assert.equal(after.r3bOutbox.filter(row => ['sent', 'provider_accepted'].includes(row.emailStatus) || row.providerMessageId !== null).length, 0)
    assert.equal(revisions(after, id)[1].emailStatus, 'cancelled')
    assert.deepEqual(revisions(after, id)[0], accepted, 'The earlier accepted revision must be unchanged.')
    assert.equal(revisions(after, id)[1].status, 'withdrawn')
    await customer(page, id)
    await page.getByRole('heading', { name: 'Revised quote withdrawn', exact: true }).waitFor()
    assert.match(await page.locator('.lq-revision').innerText(), /accepted revised quote version 1.*still applies/)
    assert.doesNotMatch(await page.locator('.lq-revision').innerText(), /will contact/i)
    assert.match(await page.locator('.lq-revision').innerText(), /If you have questions, reply to an email you received from us about this booking\./)
    assert.equal(await button(page, 'Accept revised quote').count(), 0)
    await widths(page, 'customer-withdrawn')
    await capture(page, 'customer-withdrawn-1440')
    return { withdrawnVersion: 2, acceptedVersionUnchanged: 1, withdrawalEmails: 0, noticeStatus: notice[0].emailStatus, noticeReason: notice[0].errorCode, providerAccepted: 0, customerStatus: 'withdrawn' }
  })

  await scenario('Customer401 removes private view acknowledgment and unsaved signature', async (page, before) => {
    const id = before.liveRequests[1].id
    await preparePublished(page, id)
    await customer(page, id)
    await reviewAndSign(page, id)
    const privateName = 'Synthetic private unsaved signature buffer'
    await page.locator('input[name="revision-signature-name"]').fill(privateName)
    const ack = await page.locator('.lq-revision-ack').innerText()
    await control({ r3bCustomerSignedIn: false })
    const denied = page.waitForResponse(response => new URL(response.url()).pathname === '/api/quote/requests/company-revision/accept' && response.request().method() === 'POST' && response.status() === 401)
    await button(page, 'Accept revised quote').click()
    const response = await denied
    assert.equal(response.status(), 401)
    assert.equal(response.headers()['x-esn-fixture'], 'synthetic')
    const contact = before.liveRequests[1].payload.contact
    await page.waitForFunction(tokens => {
      const text = document.body.textContent ?? '', inputs = [...document.querySelectorAll('input,textarea')].map(element => element.value)
      return tokens.every(token => !text.includes(token) && inputs.every(value => !value.includes(token)))
    }, [privateName, ack, contact.name, contact.email, contact.siteAddress].filter(Boolean))
    assert.equal(await page.locator('.lq-revision-ack').count(), 0)
    assert.equal(await page.locator('input[name="revision-signature-name"]').count(), 0)
    assert.equal(await page.getByRole('heading', { name: 'The company revised your quote', exact: true }).count(), 0)
    const after = await state()
    assert.equal(after.flags.r3bCustomerSignedIn, false)
    assert.equal(revisions(after, id).filter(row => row.acceptance).length, 0)
    await capture(page, 'customer-access-lost-1440')
    return { status: 401, privateContactRemoved: true, signatureRemoved: true, acknowledgmentRemoved: true, acceptances: 0 }
  }, [{ path: /^\/api\/quote\/requests\//, status: 401, min: 1, max: 8 }])
  assert.ok(results.length + errors.length > 0, `No scenario matched --only ${options.get('--only')}`)
}

try { await main() }
catch (cause) { errors.push({ name: 'gate setup', message: cause.message, stack: cause.stack }); process.stderr.write(`${cause.stack}\n`) }
finally {
  await browser?.close()
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ synthetic: true, base: base.origin, planned: 6 - skipped.length, passed: results.length, failed: errors.length, skipped: skipped.length, results, errors, screenshots, skippedScenarios: skipped }, null, 2))
  process.stdout.write(`${results.length} passed; ${errors.length} failed; ${skipped.length} skipped. Evidence: ${resolve(output, 'results.json')}\n`)
  if (errors.length) process.exitCode = 1
}
