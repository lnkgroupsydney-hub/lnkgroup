import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { validateQuoteDraft, type QuoteDraft } from './domain/quote-draft.ts'

// Synthetic data and in-memory Postgres only. Unexpected external calls fail the suite.
Object.assign(process.env, {
  OPERATIONS_STORE:'supabase', APP_BASE_URL:'http://127.0.0.1:3002',
  NEXT_PUBLIC_SUPABASE_URL:'https://draft-pglite.invalid', SUPABASE_SECRET_KEY:'synthetic-draft-key',
  GOOGLE_TOKEN_ENCRYPTION_KEY:'44'.repeat(32),
})
const db=new PGlite()
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
for(const name of readdirSync(new URL('../../../supabase/migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(new URL(`../../../supabase/migrations/${name}`,import.meta.url),'utf8'))
}
const tables=(await db.query<{tablename:string}>("select tablename from pg_tables where schemaname='public' and tablename like 'lk_%'")).rows.map(row=>row.tablename)
async function rpc<T=unknown>(name:string,command:string,args:Record<string,unknown>):Promise<T> {
  assert.ok(['lk_quote_draft','lk_operations_command'].includes(name))
  return (await db.query<{result:T}>(`select public.${name}($1,$2::jsonb) as result`,[command,JSON.stringify(args)])).rows[0].result
}
const originalFetch=globalThis.fetch
let databaseUnavailable=false
let rpcCalls=0
globalThis.fetch=async(input,init)=>{
  const req=new Request(input,init),url=new URL(req.url)
  assert.equal(url.origin,'https://draft-pglite.invalid','Unexpected external request')
  assert.equal(req.headers.get('apikey'),'synthetic-draft-key')
  assert.equal(req.cache,'no-store')
  rpcCalls++
  if(databaseUnavailable)return Response.json({code:'XX000',message:'PRIVATE DATABASE DIAGNOSTICS'},{status:503})
  const body=await req.json() as {command:string;args:Record<string,unknown>}
  try{return Response.json(await rpc(url.pathname.split('/').at(-1)!,body.command,body.args))}
  catch(error){const e=error as {code:string;message:string};return Response.json({code:e.code,message:e.message},{status:400})}
}
const api=await import('./infrastructure/quote-draft-api.ts')
beforeEach(async()=>{
  await db.exec('reset role')
  await db.exec(`truncate ${tables.map(name=>`public.${name}`).join(',')}`)
  await db.exec('set role service_role')
  databaseUnavailable=false;rpcCalls=0
  process.env.APP_BASE_URL='http://127.0.0.1:3002'
})
after(async()=>{globalThis.fetch=originalFetch;await db.close()})
const contact={name:'Draft Client',email:'draft@example.invalid',phone:'',siteAddress:'1 Test Street',suburb:'Test suburb',postcode:'2000',details:'Synthetic project\nSecond line',consent:true}
const service={serviceId:'cabinet-painting',intent:'full-repainting',surfaces:['doors'],doorCount:4,drawerCount:null,material:'',colourPreference:''}
const payload=()=>({contact:{...contact},service:null})
function request(method:string,cookie?:string,body?:unknown,headers:Record<string,string>={}) {
  return new Request('http://127.0.0.1:3002/api/quote/draft',{method,headers:{origin:'http://127.0.0.1:3002',...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{}),...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})})
}
async function session(){const res=await api.draftSessionPost(request('POST'));assert.equal(res.status,200);return res.headers.get('set-cookie')!.split(';')[0]}
async function save(cookie:string,revision=0,values:unknown=payload()) {return api.draftPut(request('PUT',cookie,{expectedRevision:revision,payload:values}))}
async function saved(cookie:string,revision=0,values:unknown=payload()):Promise<QuoteDraft> {const response=await save(cookie,revision,values);assert.equal(response.status,200,await response.clone().text());return (await response.json()).draft}
function ownerHash(cookie:string){return createHash('sha256').update(cookie.slice(cookie.indexOf('=')+1)).digest('hex')}
function signedCookie(expiry:number) {
  const value=`${expiry}.${randomBytes(32).toString('hex')}`
  const mac=createHmac('sha256',Buffer.from(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY!,'hex')).update(`quote-draft-session-v1:${value}`).digest('hex')
  return `lk_quote_draft=${value}.${mac}`
}
const code=(expected:string)=>(error:unknown)=>!!error&&typeof error==='object'&&'code' in error&&error.code===expected

 test('draft input accepts only approved services and cannot smuggle quote approval, price or signature into storage',()=>{
  const normal=validateQuoteDraft({contact:{...contact,email:' DRAFT@EXAMPLE.INVALID '},service:{...service,surfaces:['doors','doors']},price:1,approved:true,signature:'forged'})
  assert.equal(normal.contact.email,contact.email)
  assert.deepEqual(normal.service?.surfaces,['doors'])
  assert.deepEqual(Object.keys(normal),['contact','service'])
  for(const bad of [
    {...payload(),contact:{...contact,consent:false}},
    {...payload(),contact:{...contact,email:'invalid'}},
    {...payload(),contact:{...contact,details:'Bad\u0000text'}},
    {...payload(),contact:{...contact,postcode:'20000'}},
    {...payload(),service:{...service,serviceId:'new-cabinet-installation'}},
    {...payload(),service:{...service,surfaces:['doors','unknown']}},
    {...payload(),service:{...service,surfaces:['unsupported']}},
    {...payload(),service:{...service,doorCount:1.5}},
    {...payload(),service:{...service,drawerCount:501}},
    {...payload(),service:{...service,intent:'arbitrary'}},
  ])assert.throws(()=>validateQuoteDraft(bad))
 })

