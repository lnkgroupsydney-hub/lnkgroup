import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// This suite uses the production SQL in an in-memory Postgres engine. Every
// Supabase request is intercepted; no credentials or external services are used.
process.env.OPERATIONS_STORE = 'supabase'
process.env.LOCAL_OPERATIONS_ENABLED = 'true'
process.env.APP_BASE_URL = 'http://127.0.0.1:3002'
process.env.LOCAL_OWNER_PASSWORD = 'supabase-test-password-only'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://local-pglite.invalid'
process.env.SUPABASE_SECRET_KEY = 'synthetic-server-key'
process.env.GOOGLE_CLIENT_ID = 'synthetic-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'synthetic-client-secret'
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = '22'.repeat(32)

const db = new PGlite()
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
for (const name of readdirSync(new URL('../../../supabase/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8'))
const tables = (await db.query<{tablename:string}>("select tablename from pg_tables where schemaname='public' and tablename like 'lk_%' order by tablename")).rows.map(row => row.tablename)
await db.exec('set role service_role')

type Row = {
  id:string; reference:string; revision:number; status:string; calendar_status:string;
  start_at:string|null; end_at:string|null; event_generation:number; attachment_count:number;
  payload_json:{preferredDate:string|null; gmail?:{messages:{messageId:string}[]; historyTruncated:boolean}};
}
async function command<T = unknown>(name:string, args:Record<string, unknown> = {}):Promise<T> {
  const result = await db.query<{result:T}>('select public.lk_operations_command($1, $2::jsonb) as result', [name, JSON.stringify(args)])
  return result.rows[0].result
}
async function query<T extends Record<string, unknown>>(sql:string, args:unknown[] = []) {
  return (await db.query<T>(sql, args)).rows
}
function code(expected:string) {
  return (error:unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === expected
}
const originalFetch = globalThis.fetch
let providerFetch:((request:Request) => Promise<Response>)|null = null
globalThis.fetch = async (resource, init) => {
  const request = new Request(resource, init)
  if (!request.url.startsWith('https://local-pglite.invalid/rest/v1/rpc/')) {
    assert.ok(providerFetch, 'Unexpected network request; live access is forbidden in this suite')
    return providerFetch(request)
  }
  assert.equal(request.headers.get('apikey'), 'synthetic-server-key')
  const payload = await request.json() as {command:string; action:string; args:Record<string, unknown>}
  try {
    if(request.url.endsWith('/lk_google_health')) return Response.json((await db.query<{result:unknown}>('select public.lk_google_health($1,$2::jsonb) as result',[payload.action,JSON.stringify(payload.args)])).rows[0].result)
    return Response.json(await command(payload.command, payload.args))
  } catch (error) {
    const failure = error as {code:string; message:string}
    return Response.json({code:failure.code, message:failure.message, details:null, hint:null}, {status:400})
  }
}
const api = await import('./supabase-api.ts')
const store = await import('./infrastructure/supabase-store.ts')
const auth = await import('./infrastructure/supabase-auth.ts')
const router = await import('./router.ts')
const { validateEnquiry } = await import('./domain/validation.ts')
const { sha, encrypt, decrypt, GOOGLE_SCOPES } = await import('./infrastructure/auth.ts')

beforeEach(async () => {
  providerFetch = null
  process.env.OPERATIONS_STORE = 'supabase'
  process.env.LOCAL_OPERATIONS_ENABLED = 'true'
  process.env.APP_BASE_URL = 'http://127.0.0.1:3002'
  await db.exec('reset role')
  await db.exec(`truncate ${tables.map(table => `public.${table}`).join(', ')}`)
  await db.exec('set role service_role')
})
after(async () => { globalThis.fetch = originalFetch; await db.close() })

const input = (key:string, date:string|null = '2099-01-01') => ({
  serviceId:'cabinet-painting', projectIntent:'Repaint existing doors', targetSurfaces:['doors'],
  suburb:'Sydney', postcode:'2000', doorCount:4, drawerCount:2, notes:'First line\nSecond line',
  name:'Synthetic Test', email:'test@example.invalid', preferredDate:date, acknowledgement:true, idempotencyKey:key,
})
async function create(key = randomUUID(), preferredDate:string|null = '2099-01-01') {
  const id = randomUUID()
  return command<Row>('enquiry_create', {id, reference:`KCP-${id}`, key, hash:`hash-${key}`, payload:input(key, preferredDate)})
}
async function connection() {
  await command('connection_save', {account_sub:'account-1', email:'Lnkgroupsydney@gmail.com', access_cipher:'encrypted-access', refresh_cipher:'encrypted-refresh', expires_at:Date.now()+3600000})
  await command('connection_select', {kind:'calendar', id:'owned-calendar'})
  await command('connection_select', {kind:'gmail', id:'label-1'})
}
async function lease(holder = 'worker-1') {
  assert.equal(await command('sync_acquire', {holder}), true)
  return holder
}
async function linked(row:Row, holder:string) {
  const link = await command<{event_id:string}|null>('calendar_link', {id:row.id})
  await command('calendar_success', {holder, id:row.id, revision:row.revision, expected_event:link?.event_id??null, generation:row.event_generation, event:`event-${row.id}`, etag:'etag-initial', preferred:row.payload_json.preferredDate})
}
async function conflict(row:Row, holder:string, kind = 'move', etag = 'etag-remote') {
  const id = randomUUID()
  const link = await command<{event_id:string}|null>('calendar_link', {id:row.id})
  assert.equal(await command('calendar_conflict', {holder, id:row.id, revision:row.revision, expected_event:link?.event_id??null, event:`event-${row.id}`, change:id, etag, kind, preferred:kind === 'move' ? '2099-01-03' : null}), true)
  return id
}
async function decision(change:string, action:string, options:Record<string, unknown> = {}) {
  const current = await command<{enquiry_id:string; revision:number; provider_etag:string}>('change_get', {id:change})
  return command<Row>('change_decide', {id:change, revision:current.revision, action, event:`event-${current.enquiry_id}`, calendar:'owned-calendar', etag:current.provider_etag, ...options})
}
const request = (path:string, body:unknown, cookie?:string, origin = 'http://127.0.0.1:3002') => new Request(`http://127.0.0.1:3002${path}`, {
  method:'POST', headers:{origin, 'content-type':'application/json', ...(cookie ? {cookie} : {})}, body:JSON.stringify(body),
})

test('private operations tables and RPC deny anon/authenticated; trusted server role can write', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec('reset role')
    await db.exec(`set role ${role}`)
    for (const table of tables) {
      await assert.rejects(db.query(`select * from public.${table}`), code('42501'))
      await assert.rejects(db.query(`delete from public.${table}`), code('42501'))
    }
    await assert.rejects(command('health'), code('42501'))
  }
  await db.exec('reset role; set role service_role')
  assert.deepEqual(await command('health'), {ready:true, schemaVersion:1})
  const enquiry = await create()
  assert.equal((await command<Row>('enquiry_get', {id:enquiry.id})).id, enquiry.id)
  const secured = await query<{tablename:string; rowsecurity:boolean}>("select tablename, rowsecurity from pg_tables where schemaname='public' and tablename like 'lk_%'")
  assert.equal(secured.length, tables.length)
  assert.ok(secured.every(row => row.rowsecurity))
})

