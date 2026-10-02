import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// Isolated database and synthetic credentials only. All outbound requests are intercepted.
Object.assign(process.env, {
  OPERATIONS_STORE: 'supabase', LOCAL_OPERATIONS_ENABLED: 'true', APP_BASE_URL: 'http://127.0.0.1:3002',
  LOCAL_OWNER_PASSWORD: 'oauth-test-password', NEXT_PUBLIC_SUPABASE_URL: 'https://oauth-pglite.invalid',
  SUPABASE_SECRET_KEY: 'synthetic-server-key', GOOGLE_CLIENT_ID: 'synthetic-client',
  GOOGLE_CLIENT_SECRET: 'synthetic-secret', GOOGLE_TOKEN_ENCRYPTION_KEY: '33'.repeat(32),
})
const db = new PGlite()
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
for (const name of readdirSync(new URL('../../../supabase/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8'))
}
async function rpc<T = unknown>(name:string, action:string, args:Record<string, unknown> = {}):Promise<T> {
  assert.ok(['lk_google_health','lk_operations_command'].includes(name))
  return (await db.query<{result:T}>(`select public.${name}($1,$2::jsonb) as result`, [action,JSON.stringify(args)])).rows[0].result
}
const command = <T = unknown>(action:string,args:Record<string,unknown> = {}) => rpc<T>('lk_operations_command',action,args)
const health = <T = unknown>(action:string,args:Record<string,unknown> = {}) => rpc<T>('lk_google_health',action,args)
const originalFetch = globalThis.fetch
let provider:(request:Request)=>Promise<Response> = async()=>{throw new Error('Unexpected provider request')}
globalThis.fetch = async (input,init) => {
  const req = new Request(input,init), url = new URL(req.url)
  if(url.origin !== 'https://oauth-pglite.invalid') return provider(req)
  assert.equal(req.headers.get('apikey'),'synthetic-server-key')
  const body = await req.json() as {action:string;command:string;args:Record<string,unknown>}
  try { return Response.json(await rpc(url.pathname.split('/').at(-1)!,body.action??body.command,body.args)) }
  catch(error) { const e=error as {code:string;message:string};return Response.json({code:e.code,message:e.message},{status:400}) }
}
const auth = await import('./infrastructure/supabase-auth.ts')
const { encrypt, decrypt } = await import('./infrastructure/auth.ts')
const { googleResponseFailure } = await import('./infrastructure/google-errors.ts')
const { recordGoogleHealth, connectionState } = await import('./infrastructure/supabase-google-health.ts')
const api = await import('./supabase-api.ts')
const labelResponse=()=>Response.json({labels:[{id:'label-1',name:'Test label',type:'user'}]})
beforeEach(async()=>{
  await db.exec('reset role')
  const tables=await db.query<{tablename:string}>("select tablename from pg_tables where schemaname='public' and tablename like 'lk_%'")
  await db.exec(`truncate ${tables.rows.map(row=>`public.${row.tablename}`).join(',')}`)
  await db.exec('set role service_role')
  provider=async()=>{throw new Error('Unexpected provider request')}
})
after(async()=>{globalThis.fetch=originalFetch;await db.close()})
async function seed(expired = true) {
  await health('reconnect',{account_sub:'company-1',email:'Lnkgroupsydney@gmail.com',access_cipher:encrypt('old-access'),refresh_cipher:encrypt('refresh-secret'),expires_at:expired?0:Date.now()+3600000})
  await health('select',{kind:'gmail',id:'label-1'})
  await health('select',{kind:'calendar',id:'calendar-1'})
  return (await auth.getConnection())!
}
function failureCode(expected:string) { return (error:unknown) => !!error&&typeof error==='object'&&'code' in error&&error.code===expected }
function dbCode(expected:string) { return (error:unknown) => !!error&&typeof error==='object'&&'code' in error&&error.code===expected }

 test('invalid_grant persists reconnect state without clearing credentials and prevents repeated refresh attempts',async()=>{
  const initial=await seed();let calls=0
  provider=async()=>{calls++;return Response.json({error:'invalid_grant',error_description:'PRIVATE RESPONSE'},{status:400})}
  await assert.rejects(auth.accessToken(),failureCode('google_reconnect_required'))
  await assert.rejects(auth.accessToken(),failureCode('google_reconnect_required'))
  assert.equal(calls,1)
  const saved=(await auth.getConnection())!
  assert.equal(saved.refresh_cipher,initial.refresh_cipher)
  assert.equal(saved.auth_health_code,'google_reconnect_required')
  const state=connectionState(saved,'gmail',true)
  assert.equal(state.status,'reconnect_required');assert.equal(state.connected,false)
  assert.ok(!JSON.stringify(state).includes('PRIVATE'))
  const cookie=(await auth.createSession('local',null)).split(';')[0]
  const response=await api.operationsGet(new Request('http://127.0.0.1:3002/api/operations',{headers:{cookie}}))
  const dashboard=await response.json()
  assert.equal(dashboard.calendar.status,'reconnect_required')
  assert.equal(dashboard.gmail.status,'reconnect_required')
 })