test('signed HttpOnly sessions preserve an existing session and add Secure for HTTPS',async()=>{
  const first=await api.draftSessionPost(request('POST'))
  const header=first.headers.get('set-cookie')!
  assert.match(header,/Path=\/api\/quote; HttpOnly; SameSite=Lax; Max-Age=86400/)
  assert.equal(first.headers.get('cache-control'),'private, no-store')
  const same=await api.draftSessionPost(request('POST',header.split(';')[0]))
  assert.equal(same.headers.get('set-cookie'),null)
  process.env.APP_BASE_URL='https://preview.example.invalid'
  const https=await api.draftSessionPost(request('POST',undefined,undefined,{origin:'https://preview.example.invalid'}))
  assert.match(https.headers.get('set-cookie')!,/; Secure$/)
  assert.equal(rpcCalls,0)
})

test('tampered, expired, missing and implausibly future cookies cannot read or overwrite a saved draft',async()=>{
  const cookie=await session();const original=await saved(cookie)
  const mac=cookie.slice(-64)
  const tampered=cookie.slice(0,-64)+(mac[0]==='0'?'1':'0')+mac.slice(1)
  const expired=signedCookie(Math.floor(Date.now()/1000)-1)
  const farFuture=signedCookie(Math.floor(Date.now()/1000)+90000)
  for(const bad of [undefined,tampered,expired,farFuture,'lk_quote_draft=invalid']) {
    const before=rpcCalls
    assert.deepEqual(await (await api.draftGet(request('GET',bad))).json(),{draft:null})
    assert.equal((await api.draftPut(request('PUT',bad,{expectedRevision:1,payload:{...payload(),contact:{...contact,name:'Overwrite'}}}))).status,401)
    assert.equal(rpcCalls,before)
  }
  assert.deepEqual((await (await api.draftGet(request('GET',cookie))).json()).draft,original)
})

test('missing/foreign origins and cross-site saves are rejected before touching the database',async()=>{
  const cookie=await session()
  for(const headers of [{origin:'https://attacker.invalid'},{origin:''},{'sec-fetch-site':'cross-site'}]) {
    const before=rpcCalls
    assert.equal((await api.draftSessionPost(request('POST',undefined,undefined,headers))).status,403)
    assert.equal((await api.draftPut(request('PUT',cookie,{expectedRevision:0,payload:payload()},headers))).status,403)
    assert.equal(rpcCalls,before)
  }
})

test('sessions with the same email own separate drafts and supplied owner or draft identifiers are ignored',async()=>{
  const a=await session(),b=await session()
  const first=await saved(a),second=await saved(b)
  assert.notEqual(first.id,second.id)
  const forged=await api.draftPut(request('PUT',b,{expectedRevision:1,owner_hash:ownerHash(a),id:first.id,payload:{...payload(),contact:{...contact,name:'Second client'}}}))
  assert.equal(forged.status,200)
  const currentA=(await (await api.draftGet(request('GET',a))).json()).draft
  const currentB=(await (await api.draftGet(request('GET',b))).json()).draft
  assert.deepEqual(currentA,first)
  assert.equal(currentB.id,second.id);assert.equal(currentB.payload.contact.name,'Second client')
  const raw=(await db.query<{owner_hash:string;payload:unknown}>('select owner_hash,payload from public.lk_quote_drafts')).rows
  assert.ok(raw.every(row=>row.owner_hash!==a&&row.owner_hash!==b))
})

test('lost-response replay is idempotent and simultaneous divergent edits produce exactly one revision winner',async()=>{
  const cookie=await session(),first=await saved(cookie)
  assert.deepEqual(await saved(cookie,0),first)
  const inputs=['First update','Other update'].map(name=>({...payload(),contact:{...contact,name},service}))
  const results=await Promise.all(inputs.map(input=>save(cookie,first.revision,input)))
  assert.deepEqual(results.map(result=>result.status).sort(),[200,409])
  const winner=await results.find(result=>result.status===200)!.json() as {draft:QuoteDraft}
  assert.equal(winner.draft.revision,2)
  assert.deepEqual(await saved(cookie,1,winner.draft.payload),winner.draft)
  const current=(await (await api.draftGet(request('GET',cookie))).json()).draft
  assert.deepEqual(current,winner.draft)
  assert.equal((await db.query('select * from public.lk_quote_drafts')).rows.length,1)
})

