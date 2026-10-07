// Additional synthetic-only QA for lifecycle, delayed responses and session cleanup.
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { setTimeout as pause } from 'node:timers/promises'

const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1]
const base = new URL(args.includes('--base') ? option('--base') : 'http://127.0.0.1:3013')
if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Targeted QA requires a loopback synthetic fixture.')
const { chromium } = args.includes('--playwright') ? await import(pathToFileURL(option('--playwright')).href) : await import('playwright')
async function control(value) {
  const response = await fetch(new URL('/__fixture/control', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
  assert.equal(response.ok, true); assert.equal((await response.json()).synthetic, true)
}
async function state() { const value = await (await fetch(new URL('/__fixture/state', base))).json(); assert.equal(value.synthetic, true); return value }
async function waitState(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) { const value = await state(); if (predicate(value)) return value; await pause(25) }
  throw new Error('Targeted QA timed out waiting for synthetic requests.')
}
await control({ reset: true })
const browser = await chromium.launch({ headless: true, ...(args.includes('--channel') ? { channel: option('--channel') } : {}) })
const outcomes = [], consoleMessages = [], failedResources = [], failedRequests = [], pageErrors = [], external = []
const ready = page => page.locator('nav a[href="/admin"]').first().waitFor({ state: 'attached' })
const count = (value, path) => value.requests.filter(item => item.path === path).length
async function scenario(name, run) {
  await control({ reset: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== base.origin && !['data:', 'blob:'].includes(url.protocol)) { external.push(url.origin + url.pathname); return route.abort('blockedbyclient') }
    return route.continue()
  })
  const page = await context.newPage()
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) consoleMessages.push({ scenario: name, type: message.type(), text: message.text(), url: message.location().url }) })
  page.on('response', response => { if (response.status() >= 400) failedResources.push({ scenario: name, path: new URL(response.url()).pathname, status: response.status() }) })
  page.on('requestfailed', request => failedRequests.push({ scenario: name, path: new URL(request.url()).pathname, error: request.failure()?.errorText }))
  page.on('pageerror', error => pageErrors.push({ scenario: name, error: error.message }))
  try { await run(page); outcomes.push({ name, result: 'passed' }); process.stdout.write(`PASS ${name}\n`) }
  catch (cause) { process.stderr.write(`FAIL ${name} at ${page.url()}\n${(await page.locator('body').innerText().catch(() => '')).slice(0,6000)}\n`); await page.screenshot({ path: '/tmp/lk-ems-d1-targeted-failure.png', fullPage: true }).catch(() => {}); throw cause }
  finally { await context.close() }
}
try {
  await scenario('auth stages and unavailable state have one main landmark', async page => {
    for (const authStage of ['signed_out', 'password_change', 'email_verify', 'mfa_enroll', 'mfa_verify']) {
      await control({ reset: true, authStage }); await page.goto(new URL('/admin/customers', base).href)
      await page.locator('#staff-access-content').waitFor(); await pause(50)
      assert.equal(await page.locator('main').count(), 1, authStage)
      assert.equal((await state()).requests.some(item => !item.path.startsWith('/api/admin-auth/')), false)
    }
    await control({ reset: true, failures: { '/api/admin-auth/session': 503 } })
    await page.goto(new URL('/admin', base).href); await page.getByRole('heading', { name: 'Access unavailable', exact: true }).waitFor()
    assert.equal(await page.locator('main').count(), 1)
  })
  await scenario('booking selected detail polls once each 15s and stops after route exit', async page => {
    await page.clock.install(); await page.goto(new URL('/admin/schedule', base).href); await ready(page)
    const detailPath = `/api/operations/bookings/${(await state()).bookings[0].submission.id}`, changesPath = `${detailPath}/changes`
    await page.getByRole('button', { name: /^SYNTHETIC-DEMO-001/ }).click()
    await page.getByText('Original signed submission · preserved', { exact: true }).waitFor()
    await waitState(value => count(value, changesPath) === 1)
    const before = await state(); await page.clock.fastForward(15_001)
    await waitState(value => count(value, detailPath) > count(before, detailPath) && count(value, changesPath) > count(before, changesPath))
    assert.equal(count(await state(), detailPath) - count(before, detailPath), 1)
    assert.equal(count(await state(), changesPath) - count(before, changesPath), 1)
    await page.locator('nav a[href="/admin/customers"]').first().click(); await page.waitForURL('**/admin/customers')
    const exited = await state(); await page.clock.fastForward(30_001); await pause(100)
    assert.equal(count(await state(), detailPath), count(exited, detailPath)); assert.equal(count(await state(), changesPath), count(exited, changesPath))
  })
  await scenario('booking polling 403 clears all private data and stops requests', async page => {
    await page.clock.install(); await page.goto(new URL('/admin/schedule', base).href); await ready(page)
    const detailPath = `/api/operations/bookings/${(await state()).bookings[0].submission.id}`
    await page.getByRole('button', { name: /^SYNTHETIC-DEMO-001/ }).click(); await page.getByText('Original signed submission · preserved', { exact: true }).waitFor()
    await control({ authStage: 'signed_out', failures: { [detailPath]: { status: 403, once: true } } })
    await page.clock.fastForward(15_001); await page.locator('#staff-access-content').waitFor()
    const stopped = await state(); await page.clock.fastForward(30_001); await pause(100)
    assert.equal(count(await state(), detailPath), count(stopped, detailPath))
    assert.equal(await page.locator('.bookings-panel,.customers-console,.operations-enquiries').count(), 0)
    assert.equal(await page.locator('main').count(), 1)
  })
  await scenario('captured slow operations success cannot restore data after logout', async page => {
    await control({ responseDelays: { '/api/operations': 800 } })
    await page.goto(new URL('/admin/enquiries', base).href); await ready(page)
    await waitState(value => count(value, '/api/operations') === 1); await pause(50)
    await control({ authStage: 'signed_out' }); await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.locator('#staff-access-content').waitFor(); await pause(1000)
    assert.equal(await page.locator('.operations-enquiries,nav[aria-label="Administrator workspace"]').count(), 0)
    assert.equal((await page.locator('body').innerText()).includes('Synthetic Source Contact'), false)
    assert.equal(await page.locator('main').count(), 1)
  })
  await scenario('slow booking detail cannot reappear after route exit', async page => {
    await page.goto(new URL('/admin/schedule', base).href); await ready(page)
    const detailPath = `/api/operations/bookings/${(await state()).bookings[0].submission.id}`
    await control({ responseDelays: { [detailPath]: 800 } })
    await page.getByRole('button', { name: /^SYNTHETIC-DEMO-001/ }).click(); await waitState(value => count(value, detailPath) === 1)
    await page.locator('nav a[href="/admin/customers"]').first().click(); await page.waitForURL('**/admin/customers'); await pause(1000)
    assert.equal(await page.locator('.booking-detail,.bookings-panel').count(), 0)
    assert.equal(await page.getByText('Original signed submission · preserved', { exact: true }).count(), 0)
  })
  await scenario('session cleanup uncertain outcome survives history and retries without replay', async page => {
    await page.goto(new URL('/admin', base).href); await ready(page)
    await page.locator('nav a[href="/admin/settings"]').first().click(); await page.waitForURL('**/admin/settings')
    await page.getByRole('heading', { name: 'Current session', exact: true }).waitFor()
    await control({ sessionCleanupFail: true })
    await page.getByRole('button', { name: 'Sign out other sessions', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm sign out', exact: true }).click()
    await page.getByRole('button', { name: 'Retry session cleanup', exact: true }).waitFor()
    await waitState(value => value.otherSessionCount === 0 && count(value, '/api/admin-auth/sessions/revoke-others') === 1)
    assert.equal((await state()).otherSessionCount, 0)
    await page.locator('nav a[href="/admin/customers"]').first().click()
    await page.getByRole('heading', { name: 'A request is still in progress', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Discard and continue', exact: true }).isDisabled(), true)
    await page.getByRole('button', { name: 'Return to form', exact: true }).click()
    await page.goBack(); await page.waitForURL(url => url.pathname === '/admin')
    await page.goForward(); await page.waitForURL('**/admin/settings')
    await page.getByRole('button', { name: 'Retry session cleanup', exact: true }).waitFor()
    assert.equal(count(await state(), '/api/admin-auth/sessions/revoke-others'), 1, 'Returning does not replay the uncertain command')
    await control({ sessionCleanupFail: false })
    await page.getByRole('button', { name: 'Retry session cleanup', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm cleanup retry', exact: true }).click()
    await page.getByText('Other sessions have been signed out. Your current session is still open.', { exact: true }).waitFor()
    assert.equal(count(await state(), '/api/admin-auth/sessions/revoke-others'), 2)
    assert.equal((await state()).authStage, 'ready'); assert.equal((await state()).signedOut, false)
  })
  await scenario('explicit sign-out clears active uncertain cleanup and inactive customer drafts', async page => {
    await page.goto(new URL('/admin', base).href); await ready(page)
    await page.locator('nav a[href="/admin/customers"]').first().click(); await page.waitForURL('**/admin/customers')
    await page.locator('#customer-name').fill('Synthetic draft removed by sign-out')
    await page.goBack(); await page.waitForURL(url => url.pathname === '/admin')
    await page.locator('nav a[href="/admin/settings"]').first().click(); await page.waitForURL('**/admin/settings')
    await page.getByRole('heading', { name: 'Current session', exact: true }).waitFor(); await control({ sessionCleanupFail: true })
    await page.getByRole('button', { name: 'Sign out other sessions', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm sign out', exact: true }).click()
    await waitState(value => value.otherSessionCount === 0 && count(value, '/api/admin-auth/sessions/revoke-others') === 1)
    await page.locator('summary[aria-label="Administrator account"]').click()
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await page.getByRole('heading', { name: 'Sign out of your workspace?', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Sign out and clear drafts', exact: true }).isEnabled(), true)
    await page.getByRole('button', { name: 'Return to form', exact: true }).click()
    assert.equal((await state()).authStage, 'ready')
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await page.getByRole('button', { name: 'Sign out and clear drafts', exact: true }).click()
    await page.locator('#staff-access-content').waitFor()
    await waitState(value => value.signedOut && count(value, '/api/admin-auth/logout') === 1)
    assert.equal((await state()).signedOut, true)
    assert.equal(await page.locator('.customers-console,.staff-session-security,nav[aria-label="Administrator workspace"]').count(), 0)
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor()
    await control({ authStage: 'ready', sessionCleanupFail: false }); await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await ready(page)
    await page.getByRole('heading', { name: 'Current session', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Retry session cleanup', exact: true }).count(), 0)
    assert.equal(count(await state(), '/api/admin-auth/sessions/revoke-others'), 1, 'Signing in again never replays cleanup')
    await page.locator('nav a[href="/admin/customers"]').first().click(); await page.waitForURL('**/admin/customers')
    assert.equal(await page.locator('#customer-name').inputValue(), '')
  })
  await scenario('latest synthetic desktop and 390px schedule screenshots', async page => {
    await page.goto(new URL('/admin', base).href); await ready(page)
    await page.screenshot({ path: '/tmp/lk-ems-d1-desktop.png', fullPage: true })
    await page.setViewportSize({ width: 390, height: 950 }); await page.goto(new URL('/admin/schedule', base).href); await ready(page)
    await page.getByRole('button', { name: /^SYNTHETIC-DEMO-001/ }).click(); await page.getByText('Original signed submission · preserved', { exact: true }).waitFor()
    await page.getByRole('img', { name: 'Original submitted service photo 1' }).evaluate(image => image.decode())
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: '/tmp/lk-ems-d1-mobile.png', fullPage: true })
  })
  const expectedResourceConsole = consoleMessages.filter(message => /^Failed to load resource: the server responded with a status of (401|403|503)\b/.test(message.text) && message.url.startsWith(base.origin) && failedResources.some(resource => resource.scenario === message.scenario && resource.path === new URL(message.url).pathname))
  // The auth screen's homepage Link may prefetch /. The fixture deliberately
  // never proxies that public route. Keep these blocked requests in the report
  // separately from injected API failures, rather than expanding the allowlist.
  const blockedHomepagePrefetchConsole = consoleMessages.filter(message => {
    if (!/^Failed to load resource: the server responded with a status of 404\b/.test(message.text) || !message.url.startsWith(base.origin)) return false
    const url = new URL(message.url)
    return url.pathname === '/' && url.searchParams.has('_rsc') && failedResources.some(resource => resource.scenario === message.scenario && resource.path === '/' && resource.status === 404)
  })
  const unexpectedConsole = consoleMessages.filter(message => !expectedResourceConsole.includes(message) && !blockedHomepagePrefetchConsole.includes(message))
  assert.deepEqual(external, []); assert.deepEqual(pageErrors, []); assert.deepEqual(unexpectedConsole, [])
  assert.equal(failedRequests.every(request => request.path.startsWith('/api/') && /ERR_ABORTED|ERR_FAILED/.test(request.error)), true, 'Only canceled private fetches are expected during route/auth teardown')
  process.stdout.write(JSON.stringify({ synthetic: true, outcomes, console: { unexpected: unexpectedConsole, expectedInjectedResourceErrors: expectedResourceConsole, blockedHomepagePrefetchErrors: blockedHomepagePrefetchConsole }, failedResources, canceledPrivateRequests: failedRequests, pageErrors, external, screenshots: ['/tmp/lk-ems-d1-desktop.png', '/tmp/lk-ems-d1-mobile.png'] }, null, 2) + '\n')
} finally { await control({ reset: true }); await browser.close() }
