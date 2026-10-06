import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

// Isolated stores, synthetic secrets and intercepted requests only. This suite
// never loads .env files or forwards a request to a live service.
const base = 'http://127.0.0.1:3002'
const password = 'synthetic-admin-access-password'
const sqlitePath = join(mkdtempSync(join(tmpdir(), 'lk-admin-access-')), 'operations.sqlite')
function configure() {
  Object.assign(process.env, {
    OPERATIONS_STORE: 'supabase', LOCAL_OPERATIONS_ENABLED: 'true', APP_BASE_URL: base,
    STAFF_ADMIN_AUTH_ENABLED: 'false',
    LOCAL_OWNER_PASSWORD: password, LOCAL_OPERATIONS_DB_PATH: sqlitePath,
    NEXT_PUBLIC_SUPABASE_URL: 'https://admin-access-pglite.invalid', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'synthetic-publishable-key', SUPABASE_SECRET_KEY: 'synthetic-admin-access-key',
    GOOGLE_CLIENT_ID: 'synthetic-client', GOOGLE_CLIENT_SECRET: 'synthetic-secret', GOOGLE_TOKEN_ENCRYPTION_KEY: '88'.repeat(32),
    QUOTE_DEMO_ENABLED: 'true', QUOTE_DEMO_RECIPIENT_EMAIL: 'lnkgroupsydney@gmail.com',
  })
}
configure()
const db = new PGlite()
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
for (const name of readdirSync(new URL('../../../supabase/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8'))
}
const tables = (await db.query<{tablename:string}>("select tablename from pg_tables where schemaname='public' and tablename like 'lk_%'")).rows.map(row => row.tablename)
const originalFetch = globalThis.fetch
let fetchCalls = 0
let commands: string[] = []
globalThis.fetch = async (input, init) => {
  fetchCalls++
  const req = new Request(input, init), url = new URL(req.url)
  assert.equal(url.origin, 'https://admin-access-pglite.invalid', 'Live provider access is forbidden')
  assert.equal(req.headers.get('apikey'), 'synthetic-admin-access-key')
  assert.equal(url.pathname, '/rest/v1/rpc/lk_operations_command', 'Denied access must not reach booking or photo storage')
  const body = await req.json() as {command:string; args:Record<string, unknown>}
  commands.push(body.command)
  try {
    const result = await db.query<{result:unknown}>('select public.lk_operations_command($1, $2::jsonb) result', [body.command, JSON.stringify(body.args)])
    return Response.json(result.rows[0].result)
  } catch (error) {
    const failure = error as {code:string; message:string}
    return Response.json({code:failure.code, message:failure.message}, {status:400})
  }
}
const router = await import('./router.ts')
const sqliteApi = await import('./server-api.ts')
const cloudApi = await import('./supabase-api.ts')
const sqliteAuth = await import('./infrastructure/auth.ts')
const cloudAuth = await import('./infrastructure/supabase-auth.ts')
const { getDb } = await import('./infrastructure/local-db.ts')
const booking = await import('../bookings/infrastructure/api.ts')
const photos = await import('../enquiries/infrastructure/quote-photo-api.ts')
const drafts = await import('../enquiries/infrastructure/quote-draft-api.ts')
const sqlite = getDb()
type Store = 'sqlite' | 'supabase'
const stores: Store[] = ['sqlite', 'supabase']
const hash = (value:string) => createHash('sha256').update(value).digest('hex')

beforeEach(async () => {
  configure()
  await db.exec('reset role')
  await db.exec(`truncate ${tables.map(name => `public.${name}`).join(',')}`)
  await db.exec('set role service_role')
  sqlite.exec('DELETE FROM sessions; DELETE FROM oauth_states; DELETE FROM rate_buckets; DELETE FROM outbox; DELETE FROM enquiries;')
  fetchCalls = 0
  commands = []
})
after(async () => { globalThis.fetch = originalFetch; sqlite.close(); await db.close() })

