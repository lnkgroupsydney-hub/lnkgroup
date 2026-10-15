// Local, read-only acceptance of the approved L&K Group homepage contract.
// External traffic and writes are blocked. Quote entry's automatic session
// handshake is simulated only in its own scenario, without a cookie or record.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const defaultOutput = 'docs/verification/2026-10-13-lk-home-revision'
const offerings = ['Residential Painting', 'Kitchen Cabinet Painting', 'Handyman Services', 'Paint Touch-up Kits', 'Kimchi']
const sectionIds = ['home', 'main-content', 'services', 'about', 'gallery', 'service-area', 'contact']
const navItems = [['Services', '#services'], ['About', '#about'], ['What we offer', '#gallery'], ['Service area', '#service-area'], ['Contact', '#contact']]
const cabinetPath = '/services/cabinet-painting'
const quotePath = '/quote/start?service=cabinet-painting'

function playwrightPackage() {
  const require = createRequire(import.meta.url)
  try { return require('playwright') } catch {
    return require(`${process.env.LK_HOME_UI_RUNTIME_PACKAGES ?? '/Users/jimee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'}/playwright`)
  }
}

export function localBase(value) {
  const url = new URL(value)
  assert.equal(url.protocol, 'http:', 'Only local HTTP is permitted')
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Use a strict loopback host')
  assert.ok(!url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Supply a plain loopback origin')
  return url.origin
}

function companyContacts() {
  const source = readFileSync(new URL('../src/modules/company-profile/content/company-content.ts', import.meta.url), 'utf8')
  const phone = source.match(/phoneHref:\s*"([^"]+)"/)?.[1]
  const email = source.match(/emailHref:\s*"([^"]+)"/)?.[1]
  assert.equal(phone, 'tel:+61404603966', 'The approved company phone remains the source')
  assert.equal(email, 'mailto:lnkgroupsydney@gmail.com', 'The corrected group email is the central source')
  return { phone, email }
}