test('expired database drafts stay inaccessible even with a still-valid browser cookie',async()=>{
  const cookie=await session();await saved(cookie)
  await db.query('update public.lk_quote_drafts set expires_at=now()-interval \'1 second\'')
  assert.deepEqual(await (await api.draftGet(request('GET',cookie))).json(),{draft:null})
  assert.equal((await save(cookie,1)).status,401)
  assert.equal((await db.query<{revision:number}>('select revision from public.lk_quote_drafts')).rows[0].revision,1)
})

test('malformed, oversized and invalid-revision requests never create drafts',async()=>{
  const cookie=await session()
  assert.equal((await api.draftPut(request('PUT',cookie,'not json'))).status,400)
  assert.equal((await api.draftPut(request('PUT',cookie,{expectedRevision:0,payload:payload()},{'content-type':'text/plain'}))).status,415)
  assert.equal((await api.draftPut(request('PUT',cookie,'x'.repeat(16001)))).status,413)
  assert.equal((await api.draftPut(request('PUT',cookie,{}, {'content-length':'16001'}))).status,413)
  for(const expectedRevision of [-1,0.5,null,2147483648,Number.MAX_SAFE_INTEGER]) {
    assert.equal((await api.draftPut(request('PUT',cookie,{expectedRevision,payload:payload()}))).status,400)
  }
  assert.equal((await db.query('select * from public.lk_quote_drafts')).rows.length,0)
  await assert.rejects(rpc('lk_quote_draft','save',{owner_hash:ownerHash(cookie),payload:payload(),payload_hash:'hash',expires_at:new Date(Date.now()+3600000).toISOString()}),code('LK400'))
})

test('RLS and RPC privileges deny anon/authenticated while saving has no enquiry, Gmail or calendar side effects',async()=>{
  const cookie=await session();await saved(cookie,0,{contact,service})
  for(const table of ['lk_enquiries','lk_outbox','lk_gmail_seen','lk_gmail_threads','lk_calendar_links','lk_change_requests','lk_google_connection']) {
    assert.equal((await db.query(`select * from public.${table}`)).rows.length,0,table)
  }
  for(const role of ['anon','authenticated']) {
    await db.exec(`reset role; set role ${role}`)
    await assert.rejects(db.query('select * from public.lk_quote_drafts'),code('42501'))
    await assert.rejects(db.query('delete from public.lk_quote_drafts'),code('42501'))
    await assert.rejects(rpc('lk_quote_draft','read',{owner_hash:ownerHash(cookie)}),code('42501'))
  }
  await db.exec('reset role; set role service_role')
  assert.equal((await db.query<{rowsecurity:boolean}>("select rowsecurity from pg_tables where schemaname='public' and tablename='lk_quote_drafts'")).rows[0].rowsecurity,true)
})

test('rotating signed sessions cannot exceed the global creation cap; existing draft retry still succeeds',async()=>{
  const existingCookie=await session(),existing=await saved(existingCookie)
  await db.query("update public.lk_rate_buckets set count=99 where bucket='quote-drafts:create:global'")
  const newCookies=await Promise.all([session(),session()])
  const competitors=await Promise.all(newCookies.map(cookie=>save(cookie)))
  assert.deepEqual(competitors.map(result=>result.status).sort(),[200,429])
  assert.equal((await db.query('select * from public.lk_quote_drafts')).rows.length,2)
  assert.deepEqual(await saved(existingCookie,0),existing)
  const updated=await saved(existingCookie,1,{...payload(),contact:{...contact,name:'Existing update'}})
  assert.equal(updated.revision,2)
  const rate=(await db.query<{count:number}>("select count from public.lk_rate_buckets where bucket='quote-drafts:create:global'")).rows[0]
  assert.equal(rate.count,100)
})

test('per-session throttling and database failure return honest failure without leaking diagnostics or false success',async()=>{
  const cookie=await session()
  await rpc('lk_operations_command','rate_limit',{bucket:`draft:${ownerHash(cookie)}`,max:120,window:3600000})
  await db.query('update public.lk_rate_buckets set count=120')
  assert.equal((await save(cookie)).status,429)
  assert.equal((await db.query('select * from public.lk_quote_drafts')).rows.length,0)
  databaseUnavailable=true
  const result=await save(await session())
  assert.equal(result.status,503)
  const text=await result.text();assert.ok(!text.includes('PRIVATE'));assert.ok(!text.includes('"draft":'))
})