function request(path:string, options:{cookie?:string; origin?:string; urlBase?:string; body?:unknown; headers?:Record<string,string>} = {}) {
  return new Request(`${options.urlBase ?? base}${path}`, {
    method: options.body === undefined ? 'GET' : 'POST',
    headers: {
      ...(options.cookie ? {cookie:options.cookie} : {}),
      ...(options.body === undefined ? {} : {'content-type':'application/json', origin:options.origin ?? base}),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : {body:JSON.stringify(options.body)}),
  })
}
async function signIn(store:Store) {
  process.env.OPERATIONS_STORE = store
  const response = await router.loginPost(request('/api/operations/login', {body:{password}}))
  assert.equal(response.status, 200, await response.clone().text())
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  return cookie
}
async function putSession(store:Store, mode:string, expiresAt = Date.now() + 60_000) {
  process.env.OPERATIONS_STORE = store
  const token = randomUUID(), tokenHash = hash(token)
  if (store === 'sqlite') sqlite.prepare('INSERT INTO sessions(token_hash,mode,account_sub,expires_at) VALUES(?,?,?,?)').run(tokenHash, mode, 'synthetic-company', expiresAt)
  else await db.query('insert into public.lk_sessions(token_hash,mode,account_sub,expires_at) values($1,$2,$3,$4)', [tokenHash, mode, 'synthetic-company', expiresAt])
  return `lk_ops_session=${token}`
}
function provider(store:Store) { return store === 'sqlite' ? sqliteApi : cloudApi }
async function getSession(store:Store, req:Request) { return store === 'sqlite' ? sqliteAuth.getSession(req) : cloudAuth.getSession(req) }

test('anonymous session discovery exposes login choices without private configuration or account details', async () => {
  for (const store of stores) {
    process.env.OPERATIONS_STORE = store
    const response = await router.sessionGet(request('/api/operations/session'))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.equal(response.headers.get('vary'), 'Cookie')
    const value = await response.json()
    assert.deepEqual(Object.keys(value).sort(), ['authenticated', 'googleConfigured', 'localLoginAvailable', 'mode'])
    assert.equal(value.authenticated, false)
    assert.equal(value.mode, null)
    assert.equal(value.localLoginAvailable, true)
    assert.equal(value.googleConfigured, true)
  }
  assert.equal(fetchCalls, 0, 'Anonymous discovery does not need the cloud database')
})

test('SQLite and Supabase login retain private operations and logout immediately revokes access', async () => {
  for (const store of stores) {
    const cookie = await signIn(store)
    const enquiry = await router.enquiryPost(request('/api/enquiries', {body:{
      serviceId:'cabinet-painting', projectIntent:'Repaint existing doors', targetSurfaces:['doors'],
      suburb:'Synthetic suburb', postcode:'2000', doorCount:2, drawerCount:null, notes:'Synthetic boundary test',
      name:'Synthetic customer', email:'synthetic@example.invalid', preferredDate:null, acknowledgement:true, idempotencyKey:randomUUID(),
    }}))
    assert.equal(enquiry.status, 201, await enquiry.clone().text())
    const saved = await enquiry.json() as {id:string}
    const response = await router.operationsGet(request('/api/operations', {cookie}))
    assert.equal(response.status, 200, await response.clone().text())
    const data = await response.json() as {enquiries:{id:string}[]}
    assert.deepEqual(data.enquiries.map(row => row.id), [saved.id])
    assert.equal((await provider(store).operationsGet(request('/api/operations', {cookie}))).status, 200)
    assert.equal((await router.logoutPost(request('/api/operations/logout', {cookie, body:{}}))).status, 200)
    assert.equal(await getSession(store, request('/api/operations', {cookie})), null)
    assert.equal((await router.operationsGet(request('/api/operations', {cookie}))).status, 401)
  }
})

test('Next normalized loopback URLs retain login, session and operations on both stores', async () => {
  for (const store of stores) {
    process.env.OPERATIONS_STORE = store
    const normalized = {urlBase:'http://localhost:3002', headers:{host:'127.0.0.1:3002'}}
    const login = await router.loginPost(request('/api/operations/login', {...normalized, body:{password}}))
    assert.equal(login.status, 200, await login.clone().text())
    const cookie = login.headers.get('set-cookie')!.split(';')[0]
    const options = {...normalized, cookie}
    assert.ok(await getSession(store, request('/api/operations', options)))
    assert.equal((await router.sessionGet(request('/api/operations/session', options))).status, 200)
    assert.equal((await router.operationsGet(request('/api/operations', options))).status, 200)
    const start = await router.googleConnectGet(request('/api/google/connect', options))
    assert.equal(start.status, 302)
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!
    const callback = await router.googleCallbackGet(request(`/api/google/callback?state=${state}&code=synthetic`, {
      ...options, headers:{...normalized.headers, 'sec-fetch-site':'cross-site'},
    }))
    // A Google cross-site callback reaches nonce validation; no live Google call
    // is made because this request deliberately omits the browser-bound nonce.
    assert.equal(callback.status, 400)
    assert.equal((await router.logoutPost(request('/api/operations/logout', {...options, body:{}}))).status, 200)
  }
})

