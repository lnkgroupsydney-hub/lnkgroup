// Read-only local browser acceptance. All API calls are answered by browser
// fixtures, all external requests are aborted, and no customer data is entered.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const KCP = '/services/cabinet-painting'
const QUOTE = '/quote/start?service=cabinet-painting'
const defaultOutput = 'docs/verification/2026-10-13-kcp-landing'

function playwrightPackage() {
  const require = createRequire(import.meta.url)
  try { return require('playwright') } catch {
    return require(`${process.env.KCP_UI_RUNTIME_PACKAGES ?? process.env.QUOTE_UI_RUNTIME_PACKAGES ?? '/Users/jimee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'}/playwright`)
  }
}

export function localBase(value) {
  const url = new URL(value)
  assert.equal(url.protocol, 'http:', 'Use local HTTP only')
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Only strict loopback hosts are allowed')
  assert.ok(!url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Supply a plain loopback origin')
  return url.origin
}

function centralSuburbs() {
  const source = readFileSync(new URL('../src/modules/company-profile/content/company-content.ts', import.meta.url), 'utf8')
  return [...source.matchAll(/suburbs:\s*(\[[^\]]+\])/g)].flatMap(match => JSON.parse(match[1]))
}

export async function verifyKcpLanding({ upstream = 'http://127.0.0.1:3002', output = defaultOutput, only = '' } = {}) {
  const base = localBase(upstream)
  const directory = resolve(output)
  mkdirSync(directory, { recursive: true })
  const { chromium } = playwrightPackage()
  const browser = await chromium.launch({ headless: true, channel: process.env.KCP_UI_BROWSER_CHANNEL ?? 'chrome' })
  const report = {
    upstream: base, startedAt: new Date().toISOString(), checks: [],
    isolation: 'Fresh Playwright contexts; external requests aborted; every /api request fulfilled locally; no DB, API save/submit, company, AI, mail or Google calls.',
    limitations: ['Headless Chrome is not a physical device.', '200% text enlargement is simulated by root font-size; native browser zoom and actual 200% device/browser zoom are not certified.', 'No frame-rate, bundle-size, search-ranking or formal accessibility certification.'],
  }
  const suburbs = centralSuburbs()
  assert.equal(suburbs.length, 21)
  async function capture(page, path) {
    await page.waitForFunction(() => [...document.images].filter(image => {
      const bounds = image.getBoundingClientRect()
      return bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.top < innerHeight && bounds.right > 0 && bounds.left < innerWidth
    }).every(image => image.complete && image.naturalWidth > 0))
    await page.locator('img').evaluateAll(async images => {
      await Promise.all(images.filter(image => {
        const bounds = image.getBoundingClientRect()
        return bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.top < innerHeight && bounds.right > 0 && bounds.left < innerWidth
      }).map(image => image.decode()))
    })
    await page.screenshot({ path })
  }
  async function scenario(name, options, run) {
    if (only && !name.includes(only)) return
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference', serviceWorkers: 'block', ...options })
    const evidence = { name, passed: false, externalBlocked: [], apiFixtures: [], pageErrors: [], failedLocalResources: [], consoleWarnings: [] }
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== base) {
        evidence.externalBlocked.push({ origin: url.origin, path: url.pathname, method: request.method() })
        return route.abort('blockedbyclient')
      }
      if (url.pathname.startsWith('/api/')) {
        evidence.apiFixtures.push({ path: url.pathname, method: request.method() })
        const headers = { 'cache-control': 'no-store', 'x-kcp-ui-fixture': 'read-only' }
        if (request.method() === 'GET' && url.pathname === '/api/quote/requests/customer') return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ customer: null, requests: [], currentRequestId: null }) })
        if (request.method() === 'GET' && url.pathname === '/api/quote/requests') return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ request: null }) })
        return route.fulfill({ status: 503, contentType: 'application/json', headers, body: JSON.stringify({ error: 'Read-only browser acceptance: no session creation, save or submission is permitted.' }) })
      }
      if (!['GET', 'HEAD'].includes(request.method())) {
        evidence.apiFixtures.push({ path: url.pathname, method: request.method(), blockedNonApi: true })
        return route.abort('blockedbyclient')
      }
      return route.continue()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(12_000)
    page.on('pageerror', error => evidence.pageErrors.push(error.message))
    page.on('console', message => { if (message.type() === 'warning') evidence.consoleWarnings.push(message.text().slice(0, 500)) })
    page.on('response', response => {
      const url = new URL(response.url())
      if (url.origin === base && response.status() >= 400 && !url.pathname.startsWith('/api/')) evidence.failedLocalResources.push({ path: url.pathname, status: response.status() })
    })
    const file = name.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-')
    try {
      await run(page, context, evidence)
      assert.deepEqual(evidence.pageErrors, [], 'No browser runtime errors')
      assert.deepEqual(evidence.failedLocalResources, [], 'Local page/assets load successfully')
      evidence.passed = true
      await capture(page, `${directory}/${file}.png`)
      console.log(`PASS ${name}`)
    } catch (error) {
      evidence.error = error.stack ?? error.message
      await page.screenshot({ path: `${directory}/${file}-failure.png` }).catch(() => {})
      console.error(`FAIL ${name}: ${error.message}`)
    } finally {
      report.checks.push(evidence)
      writeFileSync(`${directory}/results.json`, JSON.stringify(report, null, 2))
      await context.close()
    }
  }

  async function open(page, path = KCP) {
    const previous = new URL(page.url())
    const response = await page.goto(`${base}${path}`, { waitUntil: 'networkidle' })
    if (response) assert.equal(response.status(), 200)
    else assert.equal(previous.origin + previous.pathname + previous.search, new URL(page.url()).origin + new URL(page.url()).pathname + new URL(page.url()).search, 'A response-less navigation must only change the local hash')
    await page.locator('main h1').waitFor()
  }
  async function structure(page) {
    const value = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map(element => element.id)
      const samePageFragments = [...document.querySelectorAll('a[href]')].map(link => new URL(link.getAttribute('href'), location.href)).filter(url => url.origin === location.origin && url.pathname === location.pathname && url.hash)
      return {
        width: innerWidth, documentWidth: document.documentElement.scrollWidth,
        h1: document.querySelectorAll('main h1').length,
        duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
        missingFragments: samePageFragments.filter(url => !document.getElementById(decodeURIComponent(url.hash.slice(1)))).map(url => url.hash),
        title: document.title, description: document.querySelector('meta[name="description"]')?.content,
        robots: document.querySelector('meta[name="robots"]')?.content,
      }
    })
    assert.equal(value.h1, 1)
    assert.deepEqual(value.duplicateIds, [])
    assert.deepEqual(value.missingFragments, [])
    assert.ok(value.documentWidth <= value.width + 1, `Horizontal overflow ${value.documentWidth}/${value.width}`)
    assert.ok(value.title && value.description)
    assert.equal(value.robots, process.env.SEO_EXPECT_INDEXABLE === 'true' ? 'index, follow' : 'noindex, nofollow')
    return value
  }
  const stageLinks = page => page.locator('.kcp-stage-nav ol a')
  async function currentStep(page, href) {
    await page.waitForFunction(expected => document.querySelector('.kcp-stage-nav a[aria-current="step"]')?.getAttribute('href') === expected, href)
  }
  async function reading(page) {
    return page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.kcp-chapter')]
      const nearest = nodes.reduce((best, element) => {
        const rect = element.getBoundingClientRect(), distance = Math.abs(rect.top + rect.height / 2 - innerHeight / 2)
        return !best || distance < best.distance ? { id: element.id, distance } : best
      }, null)
      return { nearest: nearest?.id, distance: nearest?.distance, focus: document.activeElement?.id, current: document.querySelector('.kcp-stage-nav a[aria-current="step"]')?.getAttribute('href'), progress: document.querySelector('.kcp-stage-nav ol')?.style.getPropertyValue('--kcp-track') }
    })
  }
  async function align(page, id) {
    await page.evaluate(id => {
      const rect = document.getElementById(id).getBoundingClientRect()
      scrollTo({ top: scrollY + rect.top + rect.height / 2 - innerHeight / 2, behavior: 'instant' })
    }, id)
    await page.waitForTimeout(120)
  }
  async function staticReading(page, id, requireFocus = false) {
    await page.waitForFunction(id => {
      const chapter = document.getElementById(id), bounds = chapter?.getBoundingClientRect()
      return document.querySelector('#cabinet-process')?.dataset.enhanced === 'false' && bounds && Math.abs(bounds.top + bounds.height / 2 - innerHeight / 2) < 4
    }, id)
    if (requireFocus) await page.waitForFunction(id => document.activeElement?.id === id, id)
    const measured = await reading(page)
    assert.equal(measured.nearest, id, 'Current reading chapter survives fallback')
    assert.ok(measured.distance < 4, 'Current chapter stays centred in viewport')
    if (requireFocus) assert.equal(measured.focus, id, 'Intentional view toggle keeps focus on reading chapter')
    assert.ok(await page.locator(`#${id} h3`).isVisible())
    return measured
  }
  async function enhanced(page) {
    await page.waitForFunction(() => document.querySelector('#cabinet-process')?.dataset.enhanced === 'true')
    assert.equal(await stageLinks(page).count(), 9)
  }
  async function stageControls(page) {
    const value = await page.locator('.kcp-stage-nav').evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return { top: bounds.top, bottom: bounds.bottom, height: bounds.height, viewportHeight: innerHeight }
    })
    assert.ok(value.height > 0 && value.top >= -1 && value.bottom <= value.viewportHeight + 1, `Process controls fit within viewport: ${JSON.stringify(value)}`)
    return value
  }

  try {
    for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [1280, 720], [1440, 900], [1023, 700], [1024, 700], [1280, 699], [1280, 700]]) {
      await scenario(`viewport-${width}x${height}`, { viewport: { width, height } }, async (page, context, evidence) => {
        await open(page)
        evidence.structure = await structure(page)
        assert.equal(await page.locator('#cabinet-colours, .kcp-showroom, input[type="color"]').count(), 0)
        const nav = page.getByRole('navigation', { name: 'On this page', exact: true })
        assert.equal(await nav.locator('a').count(), 4)
        for (const href of await nav.locator('a').evaluateAll(links => links.map(link => link.getAttribute('href')))) {
          await nav.locator(`a[href="${href}"]`).click()
          assert.ok(await page.locator(href).isVisible())
        }
        await align(page, 'cabinet-process-existing')
        await page.waitForTimeout(180)
        assert.equal(await page.locator('#cabinet-process').getAttribute('data-enhanced'), String(width >= 1024 && height >= 700))
        if (width >= 1024 && height >= 700) evidence.firstStepControls = await stageControls(page)
        await structure(page)
        const firstFaq = page.locator('#cabinet-faq details').first()
        assert.equal(await firstFaq.evaluate(element => element.open), false)
        await firstFaq.locator('summary').focus()
        await firstFaq.locator('summary').press('Enter')
        assert.equal(await firstFaq.evaluate(element => element.open), true)
        await firstFaq.locator('summary').press('Enter')
        assert.equal(await firstFaq.evaluate(element => element.open), false)
        await page.evaluate(() => scrollTo(0, 0))
        if (width < 1024) {
          const trigger = page.getByRole('button', { name: 'Open menu', exact: true })
          await trigger.click()
          assert.equal(await page.locator('#mobile-navigation').isVisible(), true)
          await page.keyboard.press('Escape')
          assert.equal(await page.locator('#mobile-navigation').isVisible(), false)
          assert.equal(await trigger.evaluate(element => document.activeElement === element), true)
        }
        evidence.pageHeight = await page.evaluate(() => document.documentElement.scrollHeight)
        evidence.serviceHeight = await page.locator('#cabinet-services').evaluate(element => element.getBoundingClientRect().height)
      })
    }

    await scenario('server-content-home-region-and-kcp-summary', { javaScriptEnabled: false }, async (page, context, evidence) => {
      // fetch has no cookies and cannot follow a redirect to a non-local host.
      const homeResponse = await fetch(`${base}/`, { redirect: 'error' })
      const kcpResponse = await fetch(`${base}${KCP}`, { redirect: 'error' })
      assert.equal(homeResponse.status, 200); assert.equal(kcpResponse.status, 200)
      const homeHtml = await homeResponse.text(), kcpHtml = await kcpResponse.text()
      assert.ok(homeHtml.includes('id="service-area"'))
      assert.ok(kcpHtml.includes('id="cabinet-faq"'))
      await open(page, '/')
      evidence.home = await structure(page)
      const region = page.locator('#service-area')
      assert.equal(await region.count(), 1)
      assert.equal(await region.locator('h2').count(), 1)
      const regionText = await region.innerText()
      for (const suburb of suburbs) assert.ok(regionText.includes(suburb), `Home includes ${suburb}`)
      const suburbLists = paragraphs => paragraphs
        .map(value => value.split(/[,·]/).map(suburb => suburb.trim()))
        .filter(items => items.length > 1 && items.every(suburb => suburbs.includes(suburb)))
      const groups = suburbLists(await region.locator('h3 + p, h4 + p').allTextContents())
      assert.equal(groups.length, 3, 'Three substantive suburb groups appear in the region')
      assert.deepEqual(groups.flat(), suburbs, 'Every suburb appears once in central content order')
      evidence.homeRegionGroups = groups
      assert.match(regionText, /Based in Ermington NSW 2115/)
      assert.match(regionText, /surrounding suburbs and Inner West Sydney/)
      assert.match(regionText, /Nearby suburbs & wider Sydney/)
      assert.match(regionText, /property address to confirm availability, access and travel arrangements/)
      assert.doesNotMatch(regionText, /10\s*km/i, 'The approved service area does not display a fixed 10 km boundary')
      assert.deepEqual(suburbLists(await page.locator('#about p').allTextContents()), [], 'About does not repeat the service-area suburb lists')
      assert.equal(await region.locator('a[href^="https://www.google.com/maps/"]').count(), 1)
      await open(page)
      evidence.kcp = await structure(page)
      assert.notEqual(evidence.home.title, evidence.kcp.title)
      assert.notEqual(evidence.home.description, evidence.kcp.description)
      assert.equal(await page.locator('main a[href="/#service-area"]').count(), 1)
      const text = await page.locator('main').innerText()
      for (const suburb of suburbs.filter(suburb => !['Ermington'].includes(suburb))) assert.ok(!text.includes(suburb), `KCP has no full suburb detail: ${suburb}`)
      assert.equal(await page.locator('.kcp-chapter').count(), 10)
      assert.equal(await page.locator('#cabinet-faq details').count(), 5)
      assert.equal(await page.locator('#cabinet-faq details p').count(), 5)
      assert.equal(await page.locator('#cabinet-colours, .kcp-stage-canvas').count(), 0)
      assert.ok((await page.locator('main').innerText()).length > 1500)
      const faq = page.locator('#cabinet-faq details').first()
      await faq.locator('summary').press('Enter')
      assert.equal(await faq.evaluate(element => element.open), true)
      evidence.serverHtmlBytes = { home: Buffer.byteLength(homeHtml), kcp: Buffer.byteLength(kcpHtml) }
    })

    await scenario('compare-pointer-keyboard-and-quote-navigation', { viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' }, async (page, context, evidence) => {
      await open(page)
      const range = page.locator('#cabinet-comparison-range')
      await range.focus(); await range.press('Home'); assert.equal(await range.inputValue(), '0')
      await range.press('End'); assert.equal(await range.inputValue(), '100')
      const image = page.locator('.kcp-compare-images')
      await image.scrollIntoViewIfNeeded()
      const bounds = await image.boundingBox()
      await page.mouse.move(bounds.x + bounds.width * .25, bounds.y + bounds.height / 2)
      await page.mouse.down()
      await page.mouse.move(bounds.x + bounds.width * .75, bounds.y + bounds.height / 2, { steps: 4 })
      await page.mouse.up()
      assert.ok(Math.abs(Number(await range.inputValue()) - 75) <= 2)
      assert.match(await range.getAttribute('aria-valuetext'), /75|74|76/)
      await page.touchscreen.tap(bounds.x + bounds.width * .25, bounds.y + bounds.height / 2)
      assert.ok(Math.abs(Number(await range.inputValue()) - 25) <= 2, 'Touch pointer changes the divider immediately')
      await capture(page, `${directory}/compare-mobile.png`)
      const quoteLinks = page.locator(`a[href="${QUOTE}"]`)
      assert.ok(await quoteLinks.count() >= 2)
      await page.locator('.kcp-hero-actions').locator(`a[href="${QUOTE}"]`).click()
      await page.waitForURL(`${base}${QUOTE}`)
      assert.ok(await page.getByRole('textbox', { name: /Your name|Full name/ }).first().isVisible())
      assert.ok((await page.locator('main').innerText()).length > 50)
      evidence.quotePath = new URL(page.url()).pathname + new URL(page.url()).search
      assert.ok(!evidence.apiFixtures.some(call => /\/review|\/submit|\/approve|\/photos/.test(call.path)), 'No quote save/submission UI action')
    })

    await scenario('desktop-steps-hash-fast-scroll-and-crossfade', {}, async (page, context, evidence) => {
      await open(page); await enhanced(page)
      const hrefs = await stageLinks(page).evaluateAll(links => links.map(link => link.getAttribute('href')))
      await page.evaluate(() => {
        window.__kcpFadeSamples = []
        let frames = 0, readyFrames = 0
        const sample = () => {
          const canvas = document.querySelector('.kcp-stage-canvas'), poster = document.querySelector('.kcp-stage-poster')
          if (canvas && poster) {
            const canvasReady = canvas.classList.contains('is-ready'), posterReady = poster.classList.contains('is-ready')
            window.__kcpFadeSamples.push({ canvas: Number(getComputedStyle(canvas).opacity), poster: Number(getComputedStyle(poster).opacity), canvasReady, posterReady })
            if (canvasReady && posterReady) readyFrames++
          }
          if (++frames < 1800 && readyFrames < 60) requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
      await align(page, hrefs[0].slice(1))
      evidence.firstStepControls = await stageControls(page)
      await page.locator('.kcp-stage-canvas.is-ready').waitFor({ timeout: 25_000 })
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.kcp-stage-canvas')).opacity) > .99 && Number(getComputedStyle(document.querySelector('.kcp-stage-poster')).opacity) < .01)
      evidence.crossfade = await page.evaluate(() => window.__kcpFadeSamples)
      assert.ok(evidence.crossfade.length)
      assert.ok(evidence.crossfade.some(sample => sample.canvas > 0 && sample.canvas < 1 && sample.poster > 0 && sample.poster < 1), 'At least one real intermediate crossfade frame is observed')
      assert.ok(evidence.crossfade.every(sample => sample.canvasReady === sample.posterReady), 'Poster/canvas readiness changes together')
      assert.ok(evidence.crossfade.every(sample => sample.canvas + sample.poster >= .9), 'No blank frame during crossfade')
      for (const href of hrefs) {
        await page.locator(`.kcp-stage-nav a[href="${href}"]`).click()
        await currentStep(page, href)
        assert.equal(new URL(page.url()).hash, href)
        assert.equal((await reading(page)).nearest, href.slice(1))
      }
      await open(page, `${KCP}${hrefs[4]}`)
      await enhanced(page); await currentStep(page, hrefs[4])
      await page.reload({ waitUntil: 'networkidle' }); await enhanced(page); await currentStep(page, hrefs[4])
      const ids = [...hrefs.map(href => href.slice(1)), 'cabinet-process-complete']
      evidence.scroll = []
      for (const id of [...ids, ...ids.slice().reverse(), ids[7], ids[1], ids[7], ids[1]]) {
        await align(page, id)
        const expected = id === 'cabinet-process-complete' ? hrefs[8] : `#${id}`
        await currentStep(page, expected)
        const state = await reading(page)
        assert.equal(state.nearest, id)
        evidence.scroll.push({ id, ...state })
        if (id === ids.at(-1)) evidence.lastStepControls = await stageControls(page)
      }
      const repeated = evidence.scroll.filter(value => value.id === ids[7])
      assert.ok(repeated.every(value => value.progress === repeated[0].progress), 'Repeated forward/reverse locations give identical progress')
      await align(page, ids[4]); await currentStep(page, hrefs[4])
    })

    await scenario('static-toggle-reduced-motion-and-resize-preserve-reading', {}, async page => {
      await open(page); await enhanced(page)
      const hrefs = await stageLinks(page).evaluateAll(links => links.map(link => link.getAttribute('href')))
      let id = hrefs[4].slice(1)
      await align(page, id); await currentStep(page, `#${id}`)
      for (const next of [hrefs[6].slice(1), hrefs[2].slice(1)]) {
        await page.getByRole('button', { name: 'Static view', exact: true }).click()
        await staticReading(page, id, true)
        await align(page, next)
        await page.getByRole('button', { name: /Return to 3D story/ }).click()
        id = next
        await enhanced(page); await currentStep(page, `#${id}`)
        assert.equal((await reading(page)).nearest, id, 'Every static/3D round trip preserves the newly read chapter')
      }
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await staticReading(page, id)
      assert.equal(await page.locator('.kcp-stage-canvas').count(), 0)
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await enhanced(page); await currentStep(page, `#${id}`)
      await page.setViewportSize({ width: 1023, height: 700 }); await staticReading(page, id)
      await page.setViewportSize({ width: 1024, height: 700 }); await enhanced(page); await currentStep(page, `#${id}`)
      await page.setViewportSize({ width: 1280, height: 699 }); await staticReading(page, id)
      await page.setViewportSize({ width: 1280, height: 700 }); await enhanced(page); await currentStep(page, `#${id}`)
    })

    await scenario('reduced-motion-startup-and-text-200-percent-simulation', { reducedMotion: 'reduce' }, async (page, context, evidence) => {
      await open(page)
      assert.equal(await page.locator('#cabinet-process').getAttribute('data-enhanced'), 'false')
      assert.equal(await page.locator('.kcp-stage-canvas').count(), 0)
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })
      evidence.enlargement = 'Root font-size: 200%; native browser zoom not exercised'
      await structure(page)
      const faq = page.locator('#cabinet-faq summary').first()
      await faq.focus(); await faq.press('Enter')
      assert.equal(await faq.evaluate(element => element.parentElement.open), true)
      await page.locator('#cabinet-process-prepare').scrollIntoViewIfNeeded()
      assert.ok(await page.locator('#cabinet-process-prepare h3').isVisible())
    })

    await scenario('webgl-unavailable-initial-hash-preserves-reading', {}, async (page, context, evidence) => {
      await context.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext
        HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /^webgl/.test(type) ? null : original.call(this, type, ...args) }
      })
      const id = 'cabinet-process-prepare'
      await open(page, `${KCP}#${id}`)
      await page.getByText(/3D unavailable.*static process view/).waitFor()
      evidence.fallback = await staticReading(page, id)
      assert.equal(await page.locator('.kcp-stage-canvas').count(), 0)
      // A preload failure while the introduction is being read must not jump
      // over that introduction to chapter 01 merely because it is the default.
      await open(page)
      evidence.introBefore = await page.evaluate(() => {
        const intro = document.querySelector('.kcp-story-intro'), rect = intro.getBoundingClientRect()
        scrollTo({ top: scrollY + rect.top - innerHeight * .6, behavior: 'instant' })
        return { scroll: scrollY, focus: document.activeElement?.id, top: intro.getBoundingClientRect().top }
      })
      await page.getByText(/3D unavailable.*static process view/).waitFor()
      evidence.introAfter = await page.evaluate(() => ({ scroll: scrollY, focus: document.activeElement?.id, top: document.querySelector('.kcp-story-intro').getBoundingClientRect().top }))
      assert.ok(Math.abs(evidence.introAfter.scroll - evidence.introBefore.scroll) < 4, 'WebGL preload failure preserves introduction reading position')
      assert.equal(evidence.introAfter.focus, evidence.introBefore.focus, 'Preload failure does not steal outside focus')
    })

    await scenario('webgl-context-loss-preserves-current-reading', {}, async (page, context, evidence) => {
      await open(page); await enhanced(page)
      const id = 'cabinet-process-finish'
      await align(page, id); await currentStep(page, `#${id}`)
      await page.locator('.kcp-stage-canvas.is-ready canvas').waitFor({ timeout: 25_000 })
      evidence.lossMode = await page.locator('.kcp-stage-canvas canvas').evaluate(canvas => {
        const gl = canvas.getContext('webgl2'), extension = gl?.getExtension('WEBGL_lose_context')
        if (extension) { extension.loseContext(); return 'WEBGL_lose_context extension' }
        canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
        return 'Synthetic webglcontextlost event; GPU loss extension unavailable'
      })
      if (evidence.lossMode.startsWith('Synthetic')) report.limitations.push(evidence.lossMode)
      await page.getByText(/3D unavailable.*static process view/).waitFor()
      evidence.fallback = await staticReading(page, id)
      assert.equal(await page.locator('.kcp-stage-canvas').count(), 0)
    })
  } finally {
    await browser.close()
    report.finishedAt = new Date().toISOString()
    report.passed = report.checks.length > 0 && report.checks.every(check => check.passed)
    writeFileSync(`${directory}/results.json`, JSON.stringify(report, null, 2))
  }
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
  try {
    const report = await verifyKcpLanding({ upstream: arg('base') ?? process.env.KCP_UI_UPSTREAM ?? 'http://127.0.0.1:3002', output: arg('output') ?? process.env.KCP_UI_OUTPUT ?? defaultOutput, only: arg('only') ?? process.env.KCP_UI_ONLY ?? '' })
    console.log(JSON.stringify({ passed: report.passed, checks: report.checks.map(({ name, passed, error }) => ({ name, passed, error })), results: resolve(arg('output') ?? process.env.KCP_UI_OUTPUT ?? defaultOutput, 'results.json') }, null, 2))
    if (!report.passed) process.exitCode = 1
  } catch (error) { console.error(error); process.exitCode = 1 }
}
