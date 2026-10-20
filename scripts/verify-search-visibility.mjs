// Read-only HTTP acceptance: no customer writes, uploads, AI, mail or booking calls.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

assert.ok(process.env.SEO_BASE_URL, 'Supply the exact local or company deployment origin.')
const base = new URL(process.env.SEO_BASE_URL)
assert.ok(['http:', 'https:'].includes(base.protocol) && base.pathname === '/' && !base.search && !base.hash && !base.username && !base.password)
const production = process.env.SEO_EXPECT_ENV === 'production'
assert.ok(production || process.env.SEO_EXPECT_ENV === 'preview', 'Choose production or preview expectations explicitly.')
const host = process.env.SEO_HTTP_HOST
if (host) assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Host simulation is local-only.')
const canonical = 'https://www.lnkgroupsydney.com.au'
const indexHeader = production && (host ?? base.hostname) === new URL(canonical).hostname
const directory = resolve(process.env.SEO_OUTPUT ?? 'docs/verification/2026-10-16-public-search/http')
mkdirSync(directory, { recursive: true })
const checks = []

// fetch can discard Host overrides. Use Node's HTTP transport for the local
// canonical-host simulation so the acceptance test sends the header it asserts.
function request(path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const transport = base.protocol === 'https:' ? httpsRequest : httpRequest
    const req = transport(new URL(path, base), { method, headers, signal: AbortSignal.timeout(25000) }, incoming => {
      const chunks = []
      incoming.on('data', chunk => chunks.push(chunk))
      incoming.on('error', reject)
      incoming.on('end', () => resolve(new Response(method === 'HEAD' ? null : Buffer.concat(chunks), { status: incoming.statusCode, headers: incoming.headers })))
    })
    req.on('error', reject)
    req.end()
  })
}

async function read(path, { method = 'GET', agent, expectedStatus = 200 } = {}) {
  const headers = { ...(host && !path.startsWith('/api/') ? { host } : {}), ...(agent ? { 'user-agent': agent } : {}) }
  const response = await request(path, { method, headers })
  assert.ok(Array.isArray(expectedStatus) ? expectedStatus.includes(response.status) : response.status === expectedStatus, `${method} ${path}: ${response.status}`)
  const record = { path, method, agent: agent ?? 'default', status: response.status, robots: response.headers.get('x-robots-tag'), cache: response.headers.get('cache-control'), vary: response.headers.get('vary') }
  checks.push(record)
  return { response, record, text: method === 'HEAD' ? '' : await response.text() }
}

function meta(html, name) {
  const values = [...html.matchAll(new RegExp(`<meta name="${name}" content="([^"]*)"`, 'g'))].map(match => match[1])
  if (!values.length) return undefined
  return name === 'robots' ? [...new Set(values.flatMap(value => value.split(',').map(rule => rule.trim())))].join(', ') : values.at(-1)
}
function canonicalLink(html) {
  const value = html.match(/<link rel="canonical" href="([^"]*)"/)?.[1]
  return value ? new URL(value).href : undefined
}
function openGraphUrl(html) {
  const value = html.match(/<meta property="og:url" content="([^"]*)"/)?.[1]
  return value ? new URL(value).href : undefined
}
function jsonLd(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]))
}
function headerPolicy(value, open) {
  assert.equal(value, open ? 'index, follow' : 'noindex, nofollow')
}