test('web retries retain one durable enquiry and reject changed payloads atomically', async () => {
  const first = await store.createEnquiry(validateEnquiry(input('web-idempotency')))
  const repeat = await store.createEnquiry(validateEnquiry(input('web-idempotency')))
  assert.equal(repeat.id, first.id)
  await assert.rejects(store.createEnquiry(validateEnquiry({...input('web-idempotency'), doorCount:5})), /Idempotency key/)
  assert.equal((await query('select id from public.lk_enquiries')).length, 1)
  assert.equal((await query('select enquiry_id from public.lk_outbox')).length, 1)
  assert.equal((await store.getEnquiry(first.id))?.notes, 'First line\nSecond line')
})

test('schedule revision and interval validation preserve enquiry, outbox, and pending review on failure', async () => {
  const row = await create()
  const holder = await lease()
  const change = await conflict(row, holder)
  const args = {id:row.id, revision:1, start:'2099-01-01T22:00:00Z', end:'2099-01-02T06:00:00Z', notes:'Requested times'}
  await assert.rejects(command('schedule', {...args, revision:2}), code('LK409'))
  await assert.rejects(command('schedule', {...args, end:args.start}), code('23514'))
  assert.equal((await command<Row>('enquiry_get', {id:row.id})).revision, 1)
  assert.equal((await command<{status:string}>('change_get', {id:change})).status, 'pending')
  assert.equal((await query<{revision:number}>('select revision from public.lk_outbox'))[0].revision, 1)
  const saved = await command<Row>('schedule', args)
  assert.equal(saved.revision, 2)
  assert.equal(saved.status, 'provisional')
  assert.equal(saved.calendar_status, 'pending')
  assert.equal((await command<{status:string}>('change_get', {id:change})).status, 'rejected')
  assert.equal((await query<{revision:number}>('select revision from public.lk_outbox'))[0].revision, 2)
})

