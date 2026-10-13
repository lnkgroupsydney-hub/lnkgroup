// Isolated local checks for the persistent Operations provider and public CSS.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { setTimeout as pause } from 'node:timers/promises'
const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1]
const base = new URL(args.includes('--base') ? option('--base') : 'http://127.0.0.1:3025')
const publicBase = new URL(args.includes('--public-base') ? option('--public-base') : 'http://127.0.0.1:3020')
for (const url of [base, publicBase]) if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Only isolated loopback origins are allowed.')
const { chromium } = args.includes('--playwright') ? await import(pathToFileURL(option('--playwright')).href) : await import('playwright')
async function control(body) {
  const response = await fetch(new URL('/__fixture/control', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal(response.ok, true); assert.equal((await response.json()).synthetic, true)
}
async function state() { const value = await (await fetch(new URL('/__fixture/state', base))).json(); assert.equal(value.synthetic, true); return value }
async function until(predicate) { for (let i = 0; i < 100; i++) { const value = await state(); if (predicate(value)) return value; await pause(50) } throw new Error('Synthetic state condition was not reached.') }
await control({ reset: true })
const browser = await chromium.launch({ headless: true, ...(args.includes('--channel') ? { channel: option('--channel') } : {}) })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), errors = [], external = [], outcomes = []
await context.route('**/*', route => {
  const url = new URL(route.request().url())
  if (![base.origin, publicBase.origin].includes(url.origin) && !['blob:', 'data:'].includes(url.protocol)) { external.push(url.origin + url.pathname); return route.abort('blockedbyclient') }
  return route.continue()
})
let page = await context.newPage(), publicContext
page.on('pageerror', error => errors.push(error.message))
const ready = () => page.locator('main#admin-main').waitFor()
const passed = name => { outcomes.push(name); process.stdout.write(`PASS ${name}\n`) }
try {
  for (const [path, expected] of [['/admin#operations-content', '/admin/enquiries'], ['/admin#customers-heading', '/admin/customers'], ['/admin#staff-session-security-heading', '/admin/settings'], ['/admin#signed-demo-requests', '/admin/schedule'], ['/admin?google=connected', '/admin/settings']]) {
    await page.goto(new URL(path, base).href); await page.waitForURL(url => url.pathname === expected); await ready()
  }
  assert.equal((await state()).requests.some(item => ['/api/operations/calendars', '/api/operations/gmail/labels'].includes(item.path)), false)
  passed('five legacy admin addresses and admin owner-options boundary')
  await control({ reset: true, staffRole: 'owner', connected: true }); await page.clock.install()
  await page.goto(new URL('/admin', base).href); await ready(); await until(value => value.requests.some(item => item.path === '/api/operations'))
  for (const path of ['/admin/customers', '/admin/enquiries', '/admin/schedule', '/admin/quotes', '/admin/settings']) {
    await page.locator(`nav a[href="${path}"]`).first().click(); await page.waitForURL(url => url.pathname === path); await ready()
  }
  await until(value => value.requests.some(item => item.path === '/api/operations/calendars'))
  assert.equal((await state()).requests.filter(item => item.path === '/api/operations/session').length, 1)
  await page.clock.fastForward(60_001); await until(value => value.requests.some(item => item.path === '/api/operations/sync'))
  assert.equal((await state()).requests.filter(item => item.path === '/api/operations/sync').length, 1)
  passed('single Operations controller and owner auto-sync across routes')
  await control({ authStage: 'signed_out', failures: { '/api/operations/sync': { status: 401, once: true } } }); await page.clock.fastForward(60_001)
  await page.locator('#staff-access-content').waitFor()
  const ended = (await state()).requests.filter(item => item.path === '/api/operations/sync').length
  await page.clock.fastForward(120_001); await pause(100)
  assert.equal((await state()).requests.filter(item => item.path === '/api/operations/sync').length, ended)
  assert.equal(await page.locator('.customers-console,.ems-schedule-list,.lq-admin,.staff-session-security').count(), 0)
  passed('401 clears private workspace and stops owner sync')
  // Clock controls are context-scoped. Use a fresh context for real-time public UI.
  publicContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await publicContext.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== publicBase.origin && !['blob:', 'data:'].includes(url.protocol)) { external.push(url.origin + url.pathname); return route.abort('blockedbyclient') }
    return route.continue()
  })
  page = await publicContext.newPage(); page.on('pageerror', error => errors.push(error.message))
  await page.goto(new URL('/services/cabinet-painting', publicBase).href); await page.locator('h1').waitFor(); await page.evaluate(() => document.fonts.ready)
  const publicStyle = () => page.evaluate(() => {
    const elements = [document.body, document.querySelector('h1'), document.querySelector('button.cabinet-header-quote')].filter(Boolean)
    return elements.map(element => { const style = getComputedStyle(element); return { tag: element.tagName, fontSize: style.fontSize, fontFamily: style.fontFamily, color: style.color, background: style.backgroundColor, borderRadius: style.borderRadius, minHeight: style.minHeight } })
  })
  const before = await publicStyle(); assert.equal(await page.locator('.ems-root').count(), 0)
  for (const name of ['tokens', 'layout', 'components', 'motion']) await page.addStyleTag({ content: await readFile(new URL(`../src/shared/styles/admin-${name}.css`, import.meta.url), 'utf8') })
  assert.deepEqual(await publicStyle(), before)
  passed('actual public KCP body/title/quote-control styles survive all EMS stylesheets')
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  process.stdout.write(JSON.stringify({ synthetic: true, passed: outcomes.length, outcomes, pageErrors: errors, externalRequests: external }) + '\n')
} finally { await publicContext?.close(); await context.close(); await browser.close() }
