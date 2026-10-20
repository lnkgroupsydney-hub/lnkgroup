// Synthetic-only EMS R1 browser acceptance. APIs, cookies and documents stay
// inside verify-esn-ui-fixture.mjs; this runner refuses other origins/markers.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as pause } from 'node:timers/promises'

const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1]
const base = new URL(args.includes('--base') ? option('--base') : 'http://127.0.0.1:3021')
if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('R1 browser QA requires a loopback synthetic fixture.')
const { chromium } = args.includes('--playwright') ? await import(pathToFileURL(option('--playwright')).href) : await import('playwright')
async function control(value) {
  const response = await fetch(new URL('/__fixture/control', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
  assert.equal(response.ok, true); assert.equal((await response.json()).synthetic, true, 'Synthetic control marker is required before browser launch.')
}
async function state() { const value = await (await fetch(new URL('/__fixture/state', base))).json(); assert.equal(value.synthetic, true); return value }
async function eventually(predicate) { for (let i = 0; i < 100; i++) { const value = await state(); if (predicate(value)) return value; await pause(50) } throw new Error('Timed out waiting for synthetic state.') }
const screenshots = new URL('file:///tmp/lk-ems-r1-r2-regression-assets/'); mkdirSync(screenshots, { recursive: true })
const count = (value, path, id) => value.requests.filter(request => request.path === path && (!id || request.requestId === id)).length
const outcomes = [], skipped = [], external = [], pageErrors = [], unexpectedResources = [], consoles = []
await control({ reset: true })
const browser = await chromium.launch({ headless: true, ...(args.includes('--channel') ? { channel: option('--channel') } : {}) })
async function scenario(name, run, expectedFailures = []) {
  if (args.includes('--only') && !name.includes(option('--only'))) { skipped.push(name); return }
  await control({ reset: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== base.origin && !['data:', 'blob:'].includes(url.protocol)) { external.push({ name, path: url.origin + url.pathname }); return route.abort('blockedbyclient') }
    return route.continue()
  })
  const page = await context.newPage(); page.setDefaultTimeout(15000)
  page.on('pageerror', error => pageErrors.push({ name, message: error.message }))
  page.on('console', message => { if (['error','warning'].includes(message.type())) consoles.push({ name, type: message.type(), text: message.text() }) })
  page.on('response', response => { if (response.status() >= 400 && !expectedFailures.some(([path,status]) => (path.includes('*') ? new RegExp('^' + path.replaceAll('*','[^/]+') + '$').test(new URL(response.url()).pathname) : new URL(response.url()).pathname === path) && response.status() === status)) unexpectedResources.push({ name, path: new URL(response.url()).pathname, status: response.status() }) })
  try { const evidence = await run(page, context); outcomes.push({ name, evidence, result: 'passed' }); process.stdout.write(`PASS ${name}: ${JSON.stringify(evidence)}\n`) }
  catch (cause) { process.stderr.write(`FAIL ${name} at ${page.url()}\n${(await page.locator('body').innerText().catch(() => '')).slice(0,8000)}\n`); await page.screenshot({ path: '/tmp/lk-ems-r1-failure.png', fullPage: true }).catch(() => {}); throw cause }
  finally { await context.close() }
}
const goto = (page, path) => page.goto(new URL(path, base).href)
const shell = async page => { await page.locator('nav a[href="/admin"]').first().waitFor({ state: 'attached' }); assert.equal(await page.locator('main').count(), 1); assert.equal(await page.locator('h1').count(), 1) }
const tab = (page, name) => page.getByRole('tab', { name, exact: true })
async function addClient(page, name) { await page.getByRole('button', { name: 'Add client', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Create customer', exact: true }); await dialog.waitFor(); if (name) await dialog.locator('#customer-name').fill(name); return dialog }

try {
  if (args.includes('--legacy')) {
    await scenario('Legacy inline Clients keeps customer actions inside /admin', async (page, context) => {
      await goto(page, '/admin'); await page.getByRole('button', { name: 'Open customer', exact: true }).first().waitFor()
      assert.equal(await page.locator('a[href^="/admin/customers/"]').count(), 0)
      await page.getByRole('button', { name: 'Open customer', exact: true }).first().click(); await page.locator('#customer-detail-heading').waitFor()
      await tab(page, 'Connected records').click(); await page.getByRole('button', { name: 'Review link to selected customer', exact: true }).first().click()
      await page.locator('#customer-link-reason').fill('Synthetic legacy source comparison'); await page.locator('#customer-link-confirm').check(); await page.getByRole('button', { name: 'Confirm link', exact: true }).click()
      await page.getByText('Record linked. The source record and its documents were preserved.', { exact: true }).waitFor(); await tab(page, 'Documents').click()
      const href = await page.getByRole('link', { name: 'Open quote PDF', exact: true }).getAttribute('href'); assert.equal(new URL(href, base).origin, base.origin)
      assert.equal((await context.request.get(new URL(href, base).href)).headers()['content-type'], 'application/pdf')
      assert.equal(new URL(page.url()).pathname, '/admin'); assert.equal(await page.locator('.ems-root.customers-standalone').count(), 1)
      await page.getByRole('button', { name: 'Back to customers', exact: true }).click(); await page.locator('#customer-detail-heading').waitFor({ state: 'hidden' })
      const dialog = await addClient(page); await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
      return { inlineDetails: true, guardedDialog: true, sourceLinkAndPrivateDocument: true, unavailableDetailRoutesUnused: true }
    })
  } else {
    await scenario('Authentication stages protect direct detail routes', async page => {
      for (const authStage of ['signed_out','password_change','email_verify','mfa_enroll','mfa_verify']) {
        await control({ reset: true, authStage }); const id = (await state()).liveRequests[0].id
        await goto(page, `/admin/quotes/${id}`); await page.locator('#staff-access-content').waitFor(); await pause(50)
        assert.equal((await state()).requests.some(request => !request.path.startsWith('/api/admin-auth/')), false, authStage)
      }
      return { protectedStages: 5, companyApiCalls: 0 }
    })
    await scenario('Lists and known detail paths preserve one H1 and active navigation', async page => {
      const data = await state()
      for (const path of ['/admin','/admin/customers','/admin/quotes','/admin/enquiries','/admin/schedule', `/admin/customers/${data.customers[0].id}`, ...['quotes','enquiries','schedule'].map(section => `/admin/${section}/${data.liveRequests[0].id}`)]) {
        const response = await goto(page, path); assert.equal(response.status(), 200); assert.equal(response.headers()['x-esn-fixture'], 'synthetic'); await shell(page)
        const section = path.split('/')[2], href = section ? `/admin/${section}` : '/admin'
        assert.ok(await page.locator(`nav a[href="${href}"][aria-current="page"]`).count() >= 1, `${path} needs an active section`)
        if (path.split('/').length === 4) {
          assert.ok(await page.locator('main h2').count() > 0)
          const missingPanels = await page.getByRole('tab').evaluateAll(elements => elements.map(element => element.getAttribute('aria-controls')).filter(id => !id || !document.getElementById(id)))
          assert.deepEqual(missingPanels, [], `${path} tab controls must refer to existing panels`)
        }
      }
      return { directPages: 9, landmark: 'one main and H1', detailMenuActive: true }
    })
    await scenario('Client dialog protects unsaved Escape and returns focus', async page => {
      await goto(page, '/admin/customers'); await shell(page)
      assert.equal(await page.locator('#customer-name').isVisible(), false)
      await page.screenshot({ path: fileURLToPath(new URL('ems-r1-clients-20261013.png', screenshots)), fullPage: true })
      const trigger = page.getByRole('button', { name: 'Add client', exact: true }); let dialog = await addClient(page)
      assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true)
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); assert.equal(await trigger.evaluate(element => document.activeElement === element), true)
      dialog = await addClient(page, 'Synthetic unsaved dialog draft'); await page.keyboard.press('Escape')
      await page.getByRole('heading', { name: 'You have unsaved changes', exact: true }).waitFor(); await page.getByRole('button', { name: 'Return to form', exact: true }).click()
      assert.equal(await dialog.locator('#customer-name').inputValue(), 'Synthetic unsaved dialog draft')
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await page.getByRole('button', { name: 'Discard and continue', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' }); dialog = await addClient(page); assert.equal(await dialog.locator('#customer-name').inputValue(), '')
      await page.keyboard.press('Escape'); return { defaultCreateHidden: true, escapeGuard: true, discardClearsInput: true, triggerFocusRestored: true }
    })
    await scenario('Lost client create response retries one immutable save', async page => {
      await goto(page, '/admin/customers'); await shell(page); await control({ loseNextCreateResponse: true })
      const dialog = await addClient(page, 'Synthetic R1 lost response client'); await dialog.getByRole('button', { name: 'Create customer', exact: true }).click()
      await dialog.getByText(/Synthetic saved mutation response was lost/).waitFor(); assert.equal(await dialog.locator('#customer-name').isDisabled(), true)
      await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), true)
      await dialog.getByRole('button', { name: 'Retry unchanged create', exact: true }).click(); await dialog.waitFor({ state: 'hidden' })
      const saved = await state(); assert.equal(saved.customers.filter(customer => customer.name === 'Synthetic R1 lost response client').length, 1); assert.equal(saved.attemptCount, 1)
      await page.getByRole('link', { name: 'Open customer', exact: true }).first().click(); await page.locator('#customer-detail-heading').waitFor(); assert.match(await page.locator('#customer-detail-heading').innerText(), /Synthetic R1 lost response client/)
      return { customersCreated: 1, immutableAttempts: 1, savedDetailRoute: true }
    }, [['/api/admin/customers/resolve',503]])
    await scenario('Clients restore list page, tabs and revision-conflict reason', async page => {
      await goto(page, '/admin/customers'); await shell(page); await page.getByRole('button', { name: 'Next', exact: true }).click(); await page.getByText(/Page 2 of 2/).waitFor()
      await page.getByRole('link', { name: 'Open customer', exact: true }).first().click(); await tab(page, 'Activity').click(); await page.getByRole('heading', { name: 'Client activity', exact: true }).waitFor()
      await tab(page, 'Activity').focus(); await page.keyboard.press('Home'); assert.equal(await tab(page, 'Summary').getAttribute('aria-selected'), 'true')
      await tab(page, 'Connected records').click(); await page.getByRole('button', { name: 'Review link to selected customer', exact: true }).first().click()
      await page.locator('#customer-link-reason').fill('Synthetic R1 conflict comparison'); await page.locator('#customer-link-confirm').check(); await control({ conflictNextLink: true })
      await page.getByRole('button', { name: 'Confirm link', exact: true }).click(); await page.getByText(/The customer or record changed/).waitFor()
      assert.equal(await page.locator('#customer-link-reason').inputValue(), 'Synthetic R1 conflict comparison'); assert.equal(await page.locator('#customer-link-confirm').isChecked(), false)
      await page.locator('#customer-link-confirm').check(); await page.getByRole('button', { name: 'Confirm link', exact: true }).click(); await page.getByText('Record linked. The source record and its documents were preserved.', { exact: true }).waitFor()
      const linked = await state(), customerId = new URL(page.url()).pathname.split('/').at(-1)
      await tab(page, 'Activity').click(); await page.locator('.customers-audit').getByRole('heading', { name: 'link', exact: true }).waitFor()
      await tab(page, 'Connected records').click(); await page.getByRole('button', { name: 'Review unlink', exact: true }).click(); await page.locator('#customer-link-reason').fill('Synthetic R1 unlink preserves original source'); await page.locator('#customer-link-confirm').check()
      await page.getByRole('button', { name: 'Confirm unlink', exact: true }).click(); await page.getByText('Record unlinked. The source record and the audit history were preserved.', { exact: true }).waitFor()
      const unlinked = await state(); assert.equal(unlinked.links.length, 0); assert.deepEqual(unlinked.records, linked.records); assert.deepEqual(unlinked.audits.find(([id]) => id === customerId)[1].map(event => event.action), ['unlink','link','create'])
      await page.getByRole('link', { name: 'Back to customers', exact: true }).click(); await page.getByText(/Page 2 of 2/).waitFor()
      return { pageRestored: 2, keyboardTabs: true, reasonRetainedAfter409: true, requiresFreshConfirmation: true, unlinkPreservesSourceAndAudit: true }
    }, [['/api/admin/customers/*/links',409]])
    await scenario('Uncertain classification retries immutable link without clearing comparison', async page => {
      const data = await state(); await goto(page, `/admin/customers/${data.customers[0].id}`); await shell(page); await tab(page, 'Connected records').click()
      await page.getByRole('button', { name: 'Review link to selected customer', exact: true }).first().click(); await page.locator('#customer-link-reason').fill('Synthetic immutable classification comparison'); await page.locator('#customer-link-confirm').check()
      await control({ loseNextLinkResponse: true }); await page.getByRole('button', { name: 'Confirm link', exact: true }).click(); await page.getByText('Synthetic saved classification response was lost. Retry unchanged details.', { exact: true }).waitFor()
      assert.equal(await page.locator('#customer-link-reason').isDisabled(), true); assert.equal(await page.getByRole('button', { name: 'Cancel', exact: true }).isDisabled(), true)
      await page.getByRole('link', { name: 'Back to customers', exact: true }).click(); await page.getByRole('heading', { name: 'A request is still in progress', exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: 'Discard and continue', exact: true }).isDisabled(), true)
      await page.getByRole('button', { name: 'Return to form', exact: true }).click(); await page.getByRole('button', { name: 'Confirm link', exact: true }).click(); await page.getByText('Record linked. The source record and its documents were preserved.', { exact: true }).waitFor()
      const saved = await state(); assert.equal(saved.links.length, 1); assert.equal(saved.attemptCount, 1); assert.deepEqual(saved.records, data.records)
      return { immutableAttempts: 1, reasonPreserved: true, uncertainNavigationBlocked: true, sourcePreserved: true }
    }, [['/api/admin/customers/*/links',503]])
    await scenario('Quote summary prioritises saved amount, exclusions and private photo evidence', async (page, context) => {
      const data = await state(), request = data.liveRequests[0]; await goto(page, '/admin/quotes'); await shell(page)
      await page.locator('#live-request-search').fill('Synthetic Live Client 1'); await page.getByRole('button', { name: 'Search requests', exact: true }).click(); await page.getByText(/1 matching request/).waitFor()
      await page.getByRole('link', { name: /^View request/ }).first().click(); await page.getByRole('region', { name: 'Current estimate summary', exact: true }).getByText(/2,420\.00 incl GST/).waitFor()
      await page.getByRole('heading', { name: 'Not priced in this amount', exact: true }).waitFor(); await page.screenshot({ path: fileURLToPath(new URL('ems-r1-quote-20261013.png', screenshots)), fullPage: true }); assert.equal(await page.getByText('Full assessment, price breakdown and photo evidence', { exact: true }).count(), 0)
      await tab(page, 'Photos & estimate').click(); const photo = page.getByRole('img', { name: /Whole cabinet front for request/ }); await photo.waitFor(); await photo.evaluate(element => element.decode())
      const photoHref = await photo.locator('..').getAttribute('href'); assert.equal(new URL(photoHref, base).origin, base.origin); assert.equal((await context.request.get(new URL(photoHref, base).href)).headers()['content-type'], 'image/png')
      await page.getByRole('link', { name: 'Back to quotes', exact: true }).click(); assert.equal(await page.locator('#live-request-search').inputValue(), 'Synthetic Live Client 1'); await page.getByText(/1 matching request/).waitFor()
      return { requestId: request.id, amount: 242000, exclusionsVisible: true, photosPrivate: true, searchRestored: true }
    })
    await scenario('Quote booking draft survives tabs and hidden reads stop polling', async page => {
      await page.clock.install(); const id = (await state()).liveRequests[0].id; await goto(page, `/admin/quotes/${id}`); await shell(page); await tab(page, 'Booking').click()
      const amount = page.getByLabel('Final supply price (AUD, excluding GST)', { exact: true }); await amount.waitFor(); await amount.fill('2500')
      const delayedBefore = await state(); await control({ responseDelays: { '/api/admin/live-bookings': 500 } })
      await page.getByRole('button', { name: 'Refresh company booking status', exact: true }).click(); await eventually(value => count(value, '/api/admin/live-bookings', id) > count(delayedBefore, '/api/admin/live-bookings', id))
      await tab(page, 'Photos & estimate').click(); await tab(page, 'Booking').click(); await pause(650); assert.equal(await amount.inputValue(), '2500'); assert.equal(await page.getByRole('button', { name: 'Refresh company booking status', exact: true }).isEnabled(), true)
      await control({ responseDelays: {} })
      const before = await state(); await page.clock.fastForward(15001); await eventually(value => count(value, '/api/admin/live-bookings', id) > count(before, '/api/admin/live-bookings', id))
      await tab(page, 'Photos & estimate').click(); await page.getByRole('button', { name: 'Refresh photos and analysis', exact: true }).waitFor(); const hidden = await state()
      await page.clock.fastForward(16001); await pause(100); const after = await state()
      assert.equal(count(after, '/api/admin/live-bookings', id), count(hidden, '/api/admin/live-bookings', id)); assert.equal(count(after, `/api/admin/quote-requests/${id}/booking`), count(hidden, `/api/admin/quote-requests/${id}/booking`))
      await tab(page, 'Booking').click(); assert.equal(await amount.inputValue(), '2500')
      await page.locator('nav a[href="/admin/customers"]').first().click(); await page.getByRole('heading', { name: 'You have unsaved changes', exact: true }).waitFor(); await page.getByRole('button', { name: 'Return to form', exact: true }).click(); assert.equal(await amount.inputValue(), '2500')
      return { draftRetained: '2500', immediateReadReentry: true, activePolling: true, hiddenPollingStopped: true, navigationGuard: true }
    })
    await scenario('Company draft mutation completes while its tab is hidden without duplicate commands', async page => {
      const id = (await state()).liveRequests[0].id; await goto(page, `/admin/quotes/${id}`); await shell(page); await tab(page, 'Booking').click()
      const amount = page.getByLabel('Final supply price (AUD, excluding GST)', { exact: true }); await amount.waitFor(); await amount.fill('2500')
      await page.getByLabel('Included and excluded work scope', { exact: true }).fill('Synthetic draft scope only')
      await page.getByLabel('Reason for the final price or scope adjustment', { exact: true }).fill('Synthetic QA adjustment')
      await page.getByLabel('First work day (Sydney)', { exact: true }).fill('2026-11-11'); await page.getByLabel('Last work day, included (Sydney)', { exact: true }).fill('2026-11-12')
      const path = `/api/admin/live-bookings/${id}/proposal`; await control({ responseDelays: { [path]: 500 } })
      await page.getByRole('button', { name: 'Save company draft', exact: true }).click(); await eventually(value => count(value, path) === 1)
      await tab(page, 'Photos & estimate').click(); await pause(650); await tab(page, 'Booking').click()
      await page.getByText('Saved company booking status has been verified.', { exact: true }).waitFor(); assert.equal(await amount.inputValue(), '2500.00')
      const saved = await state(); assert.equal(count(saved, path), 1); assert.equal(saved.liveBookings.find(value => value.requestId === id).revision, 1)
      return { commandCount: 1, savedRevision: 1, hiddenResponseApplied: true }
    })
    await scenario('Running photo analysis polls only on active tabs', async page => {
      await control({ liveAnalysisProcessing: true }); await page.clock.install(); const id = (await state()).liveRequests[0].id, path = `/api/admin/quote-requests/${id}/analysis`
      await goto(page, `/admin/quotes/${id}`); await shell(page); await page.getByText('Analysing photos', { exact: true }).waitFor()
      const before = await state(); await page.clock.fastForward(5001); await eventually(value => count(value, path) > count(before, path))
      await tab(page, 'Activity').click(); const hidden = await state(); await page.clock.fastForward(10001); await pause(100); assert.equal(count(await state(), path), count(hidden, path))
      return { activeFiveSecondPoll: true, hiddenReadsStopped: true }
    })
    await scenario('Schedule filters loaded Sydney dates and statuses and opens exact visits', async page => {
      const data = await state(); await goto(page, '/admin/schedule'); await shell(page); await page.getByText('3 of 3 loaded booking records · Australia/Sydney', { exact: true }).waitFor()
      await page.locator('#schedule-status').selectOption('confirmed'); await page.getByText('1 of 3 loaded booking records · Australia/Sydney', { exact: true }).waitFor()
      await page.locator('#schedule-day').fill('2026-11-09'); await page.getByText('1 of 3 loaded booking records · Australia/Sydney', { exact: true }).waitFor()
      await page.locator('#schedule-day').fill('2026-11-08'); await page.getByRole('heading', { name: 'No bookings match these filters', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Clear filters', exact: true }).click(); await page.locator('#schedule-search').fill('Synthetic Live Client 2'); await page.getByText('1 of 3 loaded booking records · Australia/Sydney', { exact: true }).waitFor()
      await page.getByRole('link', { name: /^Review booking/ }).click(); await page.waitForURL(url => url.pathname === `/admin/schedule/${data.liveRequests[1].id}`); await page.getByLabel('Customer selected start', { exact: true }).waitFor(); assert.equal(await page.getByLabel('Customer selected start', { exact: true }).inputValue(), '2026-11-05T10:30')
      await page.getByRole('link', { name: 'Back to schedule', exact: true }).click(); assert.equal(await page.locator('#schedule-search').inputValue(), 'Synthetic Live Client 2')
      return { loadedScope: '3 records', statusAndDate: true, exactTakeOff: '2026-11-05T10:30', filterRestored: true }
    })
    await scenario('Responsive lists, detail and dialog reflow at 320–1440 with reduced motion', async page => {
      const data = await state(); await page.emulateMedia({ reducedMotion: 'reduce' })
      const paths = ['/admin/customers', `/admin/customers/${data.customers[0].id}`, '/admin/quotes', `/admin/quotes/${data.liveRequests[0].id}`, '/admin/schedule', `/admin/schedule/${data.liveRequests[1].id}`]
      for (const width of [320,390,768,1280,1440]) {
        await page.setViewportSize({ width, height: 1000 })
        for (const path of paths) {
          await goto(page, path); await shell(page); await page.locator('main .ems-panel').first().waitFor(); await pause(100)
          const overflow = await page.evaluate(() => ({ actual: document.documentElement.scrollWidth, viewport: window.innerWidth })); assert.ok(overflow.actual <= overflow.viewport, `${width}px ${path}: ${JSON.stringify(overflow)}`)
          if (width === 390 && path === '/admin/schedule') { await page.getByText('3 of 3 loaded booking records · Australia/Sydney', { exact: true }).waitFor(); await page.screenshot({ path: fileURLToPath(new URL('ems-r1-schedule-mobile-20261013.png', screenshots)), fullPage: true }) }
          if (path === '/admin/customers') { const dialog = await addClient(page); const box = await dialog.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width); await page.keyboard.press('Escape') }
        }
      }
      await goto(page, `/admin/quotes/${data.liveRequests[0].id}`); await shell(page); await tab(page, 'Summary').focus(); await page.keyboard.press('End'); assert.equal(await tab(page, 'Activity').getAttribute('aria-selected'), 'true')
      assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true)
      const timing = await tab(page, 'Activity').evaluate(element => ({ animation: getComputedStyle(element).animationName, transition: getComputedStyle(element).transitionDuration })); assert.equal(timing.animation, 'none'); assert.ok(timing.transition.split(',').every(value => parseFloat(value) <= .02))
      return { widths: [320,390,768,1280,1440], pagesPerWidth: paths.length, reducedMotion: timing, keyboardEnd: true }
    })
    await scenario('Access loss clears private details and retained dialog input', async page => {
      await page.clock.install(); await goto(page, '/admin/customers'); await shell(page); await addClient(page, 'Synthetic secret draft removed on access loss')
      await control({ signedOut: true }); await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.locator('#staff-access-content').waitFor()
      assert.equal((await page.locator('body').innerText()).includes('Synthetic secret draft'), false); assert.equal(await page.locator('.customers-console').count(), 0)
      await control({ signedOut: false }); await page.reload(); await shell(page); const dialog = await addClient(page); assert.equal(await dialog.locator('#customer-name').inputValue(), '')
      return { privateUiRemoved: true, draftCleared: true }
    })
  }
  assert.deepEqual(external, [], 'No browser requests may leave the synthetic origin'); assert.deepEqual(pageErrors, [], 'No uncaught browser errors'); assert.deepEqual(unexpectedResources, [], 'Unexpected HTTP failures must be resolved, not ignored')
  process.stdout.write(JSON.stringify({ synthetic: true, passed: outcomes.length, outcomes, skipped, external, pageErrors, unexpectedResources, consoles }, null, 2) + '\n')
} finally { await browser.close() }