test('Gmail deduplication, latest 30 messages, account isolation, and review rebasing stay atomic', async () => {
  const holder = await lease()
  const candidate = (n:number) => ({messageId:`message-${n}`, threadId:'thread-1', internalDate:new Date(Date.UTC(2099, 0, n)).toISOString(), senderName:'Unverified sender', senderEmail:'sender@example.invalid', senderReviewRequired:true as const, subject:`Message ${n}`, bodyText:`Body ${n}`, bodyStatus:'available' as const, attachments:[], attachmentCount:1})
  let saved = await store.importGmail('account-1', candidate(35), holder)
  const id = saved.id
  for (let n=34; n>=1; n--) saved = await store.importGmail('account-1', candidate(n), holder)
  assert.equal(saved.id, id)
  assert.equal(saved.revision, 35)
  assert.equal(saved.attachmentCount, 35)
  assert.equal(saved.gmail?.messages.length, 30)
  assert.equal(saved.gmail?.messages[0].messageId, 'message-6')
  assert.equal(saved.gmail?.messages.at(-1)?.messageId, 'message-35')
  assert.equal(saved.gmail?.historyTruncated, true)
  assert.equal(saved.acknowledgement, false)
  assert.equal((await store.importGmail('account-1', candidate(35), holder)).revision, 35)
  const current = await command<Row>('enquiry_get', {id})
  const change = await conflict(current, holder)
  await command('gmail_quarantine', {holder, account:'account-1', message:'message-36', reason:'invalid_response'})
  await store.importGmail('account-1', candidate(36), holder)
  const review = await command<{enquiry_revision:number; revision:number; status:string}>('change_get', {id:change})
  assert.equal(review.enquiry_revision, 36)
  assert.equal(review.revision, 2)
  assert.equal(review.status, 'pending')
  assert.equal((await command<Row>('enquiry_get', {id})).calendar_status, 'conflict')
  assert.equal((await query('select * from public.lk_gmail_quarantine')).length, 0)
  assert.notEqual((await store.importGmail('account-2', candidate(36), holder)).id, id)
  assert.equal((await query('select id from public.lk_enquiries')).length, 2)
  assert.equal((await query('select message_id from public.lk_gmail_seen')).length, 37)
})

