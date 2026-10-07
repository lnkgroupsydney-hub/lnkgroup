// Final synthetic-only business-screen regressions. Never uses real signatures,
// Auth cookies, email delivery, Calendar or DB APIs.
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { setTimeout as pause } from 'node:timers/promises'

const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1]
const base = new URL(args.includes('--base') ? option('--base') : 'http://127.0.0.1:3013')
if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Workflow QA requires the loopback synthetic fixture.')
const { chromium } = args.includes('--playwright') ? await import(pathToFileURL(option('--playwright')).href) : await import('playwright')
async function control(value) {
  const response = await fetch(new URL('/__fixture/control', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
  assert.equal(response.ok, true); assert.equal((await response.json()).synthetic, true)
}
async function state() { const value = await (await fetch(new URL('/__fixture/state', base))).json(); assert.equal(value.synthetic, true); return value }
async function waitState(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) { const value = await state(); if (predicate(value)) return value; await pause(25) }
  throw new Error('Workflow QA timed out waiting for synthetic state.')
}
await control({ reset: true })
const browser = await chromium.launch({ headless: true, ...(args.includes('--channel') ? { channel: option('--channel') } : {}) })
const outcomes = [], consoles = [], resources = [], pageErrors = [], external = []
async function scenario(name, run) {
  await control({ reset: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== base.origin && !['data:', 'blob:'].includes(url.protocol)) { external.push(url.origin + url.pathname); return route.abort('blockedbyclient') }
    return route.continue()
  })
  const page = await context.newPage()
  page.on('console', message => { if (['warning', 'error'].includes(message.type())) consoles.push({ scenario: name, type: message.type(), text: message.text(), url: message.location().url }) })
  page.on('response', response => { if (response.status() >= 400) resources.push({ scenario: name, path: new URL(response.url()).pathname, status: response.status() }) })
  page.on('pageerror', error => pageErrors.push({ scenario: name, message: error.message }))
  try { const evidence = await run(page); outcomes.push({ name, result: 'passed', evidence }); process.stdout.write(`PASS ${name}: ${JSON.stringify(evidence)}\n`) }
  catch (cause) { process.stderr.write(`FAIL ${name} at ${page.url()}\n${(await page.locator('body').innerText().catch(() => '')).slice(0,8000)}\n`); await page.screenshot({ path: '/tmp/lk-ems-d1-workflow-failure.png', fullPage: true }).catch(() => {}); throw cause }
  finally { await context.close() }
}
async function openCustomer(page) {
  await page.goto(new URL('/admin/customers', base).href)
  await page.getByRole('button', { name: 'Open customer', exact: true }).first().click()
  await page.getByRole('heading', { name: 'Classification history', exact: true }).waitFor()
}
async function reviewLink(page, reason) {
  await page.getByRole('button', { name: 'Review link to selected customer', exact: true }).first().click()
  await page.locator('#customer-link-reason').fill(reason); await page.locator('#customer-link-confirm').check()
}
try {
  await scenario('Customers link, classification audit and unlink preserve source and increase revision', async page => {
    const initial = await state(), customerId = initial.customers[0].id, source = initial.records[0]
    await openCustomer(page); await reviewLink(page, 'Synthetic verified manual link')
    await page.getByRole('button', { name: 'Confirm link', exact: true }).click()
    await page.getByText('Record linked. The source record and its documents were preserved.', { exact: true }).waitFor()
    await page.locator('.customers-audit').getByText('Record linked', { exact: true }).waitFor()
    const linked = await waitState(value => value.links.some(([sourceId, id]) => sourceId === source.sourceId && id === customerId))
    assert.equal(linked.customers.find(customer => customer.id === customerId).revision, 2)
    assert.equal(linked.audits.find(([id]) => id === customerId)[1][0].action, 'link')
    assert.deepEqual(linked.records[0], source)
    await page.getByRole('button', { name: 'Review unlink', exact: true }).click()
    await page.locator('#customer-link-reason').fill('Synthetic verified manual unlink'); await page.locator('#customer-link-confirm').check()
    await page.getByRole('button', { name: 'Confirm unlink', exact: true }).click()
    await page.getByText('Record unlinked. The source record and the audit history were preserved.', { exact: true }).waitFor()
    await page.locator('.customers-audit').getByText('Record unlinked', { exact: true }).waitFor()
    const unlinked = await state(), audit = unlinked.audits.find(([id]) => id === customerId)[1]
    assert.equal(unlinked.customers.find(customer => customer.id === customerId).revision, 3)
    assert.equal(unlinked.links.length, 0); assert.deepEqual(audit.map(event => event.action), ['unlink', 'link', 'create'])
    assert.deepEqual(unlinked.records[0], source)
    return { revisions: [1, 2, 3], auditActions: audit.map(event => event.action), sourcePreserved: true }
  })
  await scenario('Customers 409 conflict clears confirmation, preserves reason and requires fresh review', async page => {
    const initial = await state(), customerId = initial.customers[0].id
    await openCustomer(page); await reviewLink(page, 'Synthetic conflict reason preserved')
    await control({ conflictNextLink: true }); await page.getByRole('button', { name: 'Confirm link', exact: true }).click()
    await page.getByText('The customer or record changed. Review the refreshed customer and source, then confirm a new request. Your reason was kept.', { exact: true }).waitFor()
    await page.getByText(/Customer revision 2 · Updated/).waitFor()
    assert.equal(await page.locator('#customer-link-reason').inputValue(), 'Synthetic conflict reason preserved')
    assert.equal(await page.locator('#customer-link-confirm').isChecked(), false)
    assert.equal(await page.getByRole('button', { name: 'Confirm link', exact: true }).isDisabled(), true)
    assert.equal((await state()).links.length, 0)
    await page.locator('#customer-link-confirm').check(); await page.getByRole('button', { name: 'Confirm link', exact: true }).click()
    await page.getByText('Record linked. The source record and its documents were preserved.', { exact: true }).waitFor()
    const result = await state(), audit = result.audits.find(([id]) => id === customerId)[1]
    assert.equal(result.customers.find(customer => customer.id === customerId).revision, 3)
    assert.equal(result.links.length, 1); assert.equal(audit[0].reason, 'Synthetic conflict reason preserved')
    assert.equal(result.requests.filter(request => request.path.endsWith('/links')).length, 2)
    return { conflictRevision: 2, confirmedRevision: 3, linkRequests: 2, reasonPreserved: true }
  })
  await scenario('Schedule proposal save, synthetic reconfirmation, refresh and confirmation', async page => {
    const initial = await state(), original = initial.bookings[0].submission
    await page.goto(new URL('/admin/schedule', base).href)
    await page.getByRole('button', { name: /^SYNTHETIC-DEMO-001/ }).click()
    await page.getByText('Original signed submission · preserved', { exact: true }).waitFor()
    await page.getByLabel('Start (Sydney)', { exact: true }).fill('2026-10-12T09:00')
    await page.getByLabel('End (Sydney)', { exact: true }).fill('2026-10-12T10:00')
    await page.getByLabel('Notes shown to the customer', { exact: true }).fill('Synthetic work proposal only')
    await page.getByRole('button', { name: 'Save new proposal for customer review', exact: true }).click()
    await page.getByText('New work proposal saved. The customer must review and sign these exact segments before company confirmation.', { exact: true }).waitFor()
    let result = await state(); assert.equal(result.bookings[0].booking.revision, 2); assert.equal(result.bookings[0].proposals.length, 1)
    assert.equal(await page.getByRole('button', { name: 'Check conflicts and confirm demo', exact: true }).isDisabled(), true)
    await control({ signPendingProposals: true })
    await page.getByRole('button', { name: 'Refresh this request', exact: true }).click()
    await page.getByText(/^Signed by Synthetic Signer ·/).waitFor()
    await page.getByRole('button', { name: 'Check conflicts and confirm demo', exact: true }).click()
    await page.getByText('Demo confirmation and Google verification are complete.', { exact: true }).waitFor()
    result = await state(); const booking = result.bookings[0]
    assert.equal(booking.booking.revision, 3); assert.equal(booking.booking.status, 'confirmed'); assert.equal(booking.booking.syncStatus, 'synced')
    assert.equal(booking.booking.confirmedProposalId, booking.proposals[0].id); assert.deepEqual(booking.submission, original)
    assert.equal(result.requests.filter(request => request.method === 'POST' && request.path.endsWith('/proposals')).length, 1)
    assert.equal(result.requests.filter(request => request.method === 'POST' && request.path.endsWith('/confirm')).length, 1)
    return { bookingRevisions: [1, 2, 3], proposals: 1, status: booking.booking.status, originalSubmissionPreserved: true, signatureSource: 'fixture control only', externalCalls: 0 }
  })
  await scenario('Enquiries provisional schedule edit persists the original revision contract', async page => {
    const initial = await state(), original = initial.enquiries[0]
    await page.goto(new URL('/admin/enquiries', base).href)
    await page.getByRole('button', { name: /^SYNTHETIC-ENQ-1/ }).click()
    await page.getByRole('heading', { name: 'Provisional Sydney schedule', exact: true }).waitFor()
    await page.getByLabel('Start (Sydney)', { exact: true }).fill('2026-10-12T11:00')
    await page.getByLabel('End (Sydney)', { exact: true }).fill('2026-10-12T12:00')
    await page.getByLabel(/Internal schedule note/).fill('Synthetic internal scheduling note')
    await page.getByRole('button', { name: 'Save provisional time', exact: true }).click()
    await page.getByText(`${original.reference} has a provisional time. It is not a confirmed customer booking.`, { exact: true }).waitFor()
    const result = await state(), enquiry = result.enquiries[0]
    assert.equal(enquiry.id, original.id); assert.equal(enquiry.revision, 2); assert.equal(enquiry.status, 'provisional')
    assert.equal(enquiry.startAt, '2026-10-12T11:00:00+11:00'); assert.equal(enquiry.endAt, '2026-10-12T12:00:00+11:00')
    assert.equal(enquiry.scheduleNotes, 'Synthetic internal scheduling note'); assert.deepEqual(enquiry.gmail, original.gmail)
    assert.equal(await page.getByLabel('Start (Sydney)', { exact: true }).inputValue(), '2026-10-12T11:00')
    return { revisions: [1, 2], status: enquiry.status, originalThreadPreserved: true, startAt: enquiry.startAt, endAt: enquiry.endAt }
  })
  const injected409 = consoles.filter(message => /^Failed to load resource: the server responded with a status of 409\b/.test(message.text) && message.url.startsWith(base.origin) && resources.some(resource => resource.scenario === message.scenario && resource.path === new URL(message.url).pathname && resource.status === 409))
  const blockedHomepagePrefetch = consoles.filter(message => /^Failed to load resource: the server responded with a status of 404\b/.test(message.text) && message.url.startsWith(base.origin) && new URL(message.url).pathname === '/' && new URL(message.url).searchParams.has('_rsc'))
  const unexpectedConsole = consoles.filter(message => !injected409.includes(message) && !blockedHomepagePrefetch.includes(message))
  assert.deepEqual(unexpectedConsole, []); assert.deepEqual(pageErrors, []); assert.deepEqual(external, [])
  process.stdout.write(JSON.stringify({ synthetic: true, outcomes, console: { unexpected: unexpectedConsole, injected409, blockedHomepagePrefetch }, resources, pageErrors, external, notExecuted: ['Real customer identity matching or DB linking', 'Real customer signature, email, Google conflict/occupancy verification', 'Real Calendar confirmation'] }, null, 2) + '\n')
} finally { await control({ reset: true }); await browser.close() }