test('a configured localhost authority works with either supported internal loopback hostname', async () => {
  const configured = 'http://localhost:3002'
  for (const store of stores) {
    process.env.OPERATIONS_STORE = store
    process.env.APP_BASE_URL = configured
    for (const urlBase of [configured, base]) {
      const options = {urlBase, headers:{host:'localhost:3002'}}
      const login = await router.loginPost(request('/api/operations/login', {...options, origin:configured, body:{password}}))
      assert.equal(login.status, 200, await login.clone().text())
      const cookie = login.headers.get('set-cookie')!.split(';')[0]
      assert.ok(await getSession(store, request('/api/operations', {...options, cookie})))
      assert.equal((await router.operationsGet(request('/api/operations', {...options, cookie}))).status, 200)
      assert.equal((await router.logoutPost(request('/api/operations/logout', {...options, origin:configured, cookie, body:{}}))).status, 200)
    }
  }
})

test('loopback normalization cannot rescue foreign URLs, wrong ports or spoofed Host headers', async () => {
  const deniedRequests: {urlBase:string; headers?:Record<string, string>}[] = [
    {urlBase:'https://foreign.invalid', headers:{host:'127.0.0.1:3002', 'x-forwarded-host':'127.0.0.1:3002', 'x-forwarded-proto':'http'}},
    {urlBase:'http://foreign.invalid', headers:{host:'127.0.0.1:3002'}},
    {urlBase:'http://localhost:3999', headers:{host:'127.0.0.1:3002'}},
    {urlBase:'http://localhost:3002', headers:{host:'foreign.invalid', 'x-forwarded-host':'127.0.0.1:3002'}},
    {urlBase:'http://localhost:3002', headers:{host:'localhost:3002', 'x-forwarded-host':'127.0.0.1:3002'}},
    {urlBase:'http://localhost:3002'},
  ]
  for (const store of stores) {
    const cookie = await signIn(store), before = fetchCalls
    for (const options of deniedRequests) {
      const req = request('/api/operations', {...options, cookie})
      assert.equal(await getSession(store, req), null)
      assert.equal((await provider(store).operationsGet(req)).status, 403)
    }
    assert.equal(fetchCalls, before, 'Rejected normalization does not access database or provider')
    process.env.APP_BASE_URL = 'https://admin.example.invalid'
    const invalid = request('/api/operations', {cookie, urlBase:'http://localhost:3002', headers:{host:'foreign.invalid'}})
    assert.equal((await provider(store).operationsGet(invalid)).status, 503)
    assert.equal(fetchCalls, before, 'Invalid original configuration is rejected before authority repair')
    configure()
  }
})

test('valid cookies cannot use another host or port for data, login, session discovery or OAuth', async () => {
  for (const store of stores) {
    const cookie = await signIn(store), api = provider(store)
    const before = fetchCalls
    const oauthBefore = store === 'sqlite' ? sqlite.prepare('SELECT count(*) n FROM oauth_states').get()?.n : (await db.query<{n:number}>('select count(*)::int n from public.lk_oauth_states')).rows[0].n
    for (const urlBase of ['https://admin.example.invalid', 'http://127.0.0.1:3999', 'http://localhost:3002']) {
      const options = {cookie, urlBase}
      assert.equal((await api.operationsGet(request('/api/operations', options))).status, 403)
      assert.equal((await api.loginPost(request('/api/operations/login', {...options, body:{password}}))).status, 403)
      assert.equal((await api.sessionGet(request('/api/operations/session', options))).status, 403)
      assert.equal((await api.googleConnectGet(request('/api/google/connect', options))).status, 403)
      assert.equal((await api.googleCallbackGet(request('/api/google/callback?state=synthetic&code=synthetic', options))).status, 403)
      assert.equal(await getSession(store, request('/api/operations', options)), null)
    }
    const mismatch = {cookie, headers:{host:'attacker.example.invalid'}}
    assert.equal((await api.operationsGet(request('/api/operations', mismatch))).status, 403)
    assert.equal((await api.sessionGet(request('/api/operations/session', mismatch))).status, 403)
    assert.equal((await api.loginPost(request('/api/operations/login', {...mismatch, body:{password}}))).status, 403)
    assert.equal(fetchCalls, before, 'Origin rejection precedes database and provider access')
    const oauthAfter = store === 'sqlite' ? sqlite.prepare('SELECT count(*) n FROM oauth_states').get()?.n : (await db.query<{n:number}>('select count(*)::int n from public.lk_oauth_states')).rows[0].n
    assert.equal(oauthAfter, oauthBefore, 'Denied OAuth does not issue a state')
  }
})

