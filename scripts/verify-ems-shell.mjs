// Run only against verify-esn-ui-fixture.mjs, never a real application origin.
// Example: node scripts/verify-ems-shell.mjs --base http://127.0.0.1:3013 --playwright /absolute/path/to/playwright/index.mjs --channel chrome
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { setTimeout as pause } from 'node:timers/promises'

const args = process.argv.slice(2)
const option = name => args[args.indexOf(name) + 1]
const base = new URL(args.includes('--base') ? option('--base') : 'http://127.0.0.1:3013')
if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('QA requires a loopback synthetic fixture origin.')
const { chromium } = args.includes('--playwright') ? await import(pathToFileURL(option('--playwright')).href) : await import('playwright')
async function control(value) {
  const response = await fetch(new URL('/__fixture/control', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
  assert.equal(response.ok, true)
  assert.equal((await response.json()).synthetic, true, 'Refuse any origin without the synthetic fixture control marker.')
}
async function state() { const value = await (await fetch(new URL('/__fixture/state', base))).json(); assert.equal(value.synthetic, true); return value }
async function waitState(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) { const value = await state(); if (predicate(value)) return value; await pause(50) }
  throw new Error('Timed out waiting for the synthetic request/state condition.')
}
await control({ reset: true })
const browser = await chromium.launch({ headless: true, ...(args.includes('--channel') ? { channel: option('--channel') } : {}) })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const unexpected = [], errors = [], outcomes = []
await context.route('**/*', route => {
  const url = new URL(route.request().url())
  if (url.origin !== base.origin && !['data:', 'blob:'].includes(url.protocol)) { unexpected.push(url.origin + url.pathname); return route.abort('blockedbyclient') }
  return route.continue()
})
const page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))
const routes = ['/admin', '/admin/customers', '/admin/enquiries', '/admin/quotes', '/admin/schedule', '/admin/settings', '/admin/jobs', '/admin/orders', '/admin/inventory', '/admin/reports']
const ready = async () => { await page.locator('main').waitFor(); await page.locator('nav a[href="/admin"]').first().waitFor({ state: 'attached' }) }
const check = (name, detail = '') => { outcomes.push({ name, result: 'passed', detail }); process.stdout.write(`PASS ${name}${detail ? `: ${detail}` : ''}\n`) }
try {
  for (const authStage of ['signed_out', 'password_change', 'email_verify', 'mfa_enroll', 'mfa_verify']) {
    await control({ reset: true, authStage })
    await page.goto(new URL('/admin/customers', base).href)
    await page.locator('#staff-access-content').waitFor()
    await page.waitForTimeout(100)
    const requests = (await state()).requests
    assert.equal(requests.some(item => !item.path.startsWith('/api/admin-auth/')), false, `${authStage} must not mount private API clients`)
    check(`auth stage ${authStage} protects direct subroute`)
  }
  await control({ reset: true })
  for (const path of routes) {
    const response = await page.goto(new URL(path, base).href)
    assert.equal(response.status(), 200); assert.equal(response.headers()['x-esn-fixture'], 'synthetic')
    await ready(); assert.equal(await page.locator('main').count(), 1); assert.equal(await page.locator('h1').count(), 1)
    check(`direct route ${path}`)
  }
  await page.goto(new URL('/admin', base).href); await ready()
  await page.locator('nav a[href="/admin/customers"]').first().click()
  await page.waitForURL('**/admin/customers'); await page.getByRole('heading', { name: 'Find a customer' }).waitFor()
  await page.goBack(); await page.waitForURL(url => url.pathname === '/admin'); await ready()
  check('RSC menu navigation and history')
  await page.goto(new URL('/admin/schedule', base).href); await ready()
  await page.getByRole('button', { name: /^SYNTHETIC-DEMO-001/ }).click()
  await page.getByText('Original signed submission · preserved', { exact: true }).waitFor()
  const photo = page.getByRole('img', { name: 'Original submitted service photo 1' })
  await photo.waitFor(); await photo.evaluate(image => image.decode())
  const pdfPath = await page.getByRole('link', { name: 'Download demo quote PDF', exact: true }).getAttribute('href')
  assert.equal(new URL(pdfPath, base).origin, base.origin)
  const pdf = await context.request.get(new URL(pdfPath, base).href)
  assert.equal(pdf.headers()['content-type'], 'application/pdf'); assert.match((await pdf.body()).toString(), /SYNTHETIC FIXTURE/)
  check('signed submission, private synthetic photo and PDF access')
  for (const width of [1440, 1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(new URL('/admin/customers', base).href); await ready()
    await page.getByRole('heading', { name: 'Find a customer' }).waitFor()
    await page.locator('.customers-cards h4').first().waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `Page overflow at ${width}px`)
    if (width < 901) {
      const open = page.getByRole('button', { name: 'Open navigation', exact: true }), drawer = page.locator('#admin-mobile-menu')
      await open.click(); await drawer.waitFor(); await page.keyboard.press('Escape'); await drawer.waitFor({ state: 'hidden' })
      assert.equal(await open.evaluate(button => document.activeElement === button), true, 'Escape returns focus to the menu trigger')
      await open.click(); await drawer.locator('a[href="/admin/settings"]').click(); await page.waitForURL('**/admin/settings'); await drawer.waitFor({ state: 'hidden' })
      await page.goBack(); await page.waitForURL('**/admin/customers'); await ready()
      check(`mobile menu Escape, focus and selection ${width}px`)
    }
    check(`viewport ${width}px reflows`)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(new URL('/admin', base).href); await ready()
  await page.locator('nav a[href="/admin/customers"]').first().click(); await page.waitForURL('**/admin/customers')
  await page.locator('#customer-name').fill('Synthetic unsaved draft')
  await page.locator('nav a[href="/admin/enquiries"]').first().click()
  await page.getByRole('heading', { name: 'You have unsaved changes', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Return to form', exact: true }).click()
  assert.equal(new URL(page.url()).pathname, '/admin/customers'); assert.equal(await page.locator('#customer-name').inputValue(), 'Synthetic unsaved draft')
  await page.goBack(); await page.waitForURL(url => url.pathname === '/admin')
  await page.goForward(); await page.waitForURL('**/admin/customers')
  assert.equal(await page.locator('#customer-name').inputValue(), 'Synthetic unsaved draft')
  await page.locator('nav a[href="/admin/enquiries"]').first().click()
  await page.getByRole('button', { name: 'Discard and continue', exact: true }).click(); await page.waitForURL('**/admin/enquiries')
  await page.goBack(); await page.waitForURL('**/admin/customers')
  assert.equal(await page.locator('#customer-name').inputValue(), '')
  check('customer dirty cancel, browser-history draft restoration and explicit discard')
  await control({ loseNextCreateResponse: true })
  await page.locator('#customer-name').fill('Synthetic idempotency recovery')
  await page.getByRole('button', { name: 'Create customer', exact: true }).click()
  await page.getByText('Synthetic saved customer response was lost. Retry unchanged details to recover the saved result.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Create customer', exact: true }).click()
  await page.getByText('Customer Synthetic idempotency recovery was created. Follow-up refresh errors do not undo the saved customer.', { exact: true }).waitFor()
  assert.equal((await state()).customers.filter(customer => customer.name === 'Synthetic idempotency recovery').length, 1)
  check('lost customer save response retries with one saved customer')
  await page.goto(new URL('/admin/settings', base).href); await ready()
  assert.equal((await state()).requests.some(item => item.path === '/api/operations/calendars' || item.path === '/api/operations/gmail/labels'), false, 'admin must not request owner options')
  check('admin does not request owner integration options')
  for (const [legacy, expected] of [['/admin#operations-content', '/admin/enquiries'], ['/admin#customers-heading', '/admin/customers'], ['/admin#staff-session-security-heading', '/admin/settings'], ['/admin#signed-demo-requests', '/admin/schedule'], ['/admin?google=connected', '/admin/settings']]) {
    await page.goto(new URL(legacy, base).href); await page.waitForURL(url => url.pathname === expected); await ready()
    check(`compatibility ${legacy}`)
  }
  if (args.includes('--effects')) {
    await control({ reset: true, staffRole: 'owner', connected: true })
    await page.clock.install()
    await page.goto(new URL('/admin', base).href); await ready()
    await waitState(value => value.requests.some(item => item.path === '/api/operations'))
    assert.equal((await state()).requests.some(item => item.path === '/api/operations/calendars' || item.path === '/api/operations/gmail/labels'), false, 'owner options should wait for Settings')
    for (const path of ['/admin/customers', '/admin/enquiries', '/admin/schedule', '/admin/quotes', '/admin/settings']) {
      await page.locator(`nav a[href="${path}"]`).first().click(); await page.waitForURL(url => url.pathname === path); await ready()
    }
    await waitState(value => value.requests.some(item => item.path === '/api/operations/calendars'))
    assert.equal((await state()).requests.filter(item => item.path === '/api/operations/session').length, 1, 'one controller session lookup throughout menu navigation')
    await page.clock.fastForward(60_001)
    await waitState(value => value.requests.some(item => item.path === '/api/operations/sync'))
    await pause(100)
    assert.equal((await state()).requests.filter(item => item.path === '/api/operations/sync').length, 1)
    check('one owner auto-sync after route navigation and one simulated minute')
    await control({ authStage: 'signed_out', failures: { '/api/operations/sync': { status: 401, once: true } } })
    await page.clock.fastForward(60_001)
    await page.locator('#staff-access-content').waitFor()
    const ended = (await state()).requests.filter(item => item.path === '/api/operations/sync').length
    await page.clock.fastForward(120_001); await pause(100)
    assert.equal((await state()).requests.filter(item => item.path === '/api/operations/sync').length, ended)
    assert.equal(await page.locator('.customers-console,.bookings-panel,.operations-enquiries').count(), 0)
    check('401 removes private subtree and stops owner auto-sync')
  }
  assert.deepEqual(unexpected, [], 'No browser requests may leave the fixture origin')
  assert.deepEqual(errors, [], 'No React/browser runtime errors')
  check('fixture origin isolation and runtime errors')
  process.stdout.write(JSON.stringify({ synthetic: true, outcomes, notExecuted: ['Real Auth/DB/email/Calendar', 'Actual customer linking/session revocation acceptance', 'Physical device and manual zoom', 'Booking-polling/slow-response/session-cleanup scenarios are covered by the separate targeted runner', ...(args.includes('--effects') ? [] : ['Owner timer and permission-loss checks; pass --effects to run'])] }, null, 2) + '\n')
} catch (cause) {
  process.stderr.write(`Synthetic QA failed at ${page.url()}\n${(await page.locator('body').innerText().catch(() => '')).slice(0,6000)}\n`)
  await page.screenshot({ path: '/tmp/lk-ems-d1-browser-failure.png', fullPage: true }).catch(() => {})
  throw cause
} finally { await context.close(); await browser.close() }