test('expired sync holders cannot complete Calendar or Gmail writes or release a new holder', async () => {
  const row = await create()
  const old = await lease('expired-worker')
  assert.equal(await command('sync_acquire', {holder:'other-worker'}), false)
  await db.query('update public.lk_sync_lease set expires_at=0')
  const holder = await lease('new-worker')
  assert.equal(await command('sync_renew', {holder:old}), false)
  for (const operation of ['calendar_success', 'calendar_failure', 'calendar_conflict', 'calendar_etag', 'calendar_cursor', 'gmail_import', 'gmail_quarantine', 'gmail_cursor', 'sync_error']) {
    await assert.rejects(command(operation, {holder:old, id:row.id, revision:1}), code('LK409'))
  }
  await command('sync_release', {holder:old})
  assert.equal(await command('sync_renew', {holder}), true)
  assert.equal((await command<Row>('enquiry_get', {id:row.id})).calendar_status, 'pending')
  assert.equal((await query('select * from public.lk_calendar_links')).length, 0)
})

test('Calendar completion CAS keeps newer schedules queued and stale conflicts cannot freeze them', async () => {
  const row = await create()
  const holder = await lease()
  await command('schedule', {id:row.id, revision:1, start:'2099-01-01T22:00:00Z', end:'2099-01-02T06:00:00Z'})
  await linked(row, holder)
  assert.equal((await command<Row>('enquiry_get', {id:row.id})).calendar_status, 'pending')
  assert.equal((await query<{revision:number}>('select revision from public.lk_outbox'))[0].revision, 2)
  await command('calendar_failure', {holder, id:row.id, revision:1})
  assert.equal(await command('calendar_conflict', {holder, id:row.id, revision:1, change:randomUUID(), etag:'old-etag', kind:'move'}), false)
  const latest = await command<Row>('enquiry_get', {id:row.id})
  const first = await conflict(latest, holder)
  assert.deepEqual(await command('calendar_pending'), [])
  const second = await conflict(latest, holder, 'move', 'etag-newer-remote')
  assert.equal((await command<{status:string}>('change_get', {id:first})).status, 'superseded')
  assert.equal((await command<{status:string}>('change_get', {id:second})).status, 'pending')
  assert.equal((await query("select id from public.lk_change_requests where status='pending'")).length, 1)
})

test('approving/rejecting Calendar changes guards etag and revision, then queues the chosen version', async () => {
  await connection()
  const row = await create()
  const holder = await lease()
  await linked(row, holder)
  const change = await conflict(row, holder)
  await assert.rejects(decision(change, 'approve', {revision:2}), code('LK409'))
  await assert.rejects(decision(change, 'approve', {etag:'outdated-etag'}), code('LK409'))
  await assert.rejects(decision(change, 'approve', {calendar:'another-calendar'}), code('LK409'))
  const approved = await decision(change, 'approve')
  assert.equal(approved.payload_json.preferredDate, '2099-01-03')
  assert.equal(approved.revision, 2)
  assert.equal(approved.calendar_status, 'pending')
  assert.equal((await query<{revision:number}>('select revision from public.lk_outbox'))[0].revision, 2)
  await assert.rejects(decision(change, 'approve'), code('LK404'))
  const next = await conflict(approved, holder, 'move', 'etag-rejected')
  const rejected = await decision(next, 'reject')
  assert.equal(rejected.revision, 2)
  assert.equal(rejected.payload_json.preferredDate, '2099-01-03')
  assert.equal(rejected.calendar_status, 'pending')
  assert.equal((await command<{status:string}>('change_get', {id:next})).status, 'rejected')
})

test('delete approval increments event generation; deletion rejection uses a fresh provider event ID', async () => {
  await connection()
  const row = await create()
  const holder = await lease()
  await linked(row, holder)
  const deleted = await decision(await conflict(row, holder, 'delete'), 'approve')
  assert.equal(deleted.event_generation, 1)
  assert.equal(deleted.payload_json.preferredDate, null)
  assert.equal(deleted.calendar_status, 'synced')
  assert.equal(await command('calendar_link', {id:row.id}), null)
  assert.equal((await query('select * from public.lk_outbox')).length, 0)
  const scheduled = await command<Row>('schedule', {id:row.id, revision:2, start:'2099-01-01T22:00:00Z', end:'2099-01-02T06:00:00Z'})
  assert.equal(scheduled.event_generation, 1)
  assert.equal((await command<Row[]>('calendar_pending')).length, 1)
  await linked(scheduled, holder)
  const rejected = await decision(await conflict(scheduled, holder, 'delete', 'etag-delete-again'), 'reject', {restored_event:'fresh-restored-event'})
  assert.equal(rejected.revision, 3)
  assert.equal((await command<{event_id:string}>('calendar_link', {id:row.id})).event_id, 'fresh-restored-event')
  assert.equal((await query('select * from public.lk_outbox')).length, 1)
})