export async function verifyLkHome({ upstream = 'http://127.0.0.1:3026', output = defaultOutput, only = '' } = {}) {
  const base = localBase(upstream)
  const contacts = companyContacts()
  const directory = resolve(output)
  mkdirSync(directory, { recursive: true })
  const report = {
    upstream: base, startedAt: new Date().toISOString(), checks: [],
    isolation: 'Fresh contexts without stored sessions; service workers blocked; external requests aborted; all backend writes blocked. Quote-entry scenario alone simulates the exact explicit start-new logout POST and automatic session POST handshake with no cookies or records, then serves empty customer/request GET fixtures. No backend session/create, save, submission, company session or external service action.',
    limitations: [
      'Headless Chrome does not certify physical-device behaviour.',
      '200% TEXT enlargement uses root font-size, not native browser zoom.',
      'Computed keyboard focus cues and element geometry are checked; screenshots still require visual review. No pixel contrast/WCAG certification.',
      'Coming-soon cards are checked for interactive DOM, DOM event properties and hydrated React handler props; this is not a general audit of arbitrary delegated JavaScript listeners.',
      'No production deployment, search ranking, real API persistence, mail or Google integration is exercised.',
    ],
  }
  const { chromium } = playwrightPackage()
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })

  async function scenario(name, options, run) {
    if (only && !name.includes(only)) return
    const evidence = { name, passed: false, externalBlocked: [], apiFixtures: [], blockedWrites: [], pageErrors: [], failedLocalResources: [], consoleErrors: [] }
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference', serviceWorkers: 'block', ...options })
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      const entry = { path: url.pathname, method: request.method() }
      if (url.origin !== base) {
        evidence.externalBlocked.push({ ...entry, origin: url.origin })
        return route.abort('blockedbyclient')
      }
      if (name === 'cabinet-detail-to-empty-quote-read-only' && request.method() === 'POST' && url.pathname === '/api/quote/requests/customer/logout' && request.postData() === JSON.stringify({ intent: 'start-new' })) {
        evidence.apiFixtures.push({ ...entry, fixture: 'synthetic-start-new-no-cookie-no-record' })
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store', 'x-lk-home-ui-fixture': 'synthetic-start-new' }, body: JSON.stringify({ signedOut: true, writingSessionPreserved: true, contact: null }) })
      }
      // Canonical api.session returns {ready:true}; the form opens this before
      // reading a draft. Simulate that response entirely inside the browser,
      // without forwarding the POST, setting cookies or creating any request.
      if (name === 'cabinet-detail-to-empty-quote-read-only' && request.method() === 'POST' && url.pathname === '/api/quote/requests/session' && !url.search && !request.postData()) {
        evidence.apiFixtures.push({ ...entry, fixture: 'synthetic-empty-session-handshake-no-cookie-no-record' })
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store', 'x-lk-home-ui-fixture': 'synthetic-session-handshake' }, body: JSON.stringify({ ready: true }) })
      }
      if (!['GET', 'HEAD'].includes(request.method())) {
        evidence.blockedWrites.push(entry)
        return route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'Read-only local browser acceptance: writes are forbidden.' }) })
      }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        evidence.apiFixtures.push(entry)
        const headers = { 'cache-control': 'no-store', 'x-lk-home-ui-fixture': 'read-only' }
        if (request.method() === 'GET' && url.pathname === '/api/quote/requests/customer') return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ customer: null, requests: [], currentRequestId: null }) })
        if (request.method() === 'GET' && url.pathname === '/api/quote/requests') return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ request: null }) })
        return route.fulfill({ status: 503, contentType: 'application/json', headers, body: JSON.stringify({ error: 'No real API reads in homepage acceptance.' }) })
      }
      return route.continue()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    page.on('pageerror', error => evidence.pageErrors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push(message.text().slice(0, 600)) })
    page.on('response', response => {
      const url = new URL(response.url())
      if (url.origin === base && response.status() >= 400) evidence.failedLocalResources.push({ path: url.pathname, status: response.status() })
    })
    try {
      await run(page, evidence)
      assert.deepEqual(evidence.blockedWrites, [], 'No write was attempted by the read-only flow')
      assert.deepEqual(evidence.pageErrors, [], 'No browser runtime errors')
      assert.deepEqual(evidence.failedLocalResources, [], 'All local documents and resources loaded successfully')
      assert.deepEqual(evidence.consoleErrors, [], 'No console errors')
      evidence.passed = true
      console.log(`PASS ${name}`)
    } catch (error) {
      evidence.error = error.stack ?? String(error)
      await page.screenshot({ path: `${directory}/${name}-failure.png`, fullPage: false }).catch(() => {})
      console.error(`FAIL ${name}: ${error.message}`)
    } finally {
      report.checks.push(evidence)
      writeFileSync(`${directory}/results.json`, JSON.stringify(report, null, 2))
      await context.close()
    }
  }

  async function open(page, path = '/') {
    const response = await page.goto(`${base}${path}`, { waitUntil: 'networkidle' })
    assert.equal(response?.status(), 200, `Local document ${path} responds successfully`)
    await page.locator('main h1').waitFor()
    await page.evaluate(() => document.fonts.ready)
    return response
  }

  async function structure(page) {
    const value = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map(element => element.id)
      const headings = [...document.querySelectorAll('main h1, main h2, main h3, main h4, main h5, main h6')].map(element => ({ level: Number(element.tagName.slice(1)), text: element.textContent.trim() }))
      const fragments = [...document.querySelectorAll('a[href]')].map(link => new URL(link.getAttribute('href'), location.href)).filter(url => url.origin === location.origin && url.pathname === location.pathname && url.hash)
      const clippedContent = [...document.querySelectorAll('main h1, main h2, main h3, main p, #services article')].flatMap(element => {
        const rect = element.getBoundingClientRect(), style = getComputedStyle(element)
        if (!rect.width || !rect.height) return []
        const clippedX = ['hidden', 'clip'].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 2
        const clippedY = ['hidden', 'clip'].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 2
        return rect.left < -1 || rect.right > innerWidth + 1 || clippedX || clippedY
          ? [{ tag: element.tagName, text: element.textContent.trim().slice(0, 90), left: rect.left, right: rect.right, clippedX, clippedY }] : []
      })
      return {
        width: innerWidth, documentWidth: document.documentElement.scrollWidth, language: document.documentElement.lang,
        h1: document.querySelectorAll('h1').length, headings, clippedContent,
        duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index), ids,
        missingFragments: fragments.filter(url => !document.getElementById(decodeURIComponent(url.hash.slice(1)))).map(url => url.hash),
        title: document.title, description: document.querySelector('meta[name="description"]')?.content,
        robots: document.querySelector('meta[name="robots"]')?.content,
      }
    })
    assert.equal(value.h1, 1, 'Exactly one homepage H1')
    assert.equal(value.language, 'en-AU')
    assert.deepEqual(value.duplicateIds, [])
    assert.deepEqual(value.missingFragments, [])
    for (const id of sectionIds) assert.ok(value.ids.includes(id), `Existing target #${id} is retained`)
    assert.ok(value.documentWidth <= value.width + 1, `No horizontal overflow: ${value.documentWidth}/${value.width}`)
    assert.deepEqual(value.clippedContent, [], 'Headings, prose and offering cards fit without clipped content')
    assert.match(value.title, /L&K Group/)
    assert.match(value.title, /Sydney|Ermington/)
    assert.ok(value.description?.trim().length > 40, 'Description is meaningful')
    assert.equal(value.robots, process.env.SEO_EXPECT_INDEXABLE === 'true' ? 'index, follow' : 'noindex, nofollow')
    assert.equal(value.headings[0]?.level, 1, 'Main starts with the primary heading')
    for (let i = 1; i < value.headings.length; i++) assert.ok(value.headings[i].level <= value.headings[i - 1].level + 1, `Heading hierarchy does not skip levels: ${value.headings[i].text}`)
    for (const id of sectionIds.filter(id => !['home', 'main-content'].includes(id))) assert.equal(await page.locator(`#${id} h2`).count(), 1, `#${id} has a section H2`)
    return value
  }

  async function offeringContract(page, section) {
    const cards = page.locator(`${section} article`)
    assert.equal(await cards.count(), 5, 'All five offerings have article semantics')
    assert.deepEqual(await cards.locator('h3').allTextContents(), offerings)
    const evidence = []
    for (const name of offerings) {
      const article = cards.filter({ has: page.getByRole('heading', { name, exact: true, level: 3 }) })
      assert.equal(await article.count(), 1)
      assert.ok(await article.isVisible(), `${name} is visible without an expansion control`)
      if (name === 'Kitchen Cabinet Painting' && section === '#services') {
        assert.equal(await article.locator(`a[href="${cabinetPath}"]`).count(), 1, 'Cabinet card links to the existing detail route')
      } else if (name !== 'Kitchen Cabinet Painting') {
        assert.match(await article.innerText(), /Coming soon/, `${name} explains its status in text`)
        const violations = await article.evaluate(element => {
          const nodes = [element, ...element.querySelectorAll('*')]
          const selector = 'a, button, input, select, textarea, summary, [tabindex], [contenteditable="true"], [role="button"], [role="link"], [role="menuitem"]'
          return nodes.filter(node => {
            const reactProps = Object.keys(node).filter(key => key.startsWith('__reactProps$')).map(key => node[key])
            return node.matches(selector) || typeof node.onclick === 'function' || node.hasAttribute('onclick') || reactProps.some(props => typeof props?.onClick === 'function' || typeof props?.onKeyDown === 'function' || typeof props?.onPointerDown === 'function')
          }).map(node => ({ tag: node.tagName, role: node.getAttribute('role'), tabindex: node.getAttribute('tabindex') }))
        })
        assert.deepEqual(violations, [], `${name} has no fake disabled control, focus stop or click handler`)
      }
      evidence.push({ name, rect: await article.boundingBox() })
    }
    return evidence
  }

  async function serviceContract(page) {
    const evidence = await offeringContract(page, '#services')
    const contact = page.locator('#contact')
    for (const href of Object.values(contacts)) assert.ok(await contact.locator(`a[href="${href}"]`).count() >= 1, `Contact uses company-content ${href}`)
    return evidence
  }

  async function revisionContract(page) {
    const visibleCopy = await page.locator('main, footer').allTextContents()
    assert.doesNotMatch(visibleCopy.join(' '), /10\s*km|LNKPAINTING|lnkpaintingau@gmail\.com|9(?::00)?\s*p\.?m/i, 'Visible company content removes the distance, former name, email and closing time')
    assert.match(await page.locator('#contact').innerText(), /7(?::00)?\s*a\.?m\s*[–-]\s*5(?::00)?\s*p\.?m/i, 'Contact hours are 7am to 5pm')
    assert.match(await page.locator('footer').innerText(), /L&K Group/, 'Footer identifies the group')
    const logos = await page.locator('header img, footer img').evaluateAll(images => images.map(image => {
      const url = new URL(image.getAttribute('src'), location.href)
      return { source: url.searchParams.get('url') ?? url.pathname, alt: image.alt }
    }))
    assert.equal(logos.length, 2, 'Header and footer each show one logo')
    assert.ok(logos.every(logo => logo.source === '/images/lk-group-logo-circle-transparent.png'), 'Both locations use the corrected original-circle logo')
    const hero = page.locator('main > section').first()
    const background = hero.locator('img')
    assert.equal(await background.count(), 1, 'Hero has its group background image')
    assert.ok(await background.isVisible(), 'Group hero artwork is visible at this viewport')
    const heroCopy = await hero.innerText()
    assert.match(heroCopy, /concept|illustrat|AI.generated/i, 'Hero artwork is disclosed as a concept')
    const gallery = await offeringContract(page, '#gallery')
    const imageCards = page.locator('#gallery article')
    const images = []
    for (const article of await imageCards.all()) {
      assert.equal(await article.locator('img').count(), 1, 'Each offering has one relevant image')
      const image = article.locator('img')
      assert.ok((await image.getAttribute('alt'))?.trim(), 'Offering image has descriptive alternative text')
      assert.ok(Number(await image.getAttribute('width')) > 0 && Number(await image.getAttribute('height')) > 0, 'Offering image has intrinsic dimensions')
      const descriptions = await article.locator('p').allTextContents()
      assert.ok(descriptions.some(text => text.trim().length > 40), 'Each offering has a concise descriptive paragraph')
      images.push(await image.getAttribute('src'))
    }
    assert.equal(new Set(images).size, 5, 'All five offerings use distinct images')
    assert.match(await page.locator('#gallery').innerText(), /illustrat|concept|AI.generated/i, 'Service illustrations are clearly distinguished from actual project evidence')
    return { logos, hero: await background.boundingBox(), gallery, images }
  }

  async function loadImages(page) {
    // Full-page screenshots must include genuinely decoded lazy images.
    for (const image of await page.locator('main img').all()) {
      // Skip only non-rendered elements; the revision contract separately
      // requires the generated hero background at every responsive width.
      if (!await image.isVisible()) continue
      await image.scrollIntoViewIfNeeded()
      await page.waitForFunction(element => element.complete && element.naturalWidth > 0, await image.elementHandle())
      await image.evaluate(async element => { await element.decode() })
    }
  }

  async function captureHome(page, label) {
    await loadImages(page)
    // Artwork scrolling can leave Chrome's navigation focus on the skip link.
    // Capture the ordinary viewing state; focus cues are tested separately.
    await page.evaluate(() => { document.activeElement?.blur() })
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
    // Tall element captures temporarily extend Chrome's viewport and may include
    // the unfocused skip link that is ordinarily translated above the viewport.
    // Hide only that ordinary unfocused state during capture, without changing
    // product CSS or the independently verified focused keyboard state.
    const style = '.skip-link:not(:focus) { visibility: hidden !important; }'
    await page.screenshot({ path: `${directory}/${label}-viewport.png`, style })
    await page.screenshot({ path: `${directory}/${label}-full-page.png`, fullPage: true, style })
    await page.locator('#services').screenshot({ path: `${directory}/${label}-services.png`, style })
    await page.locator('main > section').first().screenshot({ path: `${directory}/${label}-hero.png`, style })
    await page.locator('#gallery').screenshot({ path: `${directory}/${label}-gallery.png`, style })
  }

  async function focusCue(locator) {
    const value = await locator.evaluate(element => {
      const style = getComputedStyle(element), bounds = element.getBoundingClientRect()
      return { focused: document.activeElement === element, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor, shadow: style.boxShadow, top: bounds.top, bottom: bounds.bottom, viewportHeight: innerHeight }
    })
    assert.equal(value.focused, true)
    const outline = !['none', 'hidden'].includes(value.outlineStyle) && Number.parseFloat(value.outlineWidth) > 0 && !['transparent', 'rgba(0, 0, 0, 0)'].includes(value.outlineColor)
    assert.ok(outline || value.shadow !== 'none', 'Keyboard focus has a computed outline/shadow cue')
    assert.ok(value.top >= -1 && value.bottom <= value.viewportHeight + 1, 'Focused control is inside the viewport')
    return value
  }

  async function anchorNavigation(page, nav, label, href, requireFocus = false) {
    const link = nav.getByRole('link', { name: label, exact: true })
    assert.equal(await link.getAttribute('href'), href)
    await link.focus()
    await link.press('Enter')
    await page.waitForURL(`${base}/${href}`)
    const target = page.locator(href)
    assert.ok(await target.isVisible())
    if (requireFocus) await page.waitForFunction(id => document.activeElement?.id === id, href.slice(1))
    return { label, href, activeId: await page.evaluate(() => document.activeElement?.id), targetTop: await target.evaluate(element => element.getBoundingClientRect().top) }
  }

  try {
    for (const [width, height] of [[320, 568], [393, 852], [768, 1024], [855, 828], [1024, 768], [1440, 900]]) {
      await scenario(`responsive-${width}`, { viewport: { width, height } }, async (page, evidence) => {
        await open(page)
        evidence.structure = await structure(page)
        evidence.offerings = await serviceContract(page)
        evidence.revision = await revisionContract(page)
        const images = await page.locator('#gallery img').evaluateAll(nodes => nodes.map(image => ({ alt: image.getAttribute('alt'), width: image.getAttribute('width'), height: image.getAttribute('height') })))
        assert.ok(images.length > 0)
        assert.ok(images.every(image => image.alt?.trim() && Number(image.width) > 0 && Number(image.height) > 0), 'Content images have descriptions and intrinsic dimensions')
        evidence.images = images
        if ([1440, 855, 393].includes(width)) await captureHome(page, width === 1440 ? 'desktop-1440' : width === 855 ? 'tablet-855' : 'mobile-393')
        else await loadImages(page)
        await structure(page)
      })
    }

    await scenario('server-html-no-javascript', { javaScriptEnabled: false }, async (page, evidence) => {
      const response = await open(page)
      const html = await response.text()
      for (const name of offerings) assert.ok(html.includes(name), `${name} exists in server HTML`)
      evidence.structure = await structure(page)
      evidence.offerings = await serviceContract(page)
      evidence.revision = await revisionContract(page)
      evidence.serverHtmlBytes = Buffer.byteLength(html)
      evidence.contacts = contacts
    })

    await scenario('desktop-keyboard-navigation-and-skip-link', {}, async (page, evidence) => {
      await open(page)
      await page.keyboard.press('Tab')
      const skip = page.getByRole('link', { name: /Skip to content/, exact: true })
      assert.equal(await skip.getAttribute('href'), '#main-content')
      evidence.skipFocus = await focusCue(skip)
      await skip.press('Enter')
      await page.waitForFunction(() => document.activeElement?.id === 'main-content')
      assert.equal(new URL(page.url()).hash, '#main-content')
      const nav = page.getByRole('navigation', { name: 'Primary navigation', exact: true })
      assert.ok(await nav.isVisible())
      evidence.links = []
      for (const [label, href] of navItems) evidence.links.push(await anchorNavigation(page, nav, label, href))
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
      await nav.getByRole('link', { name: 'Services', exact: true }).focus()
      evidence.navigationFocus = await focusCue(nav.getByRole('link', { name: 'Services', exact: true }))
    })

    await scenario('mobile-menu-keyboard-escape-and-section-focus', { viewport: { width: 393, height: 852 } }, async (page, evidence) => {
      await open(page)
      const trigger = page.getByRole('button', { name: 'Open menu', exact: true })
      await trigger.focus()
      evidence.triggerFocus = await focusCue(trigger)
      await trigger.press('Enter')
      const nav = page.getByRole('navigation', { name: 'Mobile navigation', exact: true })
      assert.ok(await nav.isVisible())
      assert.equal(await page.getByRole('button', { name: 'Close menu', exact: true }).getAttribute('aria-expanded'), 'true')
      for (const [label, href] of navItems) assert.equal(await nav.getByRole('link', { name: label, exact: true }).getAttribute('href'), href)
      await nav.getByRole('link', { name: 'Services', exact: true }).focus()
      evidence.linkFocus = await focusCue(nav.getByRole('link', { name: 'Services', exact: true }))
      await page.keyboard.press('Escape')
      assert.equal(await nav.isVisible(), false)
      assert.equal(await trigger.evaluate(element => document.activeElement === element), true, 'Escape returns focus to the trigger')
      evidence.links = []
      for (const [label, href] of navItems) {
        await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
        await trigger.click()
        evidence.links.push(await anchorNavigation(page, nav, label, href, true))
        assert.equal(await nav.isVisible(), false, 'Section navigation closes the menu')
      }
      await structure(page)
    })

    for (const width of [320, 1440]) {
      await scenario(`reduced-motion-and-200-percent-TEXT-${width}`, { viewport: { width, height: width === 320 ? 640 : 900 }, reducedMotion: 'reduce' }, async (page, evidence) => {
        await open(page)
        assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true)
        const before = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).fontSize))
        const initial = await page.evaluate(() => {
          document.documentElement.style.fontSize = '200%'
          const style = getComputedStyle(document.documentElement)
          return { inlineFontSize: document.documentElement.style.fontSize, computedFontSize: style.fontSize, transition: style.transition }
        })
        // The global reduced-motion rule sets transition-duration:0.01ms for
        // every element. Reading before the next rendered frame can therefore
        // still yield 16px even though the inline size already says 200%.
        await page.waitForFunction(expected => Number.parseFloat(getComputedStyle(document.documentElement).fontSize) >= expected * 1.99, before)
        const after = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).fontSize))
        assert.ok(after >= before * 1.99, 'Root TEXT size is actually enlarged to 200%')
        evidence.enlargement = { label: '200% TEXT enlargement; native browser zoom not tested', before, initial, after }
        evidence.structure = await structure(page)
        evidence.offerings = await serviceContract(page)
        evidence.revision = await revisionContract(page)
        evidence.motion = await page.evaluate(() => ({ reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, scrollBehaviour: getComputedStyle(document.documentElement).scrollBehavior, runningAnimations: document.getAnimations().filter(animation => animation.playState === 'running').length }))
        assert.equal(evidence.motion.scrollBehaviour, 'auto', 'Reduced-motion uses immediate document scrolling')
        assert.equal(evidence.motion.runningAnimations, 0, 'No persistent running homepage animation under reduced motion')
        await page.locator('#services').screenshot({ path: `${directory}/TEXT-200-${width}-services.png` })
      })
    }

    await scenario('cabinet-detail-to-empty-quote-read-only', { viewport: { width: 393, height: 852 }, reducedMotion: 'reduce' }, async (page, evidence) => {
      await open(page)
      const cabinet = page.locator('#services article').filter({ has: page.getByRole('heading', { name: 'Kitchen Cabinet Painting', exact: true }) })
      await cabinet.locator(`a[href="${cabinetPath}"]`).click()
      await page.waitForURL(`${base}${cabinetPath}`)
      await page.locator('main h1').waitFor()
      assert.equal(await page.locator('main h1').count(), 1)
      assert.ok(await page.locator('main a[href="/#service-area"]').count() >= 1, 'KCP retains the shared home region link')
      const quote = page.locator(`main a[href="${quotePath}"]`).first()
      assert.ok(await quote.isVisible())
      await quote.click()
      await page.waitForURL(`${base}${quotePath}`)
      await page.getByRole('button', { name: 'Start a new quote', exact: true }).click()
      const name = page.getByRole('textbox', { name: /Your name|Full name/ }).first()
      await name.waitFor()
      await page.waitForFunction(element => !element.matches(':disabled'), await name.elementHandle())
      assert.equal(await name.inputValue(), '', 'Quote entry has no customer data')
      evidence.quote = { path: new URL(page.url()).pathname + new URL(page.url()).search, customerName: await name.inputValue(), enabled: await name.isEnabled(), fixtureOnly: true }
      assert.ok(evidence.apiFixtures.some(call => call.path === '/api/quote/requests/session' && call.fixture === 'synthetic-empty-session-handshake-no-cookie-no-record'), 'Automatic quote session handshake was simulated entirely in the browser')
      assert.ok(evidence.apiFixtures.some(call => call.path === '/api/quote/requests' && call.method === 'GET'), 'Quote initialized from an empty request fixture')
      assert.ok(evidence.apiFixtures.some(call => call.fixture === 'synthetic-start-new-no-cookie-no-record'), 'The explicit new-quote choice was simulated without backend changes')
      assert.ok(evidence.apiFixtures.every(call => (['/api/quote/requests/customer', '/api/quote/requests'].includes(call.path) && call.method === 'GET') || (call.path === '/api/quote/requests/session' && call.method === 'POST' && call.fixture === 'synthetic-empty-session-handshake-no-cookie-no-record') || (call.path === '/api/quote/requests/customer/logout' && call.method === 'POST' && call.fixture === 'synthetic-start-new-no-cookie-no-record')), 'Only simulated entry/session transitions and empty quote GET fixtures were requested')
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
    const output = arg('output') ?? process.env.LK_HOME_UI_OUTPUT ?? defaultOutput
    const report = await verifyLkHome({ upstream: arg('base') ?? process.env.LK_HOME_UI_UPSTREAM ?? 'http://127.0.0.1:3026', output, only: arg('only') ?? '' })
    console.log(JSON.stringify({ passed: report.passed, checks: report.checks.map(({ name, passed, error }) => ({ name, passed, error })), results: resolve(output, 'results.json') }, null, 2))
    if (!report.passed) process.exitCode = 1
  } catch (error) { console.error(error); process.exitCode = 1 }
}