try {
  for (const path of ['/', '/services/cabinet-painting']) {
    for (const agent of [undefined, 'Googlebot']) {
      const { text, record } = await read(path, { agent })
      headerPolicy(record.robots, indexHeader)
      assert.equal(meta(text, 'robots'), production ? 'index, follow' : 'noindex, nofollow')
      assert.equal(canonicalLink(text), production ? new URL(path, canonical).href : undefined)
      assert.equal(openGraphUrl(text), production ? new URL(path, canonical).href : undefined)
      assert.ok(meta(text, 'description'))
      assert.equal((text.match(/<h1(?:\s|>)/g) ?? []).length, 1)
      const data = jsonLd(text)
      assert.equal(data.length, production ? 1 : 0)
      if (production) {
        assert.equal(data[0]['@type'], path === '/' ? 'Organization' : 'BreadcrumbList')
        assert.ok(!JSON.stringify(data).includes('PostalAddress'), 'No private address is published.')
      }
      if (path !== '/') assert.match(text, /How is the price assessed\?/)
    }
    headerPolicy((await read(path, { method: 'HEAD' })).record.robots, indexHeader)
    const query = await read(`${path}?utm_source=chatgpt.com`)
    assert.equal(canonicalLink(query.text), production ? new URL(path, canonical).href : undefined)
    assert.equal(openGraphUrl(query.text), production ? new URL(path, canonical).href : undefined)
    headerPolicy(query.record.robots, indexHeader)
  }
  for (const path of ['/admin', '/admin/customers', '/quote/start?service=cabinet-painting', '/quote/start?mode=demo']) {
    const result = await read(path, { expectedStatus: path.startsWith('/admin') ? [200, 404] : 200 })
    headerPolicy(result.record.robots, false)
    assert.equal(meta(result.text, 'robots'), 'noindex, nofollow')
    assert.equal(canonicalLink(result.text), undefined)
    assert.deepEqual(jsonLd(result.text), [])
  }
  for (const path of ['/images/home/cabinet-painting.webp', '/images/story/kitchen-finished.webp', '/images/lk-group-logo-circle-transparent.png']) {
    headerPolicy((await read(path, { method: 'HEAD' })).record.robots, indexHeader)
    const optimized = `/_next/image?url=${encodeURIComponent(path)}&w=640&q=75`
    headerPolicy((await read(optimized, { method: 'HEAD' })).record.robots, indexHeader)
  }
  headerPolicy((await read('/images/unregistered-search-test.webp', { expectedStatus: 404 })).record.robots, false)
  headerPolicy((await read('/services/not-approved', { expectedStatus: 404 })).record.robots, false)

  const robot = (await read('/robots.txt')).text
  const map = (await read('/sitemap.xml')).text
  const urls = [...map.matchAll(/<loc>([^<]*)<\/loc>/g)].map(match => match[1])
  assert.deepEqual(urls, production ? [`${canonical}/`, `${canonical}/services/cabinet-painting`] : [])
  if (production) {
    assert.match(robot, /Allow: \/\n/)
    for (const path of ['/admin', '/quote', '/api']) assert.ok(robot.includes(`Disallow: ${path}`))
    assert.ok(robot.includes(`Sitemap: ${canonical}/sitemap.xml`))
  } else {
    assert.match(robot, /Disallow: \/\n/)
    assert.ok(!robot.includes('Sitemap:'))
  }

  // A fresh anonymous session is read-only and must never open a saved request.
  const empty = await read('/api/quote/requests')
  assert.equal(JSON.parse(empty.text).request, null)
  headerPolicy(empty.record.robots, false)
  assert.match(empty.record.cache ?? '', /private/)
  assert.match(empty.record.cache ?? '', /no-store/)
  for (const path of [
    '/api/quote/requests/photos/11111111-1111-4111-8111-111111111111/content',
    '/api/quote/photos/11111111-1111-4111-8111-111111111111/content',
    '/api/quote/requests/booking/documents/receipt',
  ]) {
    const response = await fetch(new URL(path, base), { redirect: 'manual', signal: AbortSignal.timeout(25000) })
    assert.ok(response.status >= 400 && response.status < 500, `Anonymous private data denied: ${path}`)
    headerPolicy(response.headers.get('x-robots-tag'), false)
    assert.match(response.headers.get('cache-control') ?? '', /private/)
    assert.match(response.headers.get('cache-control') ?? '', /no-store/)
    assert.match(response.headers.get('vary') ?? '', /cookie/i)
    checks.push({ path, method: 'GET', status: response.status, robots: response.headers.get('x-robots-tag'), cache: response.headers.get('cache-control'), vary: response.headers.get('vary') })
    await response.body?.cancel()
  }
  writeFileSync(resolve(directory, 'http-results.json'), JSON.stringify({ passed: true, base: base.origin, environment: production ? 'production' : 'preview', simulatedHost: host ?? null, checks }, null, 2))
  console.log(`Search visibility HTTP checks passed: ${checks.length}; ${directory}`)
} catch (error) {
  writeFileSync(resolve(directory, 'http-results.json'), JSON.stringify({ passed: false, base: base.origin, checks, error: String(error) }, null, 2))
  throw error
}