test('invalid provider changes stay in review until rejected', async () => {
  await connection()
  const row = await create()
  const holder = await lease()
  await linked(row, holder)
  const change = await conflict(row, holder, 'invalid')
  await assert.rejects(decision(change, 'approve'), code('LK400'))
  assert.equal((await command<Row>('enquiry_get', {id:row.id})).calendar_status, 'conflict')
  assert.equal((await decision(change, 'reject')).calendar_status, 'pending')
})

test('connection selection and reconnection are blocked by active sync and linked calendar migration', async () => {
  await connection()
  const row = await create()
  const holder = await lease()
  await assert.rejects(command('connection_select', {kind:'calendar', id:'new-calendar'}), code('LK409'))
  await assert.rejects(command('connection_select', {kind:'gmail', id:'new-label'}), code('LK409'))
  await assert.rejects(command('connection_save', {account_sub:'account-1'}), code('LK409'))
  await linked(row, holder)
  await command('sync_release', {holder})
  await assert.rejects(command('connection_select', {kind:'calendar', id:'new-calendar'}), code('LK409'))
  await command('connection_select', {kind:'calendar', id:'owned-calendar'})
  await command('connection_select', {kind:'gmail', id:'new-label'})
  const saved = await command<{selected_calendar_id:string; selected_gmail_label_id:string}>('connection_get')
  assert.equal(saved.selected_calendar_id, 'owned-calendar')
  assert.equal(saved.selected_gmail_label_id, 'new-label')
})

test('Supabase HTTP handlers enforce owner session, origin, durable submit, schedule CAS, and logout', async () => {
  const unauthenticated = await api.operationsGet(new Request('http://127.0.0.1:3002/api/operations'))
  assert.equal(unauthenticated.status, 401)
  assert.equal(unauthenticated.headers.get('cache-control'), 'no-store')
  assert.equal((await api.loginPost(request('/api/operations/login', {password:'supabase-test-password-only'}, undefined, 'https://foreign.invalid'))).status, 403)
  assert.equal((await api.loginPost(request('/api/operations/login', {password:'wrong'}))).status, 401)
  const login = await api.loginPost(request('/api/operations/login', {password:'supabase-test-password-only'}))
  assert.equal(login.status, 200)
  const cookie = login.headers.get('set-cookie')!.split(';')[0]
  const rawToken = cookie.slice(cookie.indexOf('=')+1)
  assert.deepEqual((await query<{token_hash:string}>('select token_hash from public.lk_sessions')).map(row => row.token_hash), [sha(rawToken)])
  const submit = await api.enquiryPost(request('/api/enquiries', input('handler-enquiry')))
  assert.equal(submit.status, 201)
  const saved = await submit.json() as {id:string; reference:string}
  assert.equal((await api.enquiryPost(request('/api/enquiries', {...input('handler-enquiry'), doorCount:5}))).status, 409)
  const schedulePath = `/api/operations/enquiries/${saved.id}/schedule`
  const schedule = {expectedRevision:1, startLocal:'2099-01-03T09:00', endLocal:'2099-01-03T17:00', notes:'Provisional only'}
  assert.equal((await api.schedulePost(request(schedulePath, schedule))).status, 401)
  assert.equal((await api.schedulePost(request(schedulePath, schedule, cookie, 'https://foreign.invalid'))).status, 403)
  assert.equal((await api.schedulePost(request(schedulePath, {...schedule, endLocal:'2099-01-03T08:00'}, cookie))).status, 400)
  assert.equal((await api.schedulePost(request(schedulePath, schedule, cookie))).status, 200)
  assert.equal((await api.schedulePost(request(schedulePath, schedule, cookie))).status, 409)
  const dashboard = await api.operationsGet(new Request('http://127.0.0.1:3002/api/operations', {headers:{cookie}}))
  assert.equal(dashboard.status, 200)
  const content = await dashboard.json() as {enquiries:{id:string; revision:number; status:string}[]; storage:string}
  assert.equal(content.storage, 'supabase')
  assert.deepEqual(content.enquiries.map(({id, revision, status}) => ({id, revision, status})), [{id:saved.id, revision:2, status:'provisional'}])
  assert.equal((await api.logoutPost(request('/api/operations/logout', {}, cookie))).status, 200)
  assert.equal((await api.operationsGet(new Request('http://127.0.0.1:3002/api/operations', {headers:{cookie}}))).status, 401)
})

