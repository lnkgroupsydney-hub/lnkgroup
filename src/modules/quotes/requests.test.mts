import { parseSingleForwarded } from '../../shared/http/forwarded.ts'
import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { NextRequest } from 'next/server.js'
import { createQuoteRequestApi } from './infrastructure/api.ts'
import { QuoteRequestError, type LiveQuoteRequest } from './domain/contracts.ts'
import { quoteRequestStore } from './infrastructure/store.ts'
import type { QuoteRequestActor } from './domain/contracts.ts'
const db = new PGlite()
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
for (const name of readdirSync(new URL('../../../supabase/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8'))
const tables = (await db.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' and tablename like 'lk_%'")).rows.map(row => row.tablename)
const base = 'http://127.0.0.1:3002', secret = '81'.repeat(32)
const actor = { userId: randomUUID(), sessionId: randomUUID(), companyId: 'lk-group' }
let enabled = true, baseUrl = base, currentTime = Date.now(), staff: QuoteRequestActor | null = actor, rpcCount = 0
const commands: string[] = []
async function rpc<T>(command: string, args: Record<string, unknown>): Promise<T> {
  commands.push(command); rpcCount++
  return (await db.query<{ result: T }>('select public.lk_quote_requests_command($1,$2::jsonb) result', [command, JSON.stringify(args)])).rows[0].result
}
const store = { async command<T>(command: string, args: Record<string, unknown>): Promise<T> { try { return await rpc<T>(command, args) } catch (error) { const e = error as {code: string; message: string}; const status = ({LK400:400,LK401:401,LK403:403,LK404:404,LK409:409,LK429:429} as Record<string,number>)[e.code]; throw new QuoteRequestError(status ?? 503, status ? e.message : 'Storage unavailable.') } } }
const api = createQuoteRequestApi({ store, enabled: () => enabled, baseUrl: () => baseUrl, sessionKey: () => secret, now: () => currentTime, authorize: async () => { if (!staff) throw new QuoteRequestError(401, 'Staff authentication required.'); return staff } })
const contact = { name: 'Real flow synthetic client', email: 'actual.customer@example.invalid', phone: '', siteAddress: '1 Synthetic Street', suburb: 'Test suburb', postcode: '2000', details: 'Synthetic only', consent: true }
const service = { serviceId: 'cabinet-painting', intent: 'full-repainting', surfaces: ['doors'], doorCount: 5, drawerCount: null, material: '', colourPreference: '' }
function request(method: string, cookie?: string, body?: unknown, path = '/api/quote/requests', headers: Record<string, string> = {}) {
  return new Request(`${baseUrl}${path}`, { method, headers: { origin: baseUrl, host: new URL(baseUrl).host, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) })
}
async function session() { const res = await api.session(request('POST')); assert.equal(res.status, 200, await res.clone().text()); return res.headers.get('set-cookie')!.split(';')[0] }
const input = (expectedRevision = 0, payload: unknown = { contact, service: null }, idempotencyKey = randomUUID()) => ({ expectedRevision, payload, idempotencyKey, storageConsent: true })
async function save(cookie: string, values = input()) { const response = await api.save(request('PUT', cookie, values)); assert.equal(response.status, 200, await response.clone().text()); return (await response.json()).request as LiveQuoteRequest }
async function count(table: string) { return (await db.query<{ n: number }>(`select count(*)::integer n from public.${table}`)).rows[0].n }
function hash(cookie: string) { return createHash('sha256').update(cookie.slice(cookie.indexOf('=') + 1)).digest('hex') }
const code = (expected: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === expected
beforeEach(async () => { await db.exec('reset role'); await db.exec(`truncate ${tables.map(table => `public.${table}`).join(',')}`); await db.exec('set role service_role'); enabled = true; baseUrl = base; currentTime = Date.now(); staff = actor; rpcCount = 0; commands.length = 0 })
after(async () => { await db.close() })

test('live cookie is separate from demo/staff, origin-bound, private and not silently extended', async () => {
  const response = await api.session(request('POST', 'lk_quote_draft=demo; lk_staff_session=staff'))
  const header = response.headers.get('set-cookie')!
  assert.match(header, /^lk_quote_request=/)
  assert.match(header, /Path=\/api\/quote\/requests; HttpOnly; SameSite=Lax; Max-Age=86400/)
  const cookie = header.split(';')[0]
  const again = await api.session(request('POST', cookie)); assert.equal(again.status, 200); assert.equal(again.headers.get('set-cookie'), null)
  baseUrl = 'https://lnkgroup.vercel.app'
  assert.equal((await api.session(request('POST', cookie))).status, 401)
  const secure = await api.session(request('POST')); assert.match(secure.headers.get('set-cookie')!, /; Secure$/)
  assert.equal(secure.headers.get('cache-control'), 'private, no-store')
  assert.equal(rpcCount, 0)
})

test('actual customer contact and service persist in the same live request and appear in EMS as draft', async () => {
  const cookie = await session(), first = await save(cookie)
  assert.equal(first.mode, 'live'); assert.equal(first.status, 'draft'); assert.equal(first.payload.contact.email, contact.email)
  assert.equal(first.customerId, null); assert.match(first.reference, /^RQ-[A-F0-9]{32}$/)
  const updated = await save(cookie, input(1, { contact: { ...contact, details: 'Second save' }, service }))
  assert.equal(updated.id, first.id); assert.equal(updated.revision, 2)
  const read = await api.read(request('GET', cookie)); assert.deepEqual((await read.json()).request, updated)
  const listed = await api.list(request('GET', undefined, undefined, '/api/admin/quote-requests'))
  assert.equal(listed.status, 200); const listing = await listed.json(); assert.equal(listing.requests[0].id, updated.id)
  const detail = await api.detail(request('GET', undefined, undefined, `/api/admin/quote-requests/${updated.id}`), updated.id)
  const value = await detail.json(); assert.equal(value.audit.length, 2); assert.deepEqual(value.audit.map((a: {actorType:string}) => a.actorType), ['guest', 'guest'])
  assert.equal(await count('lk_customers'), 0, 'Contact-based automatic CRM merge/create must not happen')
  const raw = (await db.query<{ owner_hash: string }>('select owner_hash from public.lk_quote_requests')).rows[0]
  assert.equal(raw.owner_hash, hash(cookie)); assert.ok(!JSON.stringify(listing).includes(raw.owner_hash))
})

test('anonymous access and customer B cannot read or mutate A; IDs and email do not grant access', async () => {
  const a = await session(), saved = await save(a), b = await session()
  assert.equal((await api.save(request('PUT', undefined, input()))).status, 401)
  assert.equal((await api.read(request('GET', b))).status, 200)
  assert.equal((await (await api.read(request('GET', b))).json()).request, null)
  const bSaved = await save(b, input(0, { contact: { ...contact, name: 'Other owner' }, service }))
  assert.notEqual(bSaved.id, saved.id)
  assert.equal((await api.save(request('PUT', b, { ...input(1), requestId: saved.id, ownerHash: hash(a) }))).status, 200)
  assert.equal((await (await api.read(request('GET', a))).json()).request.id, saved.id)
  staff = null
  assert.equal((await api.list(request('GET'))).status, 401)
  assert.equal((await api.detail(request('GET'), saved.id)).status, 401)
  staff = { ...actor, companyId: 'other-company' }
  assert.equal((await api.list(request('GET'))).status, 403)
})

test('idempotent response-loss retries create one request/audit and reject reused keys with changed content', async () => {
  const cookie = await session(), values = input(), first = await save(cookie, values), retry = await save(cookie, values)
  assert.deepEqual(retry, first); assert.equal(await count('lk_quote_requests'), 1); assert.equal(await count('lk_quote_request_audit'), 1)
  assert.equal((await api.save(request('PUT', cookie, { ...values, payload: { contact: { ...contact, name: 'Changed' }, service: null } }))).status, 409)
  assert.equal(await count('lk_quote_request_audit'), 1)
})

test('concurrent first saves with distinct keys and stale revisions have only one winning revision', async () => {
  const cookie = await session()
  const first = await Promise.all([api.save(request('PUT', cookie, input())), api.save(request('PUT', cookie, input()))])
  assert.deepEqual(first.map(result => result.status).sort(), [200, 409]); assert.equal(await count('lk_quote_requests'), 1)
  const writes = await Promise.all([api.save(request('PUT', cookie, input(1, { contact: { ...contact, name: 'Tab A' }, service }))), api.save(request('PUT', cookie, input(1, { contact: { ...contact, name: 'Tab B' }, service })))])
  assert.deepEqual(writes.map(result => result.status).sort(), [200, 409]); assert.equal(await count('lk_quote_request_audit'), 2)
})

test('request review requires saved service, has one receipt, and freezes customer edits', async () => {
  const cookie = await session(), first = await save(cookie)
  assert.equal((await api.review(request('POST', cookie, { expectedRevision: 1, idempotencyKey: randomUUID() }))).status, 400)
  const second = await save(cookie, input(first.revision, { contact, service })), values = { expectedRevision: second.revision, idempotencyKey: randomUUID() }
  const response = await api.review(request('POST', cookie, values)); assert.equal(response.status, 200)
  const reviewed = (await response.json()).request
  assert.equal(reviewed.status, 'review_requested'); assert.ok(reviewed.reviewRequestedAt); assert.equal(reviewed.revision, 3)
  assert.deepEqual((await (await api.review(request('POST', cookie, values))).json()).request, reviewed)
  assert.equal((await api.save(request('PUT', cookie, input(3, { contact, service })))).status, 409)
  assert.equal(await count('lk_quote_request_audit'), 3)
  for (const table of ['lk_quote_versions','lk_quote_acceptances','lk_quote_submissions','lk_quote_request_access']) assert.equal(await count(table), 0)
})

test('storage consent and validation reject invalid details; client price/approval/actor fields are discarded', async () => {
  const cookie = await session()
  for (const invalid of [{ ...input(), storageConsent: false }, input(0, { contact: { ...contact, consent: false }, service: null }), input(0, { contact, service: { ...service, doorCount: -1 } }), { ...input(), expectedRevision: -1 }]) assert.equal((await api.save(request('PUT', cookie, invalid))).status, 400)
  const saved = await save(cookie, { ...input(0, { contact, service, price: 1, approved: true, signature: 'forged' }), actorUserId: actor.userId } as ReturnType<typeof input>)
  assert.deepEqual(Object.keys(saved.payload).sort(), ['contact','service']); assert.equal(saved.status, 'draft')
  assert.equal((await api.save(request('PUT', cookie, '{}', '/api/quote/requests', { 'content-length': '16001' }))).status, 413)
  assert.equal((await api.save(request('PUT', cookie, '{'))).status, 400)
  assert.equal((await api.save(request('PUT', cookie, input(), '/api/quote/requests', { 'content-type': 'text/plain' }))).status, 415)
})

test('CSRF, wrong host, cross-site reads, disabled settings and expired capabilities fail closed', async () => {
  const cookie = await session(), first = await save(cookie)
  assert.equal((await api.save(request('PUT', cookie, input(1), '/api/quote/requests', { origin: 'https://attacker.invalid' }))).status, 403)
  assert.equal((await api.read(request('GET', cookie, undefined, '/api/quote/requests', { 'sec-fetch-site': 'cross-site' }))).status, 403)
  assert.equal((await api.read(new Request('http://localhost:3002/api/quote/requests', { headers: { cookie } }))).status, 403)
  assert.equal((await api.read(request('GET', `${cookie}; ${cookie}`))).status, 400)
  const pieces = cookie.split('=')[1].split('.')
  pieces[2] = '00'.repeat(32)
  assert.equal((await api.read(request('GET', `lk_quote_request=${pieces.join('.')}`))).status, 401)
  const draftMac = createHmac('sha256', Buffer.from(secret, 'hex')).update(`quote-draft-session-v1:${pieces[0]}.${pieces[1]}`).digest('hex')
  assert.equal((await api.read(request('GET', `lk_quote_request=${pieces[0]}.${pieces[1]}.${draftMac}`))).status, 401)
  enabled = false; assert.equal((await api.read(request('GET', cookie))).status, 200); assert.equal((await api.save(request('PUT', cookie, input(1)))).status, 503); enabled = true
  currentTime += 86401000
  assert.equal((await api.read(request('GET', cookie))).status, 401)
  assert.equal(await count('lk_quote_requests'), 1)
  assert.equal((await api.detail(request('GET'), first.id)).status, 200)
})

test('database denies anonymous/authenticated direct tables and RPC, staff-less or foreign company commands', async () => {
  const cookie = await session(); await save(cookie)
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    for (const table of ['lk_quote_requests','lk_quote_request_audit','lk_quote_request_access','lk_quote_versions','lk_terms_versions','lk_quote_acceptances']) await assert.rejects(db.query(`select * from public.${table}`), code('42501'))
    await assert.rejects(rpc('read', { companyId: 'lk-group', ownerHash: hash(cookie) }), code('42501'))
  }
  await db.exec('set role service_role')
  await assert.rejects(rpc('list', { companyId: 'lk-group', page: 1, pageSize: 20 }), code('LK403'))
  await assert.rejects(rpc('read', { companyId: 'other', ownerHash: hash(cookie) }), code('LK403'))
  for (const table of ['lk_quote_request_audit','lk_quote_versions','lk_terms_versions','lk_quote_acceptances','lk_quote_request_access']) await assert.rejects(db.query(`delete from public.${table}`), code('42501'))
  await db.query('update public.lk_quote_requests set owner_expires_at=now()-interval \'1 minute\'')
  await assert.rejects(rpc('read', { companyId: 'lk-group', ownerHash: hash(cookie) }), code('LK401'))
  assert.equal(await count('lk_quote_requests'), 1)
})

test('EMS pagination/search is bounded and audit responses do not expose owner capabilities', async () => {
  const a = await session(); await save(a); const b = await session(); await save(b, input(0, { contact: { ...contact, name: 'Second entry' }, service }))
  const response = await api.list(request('GET', undefined, undefined, '/api/admin/quote-requests?page=2&pageSize=1'))
  const page = await response.json(); assert.equal(page.total, 2); assert.equal(page.requests.length, 1); assert.equal(page.page, 2)
  assert.ok(!JSON.stringify(page).includes('ownerHash'))
  const search = await api.list(request('GET', undefined, undefined, '/api/admin/quote-requests?q=Second'))
  assert.equal((await search.json()).total, 1)
  for (const query of ['page=0','pageSize=51','page=1&page=2','q='+ 'x'.repeat(121)]) assert.equal((await api.list(request('GET', undefined, undefined, '/api/admin/quote-requests?'+query))).status, 400)
})

test('Supabase store uses server-only no-store requests and hides raw storage failure details', async () => {
  const previous = globalThis.fetch
  const keys = ['OPERATIONS_STORE','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SECRET_KEY'] as const
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  Object.assign(process.env, { OPERATIONS_STORE: 'supabase', NEXT_PUBLIC_SUPABASE_URL: 'https://live-quotes.invalid', SUPABASE_SECRET_KEY: 'synthetic-key' })
  try {
    globalThis.fetch = async (input, init) => { const req = new Request(input, init); assert.equal(new URL(req.url).origin, 'https://live-quotes.invalid'); assert.equal(req.headers.get('apikey'), 'synthetic-key'); assert.equal(req.cache, 'no-store'); return Response.json({ code: 'PGRST202', message: 'PRIVATE DATABASE DIAGNOSTICS' }, { status: 400 }) }
    await assert.rejects(quoteRequestStore.command('read', {}), (error: unknown) => error instanceof QuoteRequestError && error.status === 503 && !error.message.includes('DIAGNOSTICS'))
    globalThis.fetch = async () => Response.json({ code: 'LK409', message: 'Reload saved details.' }, { status: 400 })
    await assert.rejects(quoteRequestStore.command('save', {}), (error: unknown) => error instanceof QuoteRequestError && error.status === 409)
  } finally { globalThis.fetch = previous; for (const key of keys) { if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key] } }
})

test('NextRequest loopback normalization works only with the configured Host and port', async () => {
  const req = new NextRequest(`${base}/api/quote/requests/session`, { method: 'POST', headers: { host: '127.0.0.1:3002', origin: base } })
  assert.equal(new URL(req.url).hostname, 'localhost', 'Exercise the real NextRequest normalization')
  const response = await api.session(req); assert.equal(response.status, 200)
  const cookie = response.headers.get('set-cookie')!.split(';')[0]
  const values = input()
  const saved = await api.save(new NextRequest(`${base}/api/quote/requests`, { method: 'PUT', headers: { host: '127.0.0.1:3002', origin: base, cookie, 'content-type': 'application/json' }, body: JSON.stringify(values) }))
  assert.equal(saved.status, 200)
  for (const headers of [{ host: 'localhost:3002' }, { host: 'evil.invalid' }, { 'x-forwarded-host': 'evil.invalid' }, { 'x-forwarded-proto': 'https' }, { 'x-forwarded-port': '443' }, { forwarded: 'host=evil.invalid;proto=https' }]) assert.equal((await api.read(request('GET', cookie, undefined, '/api/quote/requests', headers))).status, 403)
  const noHost = new Request(`${base}/api/quote/requests`, { headers: { cookie } }); assert.equal((await api.read(noHost)).status, 403)
  assert.equal((await api.read(new Request('http://localhost:3003/api/quote/requests', { headers: { host: '127.0.0.1:3002', cookie } }))).status, 403)
})

test('HTTPS requires exact Host and corroborating forwarded authority', async () => {
  baseUrl = 'https://lnkgroup.vercel.app'
  const cookie = await session()
  const valid = { 'x-forwarded-host': 'lnkgroup.vercel.app', 'x-forwarded-proto': 'https', 'x-forwarded-port': '443', forwarded: 'for=192.0.2.1;host="lnkgroup.vercel.app";proto=https' }
  assert.equal((await api.read(request('GET', cookie, undefined, '/api/quote/requests', valid))).status, 200)
  for (const headers of [{ host: 'evil.invalid' }, { 'x-forwarded-host': 'evil.invalid' }, { 'x-forwarded-proto': 'http' }, { 'x-forwarded-port': '80' }, { forwarded: 'host=evil.invalid;proto=https' }, { forwarded: 'host=lnkgroup.vercel.app,host=evil.invalid' }, { forwarded: 'host=lnkgroup.vercel.app;host=lnkgroup.vercel.app' }]) assert.equal((await api.read(request('GET', cookie, undefined, '/api/quote/requests', headers))).status, 403)
  baseUrl = 'http://2130706433:3002'
  assert.equal((await api.session(request('POST'))).status, 503)
  baseUrl = 'https://lnkgroup.vercel.app/extra'
  assert.equal((await api.session(request('POST'))).status, 503)
})

test('transactional creation/write limits preserve saved records and exact retries at the limit', async () => {
  const cookie = await session(), values = input(), saved = await save(cookie, values)
  await db.query('update public.lk_rate_buckets set count=60 where bucket=$1', ['live-quote-requests:write:' + hash(cookie)])
  assert.deepEqual(await save(cookie, values), saved, 'A response-loss replay is allowed without consuming the limiter')
  assert.equal((await api.save(request('PUT', cookie, input(1, { contact, service })))).status, 429)
  assert.equal(await count('lk_quote_request_audit'), 1)
  assert.equal((await (await api.read(request('GET', cookie))).json()).request.revision, 1)
  await db.query('update public.lk_rate_buckets set count=100 where bucket=$1', ['live-quote-requests:create:global'])
  const other = await session()
  assert.equal((await api.save(request('PUT', other, input()))).status, 429)
  assert.equal(await count('lk_quote_requests'), 1)
  assert.deepEqual(await save(cookie, values), saved)
})


test('pausing live writes preserves existing owner/staff reads and creates no new session or audit', async () => {
  const cookie = await session(), first = await save(cookie)
  enabled = false
  assert.deepEqual((await (await api.read(request('GET', cookie))).json()).request, first)
  assert.equal((await api.list(request('GET'))).status, 200)
  assert.equal((await api.detail(request('GET'), first.id)).status, 200)
  const existing = await api.session(request('POST', cookie)); assert.equal(existing.status, 200); assert.equal(existing.headers.get('set-cookie'), null)
  const fresh = await api.session(request('POST')); assert.equal(fresh.status, 503); assert.equal(fresh.headers.get('set-cookie'), null)
  assert.equal((await api.save(request('PUT', cookie, input(1, { contact, service })))).status, 503)
  assert.equal((await api.review(request('POST', cookie, { expectedRevision: 1, idempotencyKey: randomUUID() }))).status, 503)
  assert.equal(await count('lk_quote_requests'), 1); assert.equal(await count('lk_quote_request_audit'), 1)
})

test('HTTPS accepts Vercel Forwarded sig/exp extensions without trusting them as authority',async()=>{
 baseUrl='https://lnkgroup.vercel.app';const cookie=await session();
 const forwarded='for=192.0.2.1;host="lnkgroup.vercel.app";proto=https;sig=synthetic==;exp=123;x-trace="opaque metadata"';
 assert.equal((await api.read(request('GET',cookie,undefined,'/api/quote/requests',{forwarded}))).status,200);
 for(const headers of [{host:'evil.invalid',forwarded},{'x-forwarded-host':'evil.invalid',forwarded},{'x-forwarded-proto':'http',forwarded},{'x-forwarded-port':'80',forwarded},{forwarded:forwarded.replace('lnkgroup.vercel.app','evil.invalid')},{forwarded:forwarded.replace('proto=https','proto=http')}])assert.equal((await api.read(request('GET',cookie,undefined,'/api/quote/requests',headers))).status,403);
 for(const extension of ['sig=synthetic==;SIG=other','exp=1;EXP=2','invalid name=x','sig="unterminated','sig="escaped\\value"','sig=one,two','sig=','sig=x;'])assert.equal((await api.read(request('GET',cookie,undefined,'/api/quote/requests',{forwarded:`host=lnkgroup.vercel.app;proto=https;${extension}`}))).status,403);
})
test('shared Forwarded parser rejects controls, malformed extensions and duplicate names',()=>{
 assert.deepEqual([...parseSingleForwarded('host=lnkgroup.vercel.app;proto=https;sig=synthetic==;exp=123')!],[['host','lnkgroup.vercel.app'],['proto','https']]);
 for(const control of ['\u0000','\r','\n','\u007f','\u001f'])assert.equal(parseSingleForwarded(`host=lnkgroup.vercel.app;sig="a${control}b"`),null);
 assert.equal(parseSingleForwarded('SIG=x;sig=y'),null);assert.equal(parseSingleForwarded('host=x,host=y'),null);
 assert.deepEqual([...parseSingleForwarded('\thost=lnkgroup.vercel.app; proto=https\t;sig=synthetic==')!],[['host','lnkgroup.vercel.app'],['proto','https']]);
})