test('legacy Google cookies also stop at the local-preview switch before database access', async () => {
  for (const store of stores) {
    const cookie = await putSession(store, 'google'), req = request('/api/operations', {cookie})
    assert.ok(await getSession(store, req))
    for (const configuration of [{LOCAL_OPERATIONS_ENABLED:'false', APP_BASE_URL:base}, {LOCAL_OPERATIONS_ENABLED:'true', APP_BASE_URL:'https://admin.example.invalid'}]) {
      Object.assign(process.env, configuration)
      const before = fetchCalls
      assert.equal(await getSession(store, req), null)
      assert.equal((await provider(store).operationsGet(req)).status, 503)
      assert.equal((await provider(store).sessionGet(request('/api/operations/session', {cookie}))).status, 503)
      assert.equal(fetchCalls, before)
    }
    configure()
  }
})

test('expired, deleted and unsupported session modes do not become administrators', async () => {
  for (const store of stores) {
    for (const cookie of [await putSession(store, 'google', Date.now() - 1), await putSession(store, 'admin'), 'lk_ops_session=missing-synthetic-token']) {
      const req = request('/api/operations', {cookie})
      assert.equal(await getSession(store, req), null)
      assert.equal((await provider(store).operationsGet(req)).status, 401)
    }
    const cookie = await putSession(store, 'google')
    assert.ok(await getSession(store, request('/api/operations', {cookie})))
    const tokenHash = hash(cookie.split('=')[1])
    if (store === 'sqlite') sqlite.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash)
    else await db.query('delete from public.lk_sessions where token_hash=$1', [tokenHash])
    assert.equal((await provider(store).operationsGet(request('/api/operations', {cookie}))).status, 401)
  }
})

test('foreign-origin mutations reject valid cookies before changing sessions or OAuth state', async () => {
  for (const store of stores) {
    const cookie = await signIn(store), api = provider(store)
    assert.equal((await api.logoutPost(request('/api/operations/logout', {cookie, body:{}, origin:'https://foreign.invalid'}))).status, 403)
    assert.equal((await api.syncPost(request('/api/operations/sync', {cookie, body:{}, origin:'https://foreign.invalid'}))).status, 403)
    assert.equal((await api.googleConnectGet(request('/api/google/connect', {cookie, headers:{'sec-fetch-site':'cross-site'}}))).status, 403)
    assert.ok(await getSession(store, request('/api/operations', {cookie})), 'Rejected logout leaves the owner session intact')
  }
})

test('booking details, PDFs and photos reject anonymous or customer cookies before private storage', async () => {
  const customerResponse = await drafts.draftSessionPost(request('/api/quote/draft/session', {body:{}}))
  assert.equal(customerResponse.status, 200)
  const customerCookie = customerResponse.headers.get('set-cookie')!.split(';')[0]
  const id = randomUUID(), photoId = randomUUID()
  for (const cookie of ['', customerCookie]) {
    const before = fetchCalls, req = request(`/api/operations/bookings/${id}`, {cookie})
    assert.equal((await booking.adminBookingsGet(req)).status, 401)
    assert.equal((await booking.adminBookingGet(req, id)).status, 401)
    assert.equal((await booking.bookingDocumentGet(req, {admin:true, id, kind:'agreement'})).status, 401)
    assert.equal((await photos.adminPhotoGet(req, id, photoId)).status, 401)
    assert.equal(fetchCalls, before, 'No private SQL or object request occurs without an admin cookie')
  }
})