test('cloud-backed local sessions stop authenticating when local login is disabled; invalid store fails closed', async () => {
  const cookie = (await auth.createSession('local', null)).split(';')[0]
  const req = new Request('http://127.0.0.1:3002/api/operations', {headers:{cookie}})
  assert.ok(await auth.getSession(req))
  process.env.LOCAL_OPERATIONS_ENABLED = 'false'
  assert.equal(await auth.getSession(req), null)
  process.env.LOCAL_OPERATIONS_ENABLED = 'true'
  process.env.APP_BASE_URL = 'https://app.example.invalid'
  assert.equal(await auth.getSession(req), null)
  process.env.APP_BASE_URL = 'http://127.0.0.1:3002'
  process.env.OPERATIONS_STORE = 'supabse'
  assert.equal((await router.enquiryPost(request('/api/enquiries', input('invalid-store')))).status, 503)
  assert.equal((await query('select * from public.lk_enquiries')).length, 0)
})

async function oauthStart() {
  const response = await api.googleConnectGet(new Request('http://127.0.0.1:3002/api/google/connect'))
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const location = new URL(response.headers.get('location')!)
  assert.equal(location.origin, 'https://accounts.google.com')
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(location.searchParams.get('redirect_uri'), 'http://127.0.0.1:3002/api/google/callback')
  return {state:location.searchParams.get('state')!, cookie:response.headers.get('set-cookie')!.split(';')[0]}
}
function oauthMock(user:Record<string, unknown> = {sub:'account-1', email:'Lnkgroupsydney@gmail.com', email_verified:true}) {
  let requests = 0
  providerFetch = async request => {
    requests++
    if (request.url === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(await request.text())
      assert.ok(body.get('code_verifier'))
      return Response.json({access_token:'synthetic-access', refresh_token:'synthetic-refresh', expires_in:3600, scope:GOOGLE_SCOPES.join(' ')})
    }
    assert.equal(request.url, 'https://www.googleapis.com/oauth2/v3/userinfo')
    return Response.json(user)
  }
  return () => requests
}
function callback(state:string, cookie:string) {
  return api.googleCallbackGet(new Request(`http://127.0.0.1:3002/api/google/callback?state=${state}&code=synthetic-code`, {headers:{cookie}}))
}