test('temporary refresh failures recover without reconnection and retain the refresh credential',async()=>{
  for(const status of [429,503,0]) {
    const initial=await seed()
    provider=async()=>{if(!status)throw new TypeError('PRIVATE NETWORK DETAIL');return Response.json({error:'temporary'},{status})}
    await assert.rejects(auth.accessToken(),failureCode('google_temporary'))
    assert.equal((await auth.getConnection())!.auth_health_code,'google_temporary')
    provider=async()=>Response.json({access_token:'renewed-access',expires_in:3600})
    assert.equal((await auth.accessToken()).token,'renewed-access')
    const saved=(await auth.getConnection())!
    assert.equal(saved.refresh_cipher,initial.refresh_cipher)
    assert.equal(saved.auth_health_code,'ready')
    assert.equal(connectionState(saved,'gmail',true).status,'unverified')
  }
})

test('provider errors distinguish grant, client configuration, permission, quota and malformed response',async()=>{
  const cases:[number,unknown,boolean,string][]=[
    [400,{error:'invalid_client'},true,'google_configuration'],
    [403,{error:{errors:[{reason:'accessNotConfigured'}]}},false,'google_configuration'],
    [403,{error:{errors:[{reason:'insufficientPermissions'}]}},false,'google_reconnect_required'],
    [403,{error:{errors:[{reason:'forbidden'}]}},false,'google_permission_denied'],
    [403,{error:{errors:[{reason:'userRateLimitExceeded'}]}},false,'google_temporary'],
    [401,{error:{message:'PRIVATE'}},false,'google_reconnect_required'],
    [400,{error:{message:'PRIVATE'}},false,'google_invalid_response'],
  ]
  for(const [status,body,token,expected] of cases) {
    const failure=await googleResponseFailure(Response.json(body,{status}),token)
    assert.equal(failure.code,expected);assert.ok(!failure.message.includes('PRIVATE'))
  }
})

test('health RPC rejects public callers, stale credentials, stale observations and expired sync holders',async()=>{
  const first=await seed(false)
  const observed=Date.now()+1
  assert.equal(await recordGoogleHealth(first,'gmail','ready',observed),true)
  assert.equal(await recordGoogleHealth(first,'gmail','google_temporary',observed-1),false)
  assert.equal((await auth.getConnection())!.gmail_health_code,'ready')
  await seed(false)
  assert.equal(await recordGoogleHealth(first,'auth','google_reconnect_required',Date.now()+2),false)
  const current=(await auth.getConnection())!
  await command('sync_acquire',{holder:'old-worker'})
  assert.equal(await recordGoogleHealth(current,'auth','google_temporary',Date.now()+3),false)
  await db.query('update public.lk_sync_lease set expires_at=0')
  await command('sync_acquire',{holder:'new-worker'})
  await assert.rejects(recordGoogleHealth(current,'auth','google_reconnect_required',Date.now()+4,'old-worker'),/Google connection changed/)
  for(const role of ['anon','authenticated']) {
    await db.exec(`reset role; set role ${role}`)
    await assert.rejects(health('record',{}),dbCode('42501'))
  }
})

test('same-company reconnection preserves selected targets and enquiries, resets health, and requires no active sync',async()=>{
  const before=await seed(false)
  const enquiryId='00000000-0000-4000-8000-000000000002'
  await command('enquiry_create',{id:enquiryId,reference:'KCP-PRESERVED',key:'reconnect-preserve',hash:'hash',payload:{preferredDate:'2099-01-01',notes:'Original enquiry'}})
  const original=await command('enquiry_get',{id:enquiryId})
  await recordGoogleHealth(before,'auth','google_reconnect_required',Date.now()+1)
  const args={account_sub:'company-1',email:'Lnkgroupsydney@gmail.com',access_cipher:encrypt('new-access'),refresh_cipher:encrypt('new-refresh'),expires_at:Date.now()+3600000}
  await command('sync_acquire',{holder:'worker'})
  await assert.rejects(health('reconnect',args),dbCode('LK409'))
  await command('sync_release',{holder:'worker'})
  await assert.rejects(health('reconnect',{...args,account_sub:'different-company'}),dbCode('LK409'))
  await health('reconnect',args)
  const after=(await auth.getConnection())!
  assert.equal(after.selected_gmail_label_id,before.selected_gmail_label_id)
  assert.equal(after.selected_calendar_id,before.selected_calendar_id)
  assert.equal(after.auth_health_code,'ready')
  assert.equal(after.gmail_health_code,'unverified')
  assert.equal(after.calendar_health_code,'unverified')
  assert.deepEqual(await command('enquiry_get',{id:enquiryId}),original)
  assert.equal((await db.query('select * from public.lk_outbox')).rows.length,1)
})