test('valid legacy cookies cannot bypass the direct booking, PDF, photo or mutation boundary', async () => {
  const cookie = await putSession('supabase', 'google'), id = randomUUID(), photoId = randomUUID()
  for (const options of [{cookie, urlBase:'https://admin.example.invalid'}, {cookie, urlBase:'http://127.0.0.1:3999'}, {cookie, headers:{host:'attacker.example.invalid'}}]) {
    const before = fetchCalls, req = request(`/api/operations/bookings/${id}`, options)
    assert.equal((await booking.adminBookingsGet(req)).status, 403)
    assert.equal((await booking.adminBookingGet(req, id)).status, 403)
    assert.equal((await booking.bookingDocumentGet(req, {admin:true, id, kind:'quote'})).status, 403)
    assert.equal((await photos.adminPhotoGet(req, id, photoId)).status, 403)
    assert.equal((await booking.proposalPost(request(`/api/operations/bookings/${id}/proposals`, {...options, body:{}}), id)).status, 403)
    assert.equal(fetchCalls, before)
  }
  const before = fetchCalls
  assert.equal((await booking.proposalPost(request(`/api/operations/bookings/${id}/proposals`, {cookie, body:{}, origin:'https://foreign.invalid'}), id)).status, 403)
  assert.equal(fetchCalls, before)
  assert.deepEqual(commands, [], 'Rejected direct routes never load session or business data')
})

test('staff mode closes SQLite legacy sessions and Google sign-in before database or provider use', async () => {
  const cookie = await putSession('sqlite', 'google')
  process.env.STAFF_ADMIN_AUTH_ENABLED = 'true'
  const before = fetchCalls, req = request('/api/operations', {cookie})
  assert.equal(sqliteAuth.getSession(req), null)
  assert.equal(sqliteAuth.localLoginAvailable(), false)
  assert.throws(() => sqliteAuth.requireSession(req), (error:unknown) => error instanceof Error && 'status' in error && error.status === 403)
  assert.throws(() => sqliteAuth.createSession('google', 'synthetic-company'), (error:unknown) => error instanceof Error && 'status' in error && error.status === 403)
  assert.equal((await sqliteApi.operationsGet(req)).status, 403)
  assert.equal((await router.operationsGet(req)).status, 403)
  assert.equal((await sqliteApi.googleConnectGet(request('/api/google/connect', {cookie}))).status, 403)
  assert.equal((await sqliteApi.googleCallbackGet(request('/api/google/callback?state=synthetic&code=synthetic', {cookie}))).status, 403)
  assert.equal(sqlite.prepare('SELECT count(*) n FROM oauth_states').get()?.n, 0)
  assert.equal(fetchCalls, before)
})

test('staff mode refuses valid legacy cloud cookies at operations, booking, PDF, photo and OAuth boundaries', async () => {
  const cookie = await putSession('supabase', 'google'), id = randomUUID(), photoId = randomUUID()
  process.env.STAFF_ADMIN_AUTH_ENABLED = 'true'
  const before = fetchCalls, req = request(`/api/operations/bookings/${id}`, {cookie})
  assert.equal((await cloudApi.operationsGet(req)).status, 401)
  assert.equal((await router.operationsGet(req)).status, 401)
  assert.equal((await booking.adminBookingsGet(req)).status, 401)
  assert.equal((await booking.bookingDocumentGet(req, {admin:true, id, kind:'agreement'})).status, 401)
  assert.equal((await photos.adminPhotoGet(req, id, photoId)).status, 401)
  assert.equal((await booking.proposalPost(request(`/api/operations/bookings/${id}/proposals`, {cookie, body:{}}), id)).status, 401)
  assert.equal((await cloudApi.googleConnectGet(request('/api/google/connect', {cookie}))).status, 401)
  assert.equal((await cloudApi.googleCallbackGet(request('/api/google/callback?state=synthetic&code=synthetic', {cookie}))).status, 401)
  await assert.rejects(cloudAuth.createSession('google', 'synthetic-company'), (error:unknown) => error instanceof Error && 'status' in error && error.status === 403)
  assert.equal(fetchCalls, before, 'A legacy cookie never reaches staff credentials, sessions or private data')
  assert.deepEqual(commands, [])
})

test('staff session registry rows are not accepted as legacy preview cookie sessions', async () => {
  const cookie = await putSession('supabase', 'staff')
  const req = request('/api/operations', {cookie})
  assert.equal(await cloudAuth.getSession(req), null)
  assert.equal((await cloudApi.operationsGet(req)).status, 401)
})