test('Supabase OAuth handlers create mutable redirects, bind state to browser, and store encrypted company tokens', async () => {
  assert.equal((await api.googleConnectGet(new Request('http://127.0.0.1:3002/api/google/connect', {headers:{'sec-fetch-site':'cross-site'}}))).status, 403)
  const calls = oauthMock()
  const first = await oauthStart()
  assert.equal((await callback(first.state, 'lk_google_oauth=wrong')).status, 400)
  assert.equal(calls(), 0)
  assert.equal((await callback(first.state, first.cookie)).status, 400)
  const second = await oauthStart()
  const response = await callback(second.state, second.cookie)
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), 'http://127.0.0.1:3002/admin?google=connected')
  assert.ok(response.headers.get('set-cookie')?.includes('lk_ops_session='))
  const saved = await auth.getConnection()
  assert.equal(saved?.email, 'Lnkgroupsydney@gmail.com')
  assert.notEqual(saved?.access_cipher, 'synthetic-access')
  assert.equal(decrypt(saved!.access_cipher), 'synthetic-access')
  assert.equal(decrypt(saved!.refresh_cipher), 'synthetic-refresh')
  assert.equal((await callback(second.state, second.cookie)).status, 400)
})

test('OAuth refuses unverified/wrong company identities and invalid token shapes without saving credentials', async () => {
  for (const user of [
    {sub:'account-1', email:'Lnkgroupsydney@gmail.com', email_verified:'false'},
    {sub:'wrong-account', email:'someoneelse@gmail.com', email_verified:true},
  ]) {
    oauthMock(user)
    const started = await oauthStart()
    assert.equal((await callback(started.state, started.cookie)).status, 403)
    assert.equal(await auth.getConnection(), null)
  }
  providerFetch = async () => Response.json({access_token:123, scope:GOOGLE_SCOPES.join(' ')})
  const started = await oauthStart()
  assert.equal((await callback(started.state, started.cookie)).status, 502)
  assert.equal(await auth.getConnection(), null)
})

test('token refresh accepts omitted scope, rejects reduced grants, and cannot overwrite a newer connection', async () => {
  const seed = async () => command('connection_save', {account_sub:'account-1', email:'Lnkgroupsydney@gmail.com', access_cipher:encrypt('expired-access'), refresh_cipher:encrypt('synthetic-refresh'), expires_at:0})
  await seed()
  providerFetch = async request => {
    assert.equal(request.url, 'https://oauth2.googleapis.com/token')
    return Response.json({access_token:'refreshed-access', expires_in:3600})
  }
  assert.equal((await auth.accessToken()).token, 'refreshed-access')
  assert.equal(decrypt((await auth.getConnection())!.access_cipher), 'refreshed-access')
  await seed()
  providerFetch = async () => Response.json({access_token:'reduced-scope-access', expires_in:3600, scope:'openid email'})
  await assert.rejects(auth.accessToken(), /Google permissions need renewal/)
  assert.equal(decrypt((await auth.getConnection())!.access_cipher), 'expired-access')
  await db.query("update public.lk_google_connection set auth_health_code='unverified',auth_health_checked_at=null")
  providerFetch = async () => {
    await command('connection_save', {account_sub:'account-1', email:'Lnkgroupsydney@gmail.com', access_cipher:encrypt('newest-access'), refresh_cipher:encrypt('newest-refresh'), expires_at:Date.now()+3600000})
    return Response.json({access_token:'stale-refresh-response', expires_in:3600})
  }
  assert.equal((await auth.accessToken()).token, 'newest-access')
  assert.equal(decrypt((await auth.getConnection())!.access_cipher), 'newest-access')
})

test('a stale deleted-event snapshot cannot refreeze an enquiry after rejection creates a replacement', async () => {
  await connection()
  const row = await create()
  const holder = await lease()
  await linked(row, holder)
  const change = await conflict(row, holder, 'delete', 'deleted-etag')
  await decision(change, 'reject', {restored_event:'replacement-event'})
  assert.equal(await command('calendar_conflict', {holder, id:row.id, revision:1, expected_event:`event-${row.id}`, event:`event-${row.id}`, change:randomUUID(), kind:'delete', etag:'deleted-etag'}), false)
  assert.equal((await command<Row>('enquiry_get', {id:row.id})).calendar_status, 'pending')
  assert.equal((await query("select id from public.lk_change_requests where status='pending'")).length, 0)
  assert.equal((await command<{event_id:string}>('calendar_link', {id:row.id})).event_id, 'replacement-event')
})