test('syncAll preserves Calendar authorization failure and leaves unsent enquiry work queued',async()=>{
  await seed(false)
  await command('enquiry_create',{id:'00000000-0000-4000-8000-000000000001',reference:'KCP-TEST',key:'calendar-failure',hash:'hash',payload:{preferredDate:'2099-01-01'}})
  provider=async(req)=>req.url.endsWith('/labels')?labelResponse():req.url.includes('gmail.googleapis.com')?Response.json({messages:[]}):Response.json({error:{message:'PRIVATE CALENDAR ERROR'}},{status:401})
  const result=await api.syncAll() as {gmail:{error?:string};calendar:{code:string;error:string}}
  assert.equal(result.gmail.error,undefined)
  assert.equal(result.calendar.code,'google_reconnect_required')
  assert.ok(!result.calendar.error.includes('PRIVATE'))
  assert.equal((await db.query('select * from public.lk_outbox')).rows.length,1)
  assert.equal((await db.query('select * from public.lk_calendar_links')).rows.length,0)
  assert.equal((await auth.getConnection())!.auth_health_code,'google_reconnect_required')
})

test('an explicitly invalid saved Gmail cursor restarts once; unrelated 400 retains its cursor',async()=>{
  await seed(false)
  await db.query("update public.lk_google_connection set selected_calendar_id=null,gmail_page_token='stale'")
  let requests=0
  provider=async(req)=>{
    if(req.url.endsWith('/labels'))return labelResponse()
    requests++
    return new URL(req.url).searchParams.has('pageToken')?Response.json({error:{message:'Invalid pageToken'}},{status:400}):Response.json({messages:[]})
  }
  const recovered=await api.syncAll() as {gmail:{partial:boolean;error?:string}}
  assert.equal(requests,2);assert.equal(recovered.gmail.partial,false);assert.equal(recovered.gmail.error,undefined)
  assert.equal((await auth.getConnection())!.gmail_page_token,null)
  await db.query("update public.lk_google_connection set gmail_page_token='retain'")
  provider=async(req)=>req.url.endsWith('/labels')?labelResponse():Response.json({error:{message:'Unrelated bad request'}},{status:400})
  const failed=await api.syncAll() as {gmail:{error:string}}
  assert.ok(failed.gmail.error);assert.equal((await auth.getConnection())!.gmail_page_token,'retain')
})

test('bounded pagination reports partial and keeps the next cursor without claiming a completed sync',async()=>{
  await seed(false)
  await db.query('update public.lk_google_connection set selected_calendar_id=null')
  let pages=0
  provider=async(req)=>req.url.endsWith('/labels')?labelResponse():Response.json({messages:[],nextPageToken:`page-${++pages}`})
  const result=await api.syncAll() as {gmail:{partial:boolean}}
  assert.equal(pages,20);assert.equal(result.gmail.partial,true)
  const saved=(await auth.getConnection())!
  assert.equal(saved.gmail_page_token,'page-20')
  assert.equal(saved.gmail_last_synced_at,null)
  assert.equal(connectionState(saved,'gmail',true).status,'partial')
})

test('cursor recovery followed by provider failure does not record a completed scan',async()=>{
  await seed(false)
  await db.query("update public.lk_google_connection set selected_calendar_id=null,gmail_page_token='stale'")
  provider=async(req)=>{
    if(req.url.endsWith('/labels'))return labelResponse()
    return new URL(req.url).searchParams.has('pageToken')?Response.json({error:{message:'Invalid pageToken'}},{status:400}):Response.json({error:{message:'PRIVATE'}},{status:503})
  }
  const result=await api.syncAll() as {gmail:{code:string}}
  assert.equal(result.gmail.code,'google_temporary')
  const saved=(await auth.getConnection())!
  assert.equal(saved.gmail_page_token,null)
  assert.equal(saved.gmail_last_synced_at,null)
  assert.equal(connectionState(saved,'gmail',true).status,'retrying')
})

test('a late refresh rejection cannot poison a newer credential generation',async()=>{
  await seed()
  provider=async()=>{
    await health('reconnect',{account_sub:'company-1',email:'Lnkgroupsydney@gmail.com',access_cipher:encrypt('newest-access'),refresh_cipher:encrypt('newest-refresh'),expires_at:Date.now()+3600000})
    return Response.json({error:'invalid_grant'},{status:400})
  }
  await assert.rejects(auth.accessToken(),failureCode('google_reconnect_required'))
  const current=(await auth.getConnection())!
  assert.equal(current.auth_health_code,'ready');assert.equal(decrypt(current.access_cipher),'newest-access')
  assert.equal((await auth.accessToken()).token,'newest-access')
})
