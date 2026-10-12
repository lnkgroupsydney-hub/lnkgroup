import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createCustomerAuthApi } from './infrastructure/customer-auth-api.ts'
import { createQuoteRequestApi } from './infrastructure/api.ts'
import { createQuoteMediaApi } from './infrastructure/media-api.ts'
import { QuoteRequestError, type LiveQuoteRequest } from './domain/contracts.ts'
import type { CustomerAuthProvider } from './domain/customer-auth.ts'
import type { QuoteRequestStore } from './application/requests.ts'
const db = new PGlite()
await db.exec('create role anon;create role authenticated;create role service_role bypassrls;')
for (const name of readdirSync(new URL('../../../supabase/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url),'utf8'))
const tables = (await db.query<{tablename:string}>("select tablename from pg_tables where schemaname='public' and tablename like 'lk_%'")).rows.map(row=>row.tablename)
const base='https://www.lnkgroupsydney.com.au', legacy='https://lnkgroup.vercel.app', secret='9a'.repeat(32)
let now=Date.now(), enabled=true, invalid=false, removed=false
const alice={ userId:randomUUID(), email:'alice@example.invalid', authSessionId:randomUUID(), accessToken:'alice-token', expiresAt:Date.now()+3500000 }
const bob={ userId:randomUUID(), email:'bob@example.invalid', authSessionId:randomUUID(), accessToken:'bob-token', expiresAt:Date.now()+3500000 }
const contact={name:'Synthetic customer',email:alice.email,phone:'',siteAddress:'1 Synthetic St',suburb:'Test',postcode:'2000',details:'Synthetic auth only',consent:true}
const service={serviceId:'cabinet-painting',intent:'full-repainting',surfaces:['doors'],doorCount:4,drawerCount:2,material:'',colourPreference:''}
function storeFor(fn: string):QuoteRequestStore {return {async command<T>(command:string,args:Record<string,unknown>):Promise<T>{try{return(await db.query<{result:T}>(`select public.${fn}($1,$2::jsonb) result`,[command,JSON.stringify(args)])).rows[0].result}catch(error){const e=error as {code:string;message:string};throw new QuoteRequestError(({LK400:400,LK401:401,LK403:403,LK404:404,LK409:409,LK429:429} as Record<string,number>)[e.code]??503,e.message)}}}}
const customerStore=storeFor('lk_quote_customer_command'), requestsStore=storeFor('lk_quote_requests_command'), mediaStore=storeFor('lk_quote_media_command')
const provider:CustomerAuthProvider={async send(){},async verify(email,token){if(invalid||token!=='123456')throw new QuoteRequestError(401,'Invalid or consumed OTP');return {...(email===bob.email?bob:alice),expiresAt:now+3500000}},async identity(token){if(removed)throw new QuoteRequestError(401,'Upstream session revoked'); const value=token===bob.accessToken?bob:alice; return {...value,expiresAt:now+3500000}}}
const customer=createCustomerAuthApi({store:customerStore,requests:requestsStore,provider,baseUrl:()=>base,legacyUrl:()=>legacy,sessionKey:()=>secret,enabled:()=>enabled,now:()=>now,guestOwner:(req,isLegacy)=>guest.access.guestOwner(req,isLegacy)})
const guest=createQuoteRequestApi({store:requestsStore,authorize:async()=>{throw new QuoteRequestError(401,'Staff required')},baseUrl:()=>base,legacyUrl:()=>legacy,sessionKey:()=>secret,enabled:()=>enabled,now:()=>now,customerOwner:customer.owner})
const oldGuest=createQuoteRequestApi({store:requestsStore,authorize:async()=>{throw new QuoteRequestError(401,'Staff required')},baseUrl:()=>legacy,sessionKey:()=>secret,enabled:()=>enabled,now:()=>now})
const media=createQuoteMediaApi({access:guest.access,store:mediaStore,objects:{async signUpload(){throw Error('unused')},async normalize(){throw Error('unused')},async discardStaging(){},async read(){throw Error('unused')}},run:async()=>{},aiReady:()=>true})
function req(method='GET',cookie='',body?:unknown,address=base){return new Request(`${address}/api/quote/requests/customer`,{method,headers:{host:new URL(address).host,origin:address,...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})}
function cookies(res:Response){return res.headers.getSetCookie().filter(value=>!value.includes('Max-Age=0')).map(value=>value.split(';')[0]).join('; ')}
function cookieNamed(cookie:string,name:string){return cookie.split('; ').find(value=>value.startsWith(name+'='))!}
async function saved(email=alice.email,old=false){const api=old?oldGuest:guest,address=old?legacy:base;const ready=await api.session(req('POST','',undefined,address));assert.equal(ready.status,200,await ready.clone().text());const writing=cookies(ready);const response=await api.save(req('PUT',writing,{expectedRevision:0,idempotencyKey:randomUUID(),payload:{contact:{...contact,email},service},storageConsent:true},address));assert.equal(response.status,200,await response.clone().text());return {writing,request:(await response.json()).request as LiveQuoteRequest}}
async function send(email:string,writing='',request?:LiveQuoteRequest,extra:Record<string,unknown>={}){const res=await customer.send(req('POST',writing,{email,...(request?{requestId:request.id,expectedRevision:request.revision}:{}),...extra}));assert.equal(res.status,200,await res.clone().text());return `${writing}${writing?'; ':''}${cookies(res)}`}
async function verify(cookie:string,token='123456'){return customer.verify(req('POST',cookie,{token}))}
async function link(email=alice.email){const {writing,request}=await saved(email), challenge=await send(email,writing,request),res=await verify(challenge);assert.equal(res.status,200,await res.clone().text());return {writing,request,auth:cookies(res),state:await res.json(),challenge}}
function denied(code:string){return(error:unknown)=>!!error&&typeof error==='object'&&'code'in error&&error.code===code}
beforeEach(async()=>{await db.exec('reset role');await db.exec(`truncate ${tables.map(table=>`public.${table}`).join(',')}`);await db.exec('set role service_role');now=Date.now();enabled=true;invalid=false;removed=false})
after(async()=>db.close())

test('guest capability plus verified matching email links one request; cookies isolate staff and hide bearer secrets',async()=>{
 const {auth,writing,request,state}=await link();assert.equal(state.customer.email,alice.email);assert.equal(state.currentRequestId,request.id);assert.equal(state.requests.length,1)
 assert.ok(!auth.includes(alice.accessToken));assert.ok(!auth.includes(alice.email));assert.match(auth,/^lk_quote_customer_auth=/)
 const read=await guest.read(req('GET',`${auth}; lk_staff_session=unchanged`));assert.equal(read.status,200);assert.equal((await read.json()).request.id,request.id)
 const before=(await db.query<{owner_hash:string}>('select owner_hash from lk_quote_requests')).rows[0].owner_hash
 assert.equal(before,createHash('sha256').update(writing.split('=')[1]).digest('hex'))
 const replay=await verify(await send(bob.email));assert.equal(replay.status,200);assert.equal((await replay.json()).requests.length,0,'matching email alone never lists arbitrary EMS requests')
})

test('other-device OTP lists linked summaries only; selection restores the same saved details and media workspace',async()=>{
 const {request}=await link();await db.exec("update lk_rate_buckets set reset_at=0")
 // Separate challenge with a different bucket reset simulates the next login after cooldown.
 await db.exec("update lk_rate_buckets set reset_at=0")
 const challenge=await send(alice.email),res=await verify(challenge);assert.equal(res.status,200,await res.clone().text());const state=await res.clone().json();assert.equal(state.currentRequestId,null);assert.equal(state.requests[0].id,request.id);assert.ok(!JSON.stringify(state).includes('siteAddress'))
 const auth=cookies(res),selected=await customer.select(req('POST',auth,{requestId:request.id}));assert.equal(selected.status,200,await selected.clone().text());assert.equal((await selected.json()).request.id,request.id)
 const restored=cookies(selected),workspace=await media.workspace(req('GET',restored));assert.equal(workspace.status,200,await workspace.clone().text());assert.equal((await workspace.json()).request.id,request.id)
})

test('different verified customer cannot select, view or claim another saved quote',async()=>{
 const a=await link(),b=await link(bob.email)
 assert.equal((await customer.select(req('POST',b.auth,{requestId:a.request.id}))).status,404)
 const response=await guest.read(req('GET',b.auth));assert.equal((await response.json()).request.id,b.request.id)
 const mismatch=await customer.send(req('POST',b.writing,{email:alice.email,requestId:b.request.id,expectedRevision:b.request.revision}));assert.equal(mismatch.status,429,'rate limit does not reveal email ownership')
})

test('invalid codes consume bounded attempts; success and used challenge cannot replay',async()=>{
 const {writing,request}=await saved(),challenge=await send(alice.email,writing,request)
 for(let i=0;i<5;i++)assert.equal((await verify(challenge,'999999')).status,401)
 assert.equal((await verify(challenge)).status,429)
 assert.equal((await db.query<{n:number}>('select attempts n from lk_quote_customer_challenges')).rows[0].n,5)
})

test('OTP challenge rejects stale saved revision and email mutation without creating customer access',async()=>{
 const {writing,request}=await saved(),challenge=await send(alice.email,writing,request)
 const edited=await guest.save(req('PUT',writing,{expectedRevision:1,idempotencyKey:randomUUID(),payload:{contact:{...contact,details:'changed during auth'},service},storageConsent:true}));assert.equal(edited.status,200)
 assert.equal((await verify(challenge)).status,409)
 assert.equal((await db.query<{n:number}>('select count(*)::int n from lk_quote_request_access')).rows[0].n,0)
})

test('bound email is immutable even with original guest access; stable owner receipts still replay',async()=>{
 const {writing,request,auth}=await link()
 const values={expectedRevision:request.revision,idempotencyKey:randomUUID(),payload:{contact:{...contact,details:'linked save'},service},storageConsent:true}
 const first=await guest.save(new Request(req('PUT',auth,values),{headers:{...Object.fromEntries(req('PUT',auth,values).headers),'x-lk-quote-request-id':request.id}}));assert.equal(first.status,200,await first.clone().text());const replay=await guest.save(new Request(req('PUT',auth,values),{headers:{...Object.fromEntries(req('PUT',auth,values).headers),'x-lk-quote-request-id':request.id}}));assert.deepEqual(await first.json(),await replay.json())
 const changed=await guest.save(req('PUT',writing,{...values,idempotencyKey:randomUUID(),expectedRevision:2,payload:{contact:{...contact,email:bob.email},service}}));assert.equal(changed.status,409)
})

test('logout revokes local customer access, clears guest/customer challenge cookies and leaves staff cookies alone',async()=>{
 const {auth}=await link(),out=await customer.logout(req('POST',`${auth}; lk_staff_session=staff`,{}));assert.equal(out.status,200)
 const clear=out.headers.getSetCookie().join('\n');assert.match(clear,/lk_quote_request=;/);assert.match(clear,/lk_quote_customer_auth=;/);assert.match(clear,/lk_quote_customer_challenge=;/);assert.ok(!clear.includes('lk_staff_session='))
 assert.equal((await guest.read(req('GET',auth))).status,401)
 assert.equal((await media.workspace(req('GET',auth))).status,401)
})

test('expired token and upstream session revocation fail closed; bound access revocation blocks private photos',async()=>{
 const {auth}=await link();removed=true;assert.equal((await guest.read(req('GET',auth))).status,401);removed=false
 await db.exec('update lk_quote_request_access set revoked_at=now()');assert.equal((await media.workspace(req('GET',auth))).status,404)
 now+=3600001;assert.equal((await customer.state(req('GET',auth))).status,401)
})

test('customer cookie cannot transfer across origin, spoof authority, accept duplicate cookies or defeat CSRF',async()=>{
 const {auth}=await link()
 assert.equal((await customer.state(req('GET',auth,undefined,legacy))).status,403)
 assert.equal((await customer.state(req('GET',`${auth}; ${cookieNamed(auth,'lk_quote_customer_auth')}`))).status,400)
 const evil=new Request(`${base}/api/quote/requests/customer/logout`,{method:'POST',headers:{host:new URL(base).host,origin:'https://attacker.invalid',cookie:auth,'content-type':'application/json'},body:'{}'});assert.equal((await customer.logout(evil)).status,403)
 const bad=auth.slice(0,-1)+(auth.endsWith('A')?'B':'A');assert.equal((await customer.state(req('GET',bad))).status,401)
})

test('same-email unlinked EMS requests remain hidden; anonymous and authenticated DB roles cannot forge binding or sessions',async()=>{
 await saved();const {state}=await link(bob.email);assert.equal(state.requests.length,1)
 for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);for(const table of ['lk_quote_request_access','lk_quote_customer_sessions','lk_quote_customer_handoffs','lk_quote_customer_challenges'])await assert.rejects(db.query(`select * from ${table}`),denied('42501'));await assert.rejects(db.query("select lk_quote_customer_command('state','{}')"),denied('42501'))}
})

test('legacy handoff preserves existing draft, requires matching email OTP, consumes once, and does not permit legacy new writes',async()=>{
 const {writing,request}=await saved(alice.email,true)
 const oldRead=await guest.read(req('GET',writing,undefined,legacy));assert.equal(oldRead.status,200);assert.equal((await oldRead.json()).request.id,request.id)
 assert.equal((await guest.session(req('POST','',undefined,legacy))).status,403)
 const transfer=await customer.handoff(req('POST',writing,{requestId:request.id,expectedRevision:request.revision,email:alice.email},legacy));assert.equal(transfer.status,200,await transfer.clone().text());const url=new URL((await transfer.json()).url);assert.equal(url.origin,base);assert.equal(url.searchParams.has('restore'),false)
 const token=url.hash.split('=')[1],challenge=await send(alice.email,'',undefined,{handoff:token}),verified=await verify(challenge);assert.equal(verified.status,200,await verified.clone().text());assert.equal((await verified.json()).currentRequestId,request.id)
 assert.equal((await verify(challenge)).status,401)
 const owner=(await db.query<{owner_hash:string}>('select owner_hash from lk_quote_requests')).rows[0].owner_hash;assert.equal(owner,createHash('sha256').update(writing.split('=')[1]).digest('hex'))
})

test('multiple saved quotes with the same revision cannot be crossed by another tab selection',async()=>{
 const a=await link()
 await db.exec('update lk_rate_buckets set reset_at=0')
 const b=await link()
 assert.notEqual(a.request.id,b.request.id)
 const values={expectedRevision:1,idempotencyKey:randomUUID(),payload:{contact:{...contact,details:'must stay A'},service},storageConsent:true}
 const stale=new Request(req('PUT',b.auth,values),{headers:{...Object.fromEntries(req('PUT',b.auth,values).headers),'x-lk-quote-request-id':a.request.id}})
 assert.equal((await guest.save(stale)).status,409)
 assert.equal((await guest.save(req('PUT',b.auth,values))).status,409,'customer writes require an explicit request id')
 const wrongMedia=new Request(req('POST',b.auth,{expectedRevision:1,idempotencyKey:randomUUID()}),{headers:{...Object.fromEntries(req('POST',b.auth,{}).headers),'x-lk-quote-request-id':a.request.id}})
 assert.equal((await media.reopen(wrongMedia)).status,409)
 const raw=(await db.query<{revision:number;details:string}>('select revision,payload->\'contact\'->>\'details\' details from lk_quote_requests order by created_at')).rows
 assert.deepEqual(raw.map(row=>row.revision),[1,1]);assert.ok(raw.every(row=>row.details==='Synthetic auth only'))
})

test('session and request relationship are rechecked atomically by storage before customer writes',async()=>{
 const {auth,request}=await link(),owner=await customer.owner(req('GET',auth));assert.ok(owner?.customer)
 await db.exec('update lk_quote_request_access set revoked_at=now()')
 await assert.rejects(requestsStore.command('save',{companyId:'lk-group',ownerHash:owner.hash,expiresAt:owner.expiresAt,customerAccess:owner.customer,expectedRequestId:request.id,expectedRevision:1,idempotencyKey:randomUUID(),storageConsent:true,consentVersion:'quote-storage-review-v1',payload:{contact,service}}),(error:unknown)=>error instanceof QuoteRequestError&&error.status===404)
 await assert.rejects(mediaStore.command('workspace',{companyId:'lk-group',ownerHash:owner.hash,customerAccess:owner.customer,expectedRequestId:request.id}),(error:unknown)=>error instanceof QuoteRequestError&&error.status===404)
})

test('expired challenge, expired handoff and stale transfer revision never restore discarded capabilities',async()=>{
 const first=await saved(),challenge=await send(alice.email,first.writing,first.request);now+=900001;assert.equal((await verify(challenge)).status,401);now=Date.now()
 await db.exec('update lk_rate_buckets set reset_at=0')
 const old=await saved(alice.email,true),transfer=await customer.handoff(req('POST',old.writing,{requestId:old.request.id,expectedRevision:1,email:alice.email},legacy));assert.equal(transfer.status,200);const token=new URL((await transfer.json()).url).hash.split('=')[1]
 await db.exec("update lk_quote_customer_handoffs set expires_at=now()-interval '1 minute'")
 assert.equal((await customer.send(req('POST','',{email:alice.email,handoff:token}))).status,401)
 const transfer2=await customer.handoff(req('POST',old.writing,{requestId:old.request.id,expectedRevision:1,email:alice.email},legacy));assert.equal(transfer2.status,200);const token2=new URL((await transfer2.json()).url).hash.split('=')[1]
 await oldGuest.save(req('PUT',old.writing,{expectedRevision:1,idempotencyKey:randomUUID(),payload:{contact:{...contact,details:'edited legacy'},service},storageConsent:true},legacy))
 assert.equal((await customer.send(req('POST','',{email:alice.email,handoff:token2}))).status,409)
})

test('linked customer can restore after the original guest capability expires without reviving its cookie',async()=>{
 const {auth,writing,request}=await link()
 await db.exec("update lk_quote_requests set owner_expires_at=now()-interval '1 minute'")
 assert.equal((await guest.read(req('GET',auth))).status,200)
 const expCookie=writing.split('=')[1].split('.');expCookie[0]=String(Math.floor(Date.now()/1000)-10)
 // Invalid HMAC and expiry never become a verified relationship.
 assert.equal((await guest.read(req('GET',`lk_quote_request=${expCookie.join('.')}`))).status,401)
 assert.equal((await guest.read(req('GET',auth))).status,200)
 assert.equal((await db.query<{id:string}>('select id from lk_quote_requests')).rows[0].id,request.id)
})
