import test,{beforeEach,after} from 'node:test'
import assert from 'node:assert/strict'
import {createHash,randomUUID} from 'node:crypto'
import {readFileSync,readdirSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {DEMO_PRICE,DEMO_TERMS,DEMO_VERSION} from '../enquiries/domain/demo-submission.ts'
import type {BookingDetail,BookingEmailWork,BookingProposalSnapshot,BookingSegment} from './domain/contracts.ts'
import {validateSegments} from './domain/validation.ts'
Object.assign(process.env,{OPERATIONS_STORE:'supabase',APP_BASE_URL:'http://127.0.0.1:3002',LOCAL_OPERATIONS_ENABLED:'true',QUOTE_DEMO_ENABLED:'true',QUOTE_DEMO_RECIPIENT_EMAIL:'lnkgroupsydney@gmail.com',NEXT_PUBLIC_SUPABASE_URL:'https://booking-pglite.invalid',SUPABASE_SECRET_KEY:'synthetic',GOOGLE_TOKEN_ENCRYPTION_KEY:'66'.repeat(32),GOOGLE_CLIENT_ID:'synthetic',GOOGLE_CLIENT_SECRET:'synthetic'})
const db=new PGlite()
await db.exec('create role anon;create role authenticated;create role service_role bypassrls;')
for(const name of readdirSync(new URL('../../../supabase/migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(`../../../supabase/migrations/${name}`,import.meta.url),'utf8'))
const tables=(await db.query<{tablename:string}>("select tablename from pg_tables where schemaname='public' and tablename like 'lk_%'")).rows.map(x=>x.tablename)
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex')
const originalFetch=globalThis.fetch
let events:unknown[]=[],googleFailure=false,providerCalls=0
const tasks:(()=>Promise<void>)[]=[]
globalThis.fetch=async(input,init)=>{
 const request=new Request(input,init),url=new URL(request.url)
 if(url.origin==='https://www.googleapis.com'){assert.equal(request.method,'GET');providerCalls++;return googleFailure?Response.json({error:'PRIVATE_PROVIDER_ERROR'},{status:503}):Response.json({accessRole:'owner',items:events})}
 assert.equal(url.origin,'https://booking-pglite.invalid','Unexpected external call')
 if(url.pathname==='/rest/v1/lk_quote_submissions'||url.pathname==='/rest/v1/lk_booking_proposals'){
  const table=url.pathname.split('/').at(-1)!,id=url.searchParams.get('id')?.replace(/^eq\./,''),bookingId=url.searchParams.get('booking_id')?.replace(/^eq\./,''),owner=url.searchParams.get('owner_hash')?.replace(/^eq\./,'')
  const row=(await db.query<{snapshot_hash:string;email_payload:unknown}>(`select snapshot_hash,email_payload from public.${table} where id=$1${bookingId?' and booking_id=$2':owner?' and owner_hash=$2':''}`,[id,...(bookingId?[bookingId]:owner?[owner]:[])])).rows[0]
  return Response.json(row??{code:'PGRST116'},{status:row?200:406})
 }
 if(url.pathname==='/rest/v1/lk_bookings'){
  const id=url.searchParams.get('id')?.replace(/^eq\./,'');const row=(await db.query('select calendar_id from public.lk_bookings where id=$1',[id])).rows[0]
  return Response.json(row??{code:'PGRST116'},{status:row?200:406})
 }
 const name=url.pathname.split('/').at(-1)!
 assert.ok(['lk_booking_command','lk_booking_calendar','lk_quote_draft','lk_operations_command','lk_google_health'].includes(name))
 const body=await request.json() as {command:string;args:Record<string,unknown>}
 try{return Response.json((await db.query<{r:unknown}>(`select public.${name}($1,$2::jsonb) r`,[body.command,JSON.stringify(body.args)])).rows[0].r)}catch(e){const error=e as {code:string;message:string};return Response.json({code:error.code,message:error.message},{status:400})}
}
const {encrypt}=await import('../operations/infrastructure/auth.ts')
const {draftSessionPost}=await import('../enquiries/infrastructure/quote-draft-api.ts')
const api=await import('./infrastructure/api.ts')
const adminToken='synthetic-admin-session',adminCookie=`lk_ops_session=${adminToken}`
beforeEach(async()=>{
 await db.exec('reset role');await db.exec(`truncate ${tables.map(x=>`public.${x}`).join(',')}`)
 await db.query("insert into public.lk_google_connection(id,account_sub,email,access_cipher,expires_at,selected_calendar_id) values(1,'synthetic-company','lnkgroupsydney@gmail.com',$1,$2,'test-calendar')",[encrypt('synthetic-token'),Date.now()+3600000])
 await db.query("insert into public.lk_sessions values($1,'google','synthetic-company',$2)",[createHash('sha256').update(adminToken).digest('hex'),Date.now()+3600000])
 await db.exec('set role service_role');events=[];googleFailure=false;providerCalls=0;tasks.length=0;process.env.QUOTE_DEMO_ENABLED='true'
})
after(async()=>{globalThis.fetch=originalFetch;await db.close()})
async function rpc<T=BookingDetail>(command:string,args:Record<string,unknown>={}):Promise<T>{return(await db.query<{r:T}>('select public.lk_booking_command($1,$2::jsonb) r',[command,JSON.stringify(args)])).rows[0].r}
const code=(value:string)=>(error:unknown)=>!!error&&typeof error==='object'&&'code'in error&&error.code===value
const signature={name:'Synthetic signer',acknowledged:true,strokes:[[{x:.1,y:.1},{x:.2,y:.4},{x:.4,y:.2},{x:.7,y:.5}]]}
const epoch=Math.floor(Date.now()/1000)*1000+10*86400000
const segments:BookingSegment[]=[{id:'segment-1',startAt:new Date(epoch).toISOString(),endAt:new Date(epoch+3600000).toISOString()},{id:'segment-2',startAt:new Date(epoch+3*86400000).toISOString(),endAt:new Date(epoch+3*86400000+3600000).toISOString()}]
function req(path:string,method='GET',cookie=adminCookie,body?:unknown,origin='http://127.0.0.1:3002'){return new Request(`http://127.0.0.1:3002/api/${path}`,{method,headers:{origin,cookie,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})}
async function fixture(){
 const cookie=(await draftSessionPost(req('quote/draft/session','POST',''))).headers.get('set-cookie')!.split(';')[0]
 const owner=createHash('sha256').update(cookie.slice(cookie.indexOf('=')+1)).digest('hex'),id=randomUUID(),draftId=randomUUID()
 const payload={contact:{name:'Synthetic client',email:'lnkgroupsydney@gmail.com',phone:'',siteAddress:'TEST ONLY',suburb:'Test',postcode:'2000',details:'Synthetic only',consent:true},service:{serviceId:'cabinet-painting',intent:'full-repainting',surfaces:['doors'],doorCount:4,drawerCount:null,material:'',colourPreference:''}}
 const snapshot={mode:'demo',version:DEMO_VERSION,draftId,draftRevision:1,payload,preferredDate:segments[0].startAt.slice(0,10),price:DEMO_PRICE,terms:DEMO_TERMS}
 await db.query('insert into public.lk_quote_drafts(id,owner_hash,payload,payload_hash,expires_at) values($1,$2,$3,$4,now()+interval \'1 hour\')',[draftId,owner,JSON.stringify(payload),hash(payload)])
 await db.query("insert into public.lk_quote_submissions(id,draft_id,owner_hash,idempotency_key,request_hash,reference,snapshot,snapshot_hash,signature,calendar_id,email_status,email_provider_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'test-calendar','provider_accepted','original-mail')",[id,draftId,owner,randomUUID(),hash(id),`DEMO-${id.slice(0,8).toUpperCase()}`,JSON.stringify(snapshot),hash(snapshot),JSON.stringify(signature)])
 return {id,cookie,owner,snapshot}
}
async function propose(f:Awaited<ReturnType<typeof fixture>>,chosen=segments,expected=0,key=randomUUID()){
 const original=await rpc('admin_detail',{id:f.id}),pId=randomUUID(),pRevision=original.proposals.length+1
 const snapshot:BookingProposalSnapshot={mode:'demo',version:'booking-demo-v1',submissionId:f.id,reference:original.submission.reference,submission:original.submission.snapshot,proposalId:pId,proposalRevision:pRevision,resource:'demo-single-resource',segments:chosen,notes:'Synthetic work proposal'}
 const args={id:f.id,proposal_id:pId,expected_revision:expected,key,request_hash:hash({chosen,expected}),snapshot,snapshot_hash:hash(snapshot),actor_hash:hash('admin')}
 const detail=await rpc('proposal_create',args);return {detail,args,p:detail.proposals[0]}
}
async function consent(f:Awaited<ReturnType<typeof fixture>>,p:BookingDetail['proposals'][number],key=randomUUID()){
 return rpc('consent',{owner_hash:f.owner,proposal_id:p.id,snapshot_hash:p.snapshotHash,key,request_hash:hash({id:p.id,signature}),signature})
}
async function accepted(f:Awaited<ReturnType<typeof fixture>>,chosen=segments,expected=0){
 const proposed=await propose(f,chosen,expected);await consent(f,proposed.p)
 const holder='synthetic-booking-delivery',work=(await rpc<BookingEmailWork[]>('email_claim',{holder,id:proposed.p.id}))[0]
 const base={id:work.id,holder,generation:work.lease_generation}
 await rpc('email_attempt',{...base,payload:{from:'onboarding@resend.dev',to:['lnkgroupsydney@gmail.com'],subject:'DEMO',text:'TEST ONLY'}})
 await rpc('email_accepted',{...base,provider_id:'synthetic-provider-id'})
 return {...proposed,detail:await rpc('admin_detail',{id:f.id})}
}
const confirmArgs=(id:string,pId:string,revision:number)=>({id,proposal_id:pId,expected_revision:revision,key:randomUUID(),request_hash:hash(pId),checked_at:new Date().toISOString(),calendar_id:'test-calendar'})
async function count(table:string){assert.ok(tables.includes(table));return(await db.query<{n:number}>(`select count(*)::int n from public.${table}`)).rows[0].n}

test('original signed submission is preserved and only owner sees its detail',async()=>{
 const a=await fixture(),b=await fixture();const original=await rpc('admin_detail',{id:a.id});await propose(a)
 const detail=await rpc('customer_detail',{owner_hash:a.owner})
 assert.deepEqual(detail.submission,original.submission);assert.equal(detail.proposals.length,1)
 assert.equal((await rpc('customer_detail',{owner_hash:b.owner})).submission.id,b.id)
 assert.equal(await rpc('customer_detail',{owner_hash:hash('foreign')}),null)
 assert.equal(JSON.stringify(detail).includes(a.owner),false)
 const list=await rpc<{id:string}[]>('admin_list');assert.equal(list.length,2)
})
test('proposal revision, exact retry and immutable evidence block stale overwrite',async()=>{
 const f=await fixture(),a=await propose(f)
 assert.deepEqual(await rpc('proposal_create',a.args),a.detail)
 await assert.rejects(propose(f,segments,0),code('LK409'))
 await assert.rejects(db.query("update public.lk_booking_proposals set notes='changed' where id=$1",[a.p.id]),code('LK409'))
 const b=await propose(f,segments,1)
 await assert.rejects(consent(f,a.p),code('LK409'))
 assert.equal(b.detail.proposals.length,2);assert.equal(b.detail.booking.pendingProposalId,b.p.id)
})
test('owner consent is version-bound; unsigned or unmailed work cannot be confirmed',async()=>{
 const f=await fixture(),other=await fixture(),a=await propose(f)
 await assert.rejects(consent(other,a.p),code('LK404'))
 await assert.rejects(rpc('consent',{owner_hash:f.owner,proposal_id:a.p.id,snapshot_hash:hash('wrong'),key:randomUUID(),request_hash:hash(signature),signature}),code('LK409'))
 await assert.rejects(rpc('confirm',confirmArgs(f.id,a.p.id,1)),code('LK409'))
 const after=await consent(f,a.p);assert.equal(after.proposals[0].signature?.name,signature.name)
 await assert.rejects(rpc('confirm',confirmArgs(f.id,a.p.id,2)),code('LK409'))
 assert.equal(await count('lk_booking_segments'),0);assert.equal(await count('lk_booking_outbox'),0)
})
test('email work is claimed only after consent, fenced and frozen; acceptance does not automatically confirm',async()=>{
 const f=await fixture(),a=await propose(f),holder='synthetic-booking-delivery'
 assert.deepEqual(await rpc('email_claim',{holder}),[])
 await consent(f,a.p)
 const work=(await rpc<BookingEmailWork[]>('email_claim',{holder}))[0],base={id:work.id,holder,generation:work.lease_generation}
 assert.deepEqual(await rpc('email_claim',{holder:'second-synthetic-worker'}),[])
 await assert.rejects(rpc('email_attempt',{...base,generation:0,payload:{text:'test'}}),code('LK409'))
 const first=await rpc<BookingEmailWork>('email_attempt',{...base,payload:{text:'test'}});assert.deepEqual(first.email_payload,{text:'test'})
 await assert.rejects(rpc('email_attempt',{...base,payload:{text:'changed'}}),code('LK409'))
 assert.deepEqual(await rpc('email_accepted',{...base,provider_id:'mail'}),{emailStatus:'provider_accepted'})
 assert.equal((await rpc('admin_detail',{id:f.id})).booking.status,'requested')
 assert.equal(await count('lk_booking_outbox'),0)
})
test('full work segments reserve atomically with one outbox; repeated confirmation never duplicates',async()=>{
 const f=await fixture(),a=await accepted(f),args=confirmArgs(f.id,a.p.id,a.detail.booking.revision)
 const confirmed=await rpc('confirm',args)
 assert.equal(confirmed.booking.status,'confirmed');assert.equal(confirmed.booking.syncStatus,'pending')
 assert.equal(await count('lk_booking_segments'),2);assert.equal(await count('lk_booking_outbox'),1)
 assert.deepEqual(await rpc('confirm',args),confirmed)
 await assert.rejects(rpc('confirm',{...args,key:randomUUID()}),code('LK409'))
 const busy=await rpc<unknown[]>('occupancy',{start_at:segments[0].startAt,end_at:segments[1].endAt});assert.equal(busy.length,2)
})
test('two overlapping confirmations cannot both reserve the single resource; gaps remain usable',async()=>{
 const first=await fixture(),second=await fixture(),a=await accepted(first),b=await accepted(second)
 const results=await Promise.allSettled([rpc('confirm',confirmArgs(first.id,a.p.id,a.detail.booking.revision)),rpc('confirm',confirmArgs(second.id,b.p.id,b.detail.booking.revision))])
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected').length,1)
 assert.equal(await count('lk_booking_segments'),2);assert.equal(await count('lk_booking_outbox'),1)
 const third=await fixture(),between=[{id:'segment-1',startAt:new Date(epoch+86400000).toISOString(),endAt:new Date(epoch+86400000+3600000).toISOString()}],c=await accepted(third,between)
 await rpc('confirm',confirmArgs(third.id,c.p.id,c.detail.booking.revision));assert.equal(await count('lk_booking_segments'),3)
})
test('stale Google check, changed target and overlaps preserve an existing confirmed schedule',async()=>{
 const f=await fixture(),a=await accepted(f)
 await assert.rejects(rpc('confirm',{...confirmArgs(f.id,a.p.id,2),checked_at:new Date(Date.now()-31000).toISOString()}),code('LK409'))
 await assert.rejects(rpc('confirm',{...confirmArgs(f.id,a.p.id,2),calendar_id:'foreign'}),code('LK409'))
 await rpc('confirm',confirmArgs(f.id,a.p.id,2));await db.query("update public.lk_bookings set sync_status='synced',confirmed_proposal_id=pending_proposal_id,confirmed_at=now() where id=$1",[f.id])
 const other=await fixture(),otherSegments=[{id:'segment-1',startAt:new Date(epoch+6*86400000).toISOString(),endAt:new Date(epoch+6*86400000+3600000).toISOString()}],b=await accepted(other,otherSegments);await rpc('confirm',confirmArgs(other.id,b.p.id,2))
 const replacement=await accepted(f,otherSegments,3)
 await assert.rejects(rpc('confirm',confirmArgs(f.id,replacement.p.id,replacement.detail.booking.revision)),code('LK409'))
 const preserved=await db.query<{start_at:Date}>('select start_at from public.lk_booking_segments where booking_id=$1 order by start_at',[f.id]);assert.equal(preserved.rows.length,2)
 assert.equal((await rpc('admin_detail',{id:f.id})).booking.confirmedProposalId,a.p.id)
})
test('public roles cannot read signatures, update occupancy or invoke privileged booking functions',async()=>{
 const f=await fixture();await propose(f)
 for(const role of ['anon','authenticated']){
  await db.exec(`reset role;set role ${role}`)
  await assert.rejects(db.exec('select * from public.lk_booking_proposals'),code('42501'))
  await assert.rejects(db.exec('delete from public.lk_booking_segments'),code('42501'))
  await assert.rejects(rpc('admin_detail',{id:f.id}),code('42501'))
  await assert.rejects(db.query('select public.lk_booking_detail($1)',[f.id]),code('42501'))
 }
})
test('API protects admin details/documents, foreign customer session, origin and explicit demo gate',async()=>{
 const f=await fixture(),foreign=await fixture()
 assert.equal((await api.adminBookingGet(req('operations/bookings','GET',''),f.id)).status,401)
 assert.equal((await api.bookingDocumentGet(req('operations/bookings','GET',''),{admin:true,id:f.id,kind:'quote'})).status,401)
 const data=await (await api.customerBookingGet(req('quote/booking','GET',foreign.cookie))).json() as {detail:BookingDetail};assert.equal(data.detail.submission.id,foreign.id)
 assert.equal((await api.proposalPost(req('operations/bookings','POST',adminCookie,{},'https://attacker.invalid'),f.id)).status,403)
 process.env.QUOTE_DEMO_ENABLED='false';assert.equal((await api.adminBookingsGet(req('operations/bookings'))).status,404)
})
test('API accepts Sydney work segments and binds a new signature before company email and confirmation',async()=>{
 const f=await fixture()
 const response=await api.proposalPost(req('operations/bookings','POST',adminCookie,{expectedRevision:0,idempotencyKey:randomUUID(),notes:'Test only',segments:[{startLocal:'2099-10-10T09:00',endLocal:'2099-10-10T12:00'}]}),f.id)
 assert.equal(response.status,201,await response.clone().text());const {detail}=await response.json() as {detail:BookingDetail};assert.equal(detail.proposals[0].segments[0].startAt,'2099-10-09T22:00:00.000Z')
 const p=detail.proposals[0]
 const consented=await api.consentPost(req('quote/booking/consent','POST',f.cookie,{proposalId:p.id,snapshotHash:p.snapshotHash,idempotencyKey:randomUUID(),signature}),task=>tasks.push(task))
 assert.equal(consented.status,202);assert.equal(tasks.length,1)
 const result=await api.confirmPost(req('operations/bookings','POST',adminCookie,{expectedRevision:2,proposalId:p.id,idempotencyKey:randomUUID()}),f.id,task=>tasks.push(task))
 assert.equal(result.status,409);assert.equal(providerCalls,0)
})
test('API fresh whole-period Google check blocks a busy middle visit and never leaks event details',async()=>{
 const f=await fixture(),a=await accepted(f)
 events=[{id:'private-busy',status:'confirmed',summary:'PRIVATE_CUSTOMER',start:{dateTime:segments[1].startAt},end:{dateTime:segments[1].endAt}}]
 const response=await api.confirmPost(req('operations/bookings','POST',adminCookie,{expectedRevision:2,proposalId:a.p.id,idempotencyKey:randomUUID()}),f.id,task=>tasks.push(task))
 assert.equal(response.status,409,await response.clone().text());assert.equal((await response.text()).includes('PRIVATE_CUSTOMER'),false)
 assert.equal(await count('lk_booking_segments'),0);assert.equal(tasks.length,0)
})
test('API confirmation response-loss replay uses original command without Google or extra occupancy',async()=>{
 const f=await fixture(),a=await accepted(f),body={expectedRevision:2,proposalId:a.p.id,idempotencyKey:randomUUID()}
 const response=await api.confirmPost(req('operations/bookings','POST',adminCookie,body),f.id,task=>tasks.push(task))
 assert.equal(response.status,202,await response.clone().text());const result=await response.json();googleFailure=true;const before=providerCalls
 const replay=await api.confirmPost(req('operations/bookings','POST',adminCookie,body),f.id,task=>tasks.push(task))
 assert.equal(replay.status,202);assert.deepEqual(await replay.json(),result);assert.equal(providerCalls,before)
 assert.equal(await count('lk_booking_segments'),2);assert.equal(await count('lk_booking_outbox'),1)
})
test('time validation rejects missing timezone, overlap, reverse and past intervals',()=>{
 assert.equal(validateSegments(segments).length,2)
 for(const invalid of [[{startAt:'2099-02-30T09:00:00Z',endAt:'2099-03-01T10:00:00Z'}],[{startAt:'2099-03-01T24:00:00Z',endAt:'2099-03-02T02:00:00Z'}],[],[{startAt:'2099-01-01T09:00',endAt:'2099-01-01T10:00'}],[{startAt:segments[0].endAt,endAt:segments[0].startAt}],[segments[0],segments[0]],[{startAt:'2000-01-01T00:00:00Z',endAt:'2000-01-01T01:00:00Z'}]])assert.throws(()=>validateSegments(invalid))
})

test('rebooking retains the union of old and new occupied spans until Calendar readback readiness',async()=>{
 const f=await fixture(),first=await accepted(f)
 await rpc('confirm',confirmArgs(f.id,first.p.id,2))
 await db.query("update public.lk_bookings set sync_status='synced',confirmed_proposal_id=pending_proposal_id,confirmed_at=now() where id=$1",[f.id])
 const revised=[{id:'segment-1',startAt:new Date(epoch+1800000).toISOString(),endAt:new Date(epoch+5400000).toISOString()},{id:'segment-2',startAt:new Date(epoch+7*86400000).toISOString(),endAt:new Date(epoch+7*86400000+3600000).toISOString()}]
 const next=await accepted(f,revised,3),result=await rpc('confirm',confirmArgs(f.id,next.p.id,next.detail.booking.revision))
 assert.equal(result.booking.confirmedProposalId,first.p.id);assert.equal(result.booking.pendingProposalId,next.p.id);assert.equal(result.booking.syncStatus,'pending')
 const spans=(await db.query<{start_at:string;end_at:string}>('select start_at,end_at from public.lk_booking_segments where booking_id=$1 order by start_at',[f.id])).rows
 assert.equal(spans.length,3)
 assert.equal(Date.parse(spans[0].start_at),Date.parse(segments[0].startAt));assert.equal(Date.parse(spans[0].end_at),Date.parse(revised[0].endAt))
 assert.equal(Date.parse(spans[1].start_at),Date.parse(segments[1].startAt))
 const another=await fixture(),conflicting=await accepted(another,[segments[1]])
 await assert.rejects(rpc('confirm',confirmArgs(another.id,conflicting.p.id,2)),code('LK409'))
})
test('a superseded proposal with an uncertain first email attempt remains recoverable without changing its payload',async()=>{
 const f=await fixture(),first=await propose(f);await consent(f,first.p)
 const holder='synthetic-booking-delivery',work=(await rpc<BookingEmailWork[]>('email_claim',{holder}))[0],base={id:work.id,holder,generation:work.lease_generation}
 await rpc('email_attempt',{...base,payload:{text:'Frozen original attempt'}})
 await rpc('email_failed',{...base,outcome:'retrying',error_code:'email_transient'})
 const newer=await propose(f,segments,2)
 await db.query("update public.lk_booking_proposals set retry_after=now()-interval '1 second' where id=$1",[first.p.id])
 const replay=(await rpc<BookingEmailWork[]>('email_claim',{holder,id:first.p.id}))[0]
 assert.equal(replay.id,first.p.id)
 const retry={id:replay.id,holder,generation:replay.lease_generation}
 assert.deepEqual((await rpc<BookingEmailWork>('email_attempt',{...retry,payload:{text:'Frozen original attempt'}})).email_payload,{text:'Frozen original attempt'})
 await rpc('email_accepted',{...retry,provider_id:'known-result'})
 assert.equal((await rpc('admin_detail',{id:f.id})).booking.pendingProposalId,newer.p.id)
 await assert.rejects(rpc('confirm',confirmArgs(f.id,first.p.id,3)),code('LK409'))
})

test('Calendar SQL keeps union holds until readback readiness, reconciles old deletion and rejects stale retire CAS',async()=>{
 const f=await fixture(),first=await accepted(f),holder='calendar-synthetic-worker'
 const calendar=async<T=boolean>(command:string,args:Record<string,unknown>={})=>(await db.query<{r:T}>('select public.lk_booking_calendar($1,$2::jsonb) r',[command,JSON.stringify({holder,calendar_id:'test-calendar',...args})])).rows[0].r
 const lease=async()=>db.query("select public.lk_operations_command('sync_acquire',$1::jsonb)",[JSON.stringify({holder})])
 await lease()
 const initial=await rpc('confirm',confirmArgs(f.id,first.p.id,2)),firstArgs={booking_id:f.id,proposal_id:first.p.id,revision:initial.booking.revision}
 assert.equal((await calendar<unknown[]>('calendar_pending')).length,1)
 const put=async(proposal:BookingDetail['proposals'][number],bookingRevision:number,segment:BookingSegment)=>calendar('link_put',{booking_id:f.id,proposal_id:proposal.id,revision:bookingRevision,event_id:`test-${proposal.id}-${segment.id}`,segment_id:segment.id,kind:'work',etag:`etag-${proposal.id}`,start_at:segment.startAt,end_at:segment.endAt})
 assert.equal(await calendar('calendar_ready',firstArgs),false)
 for(const segment of first.p.segments)assert.equal(await put(first.p,initial.booking.revision,segment),true)
 assert.equal(await calendar('calendar_ready',firstArgs),true);assert.equal(await calendar('calendar_success',firstArgs),true)
 type Link={event_id:string;proposal_id:string;segment_id:string;etag:string}
 const oldLinks=await calendar<Link[]>('calendar_links')
 const old=oldLinks[0]
 const externalEdit={...firstArgs,event_id:old.event_id,segment_id:old.segment_id,change_id:randomUUID(),kind:'move',etag:'edited-by-google',start_at:segments[0].startAt,end_at:segments[0].endAt}
 assert.equal(await calendar('external_change',externalEdit),true)
 const initialReview=(await db.query('select id,created_at from public.lk_booking_calendar_changes where event_id=$1',[old.event_id])).rows
 const nextSegments=segments.map(segment=>({...segment,startAt:new Date(Date.parse(segment.startAt)+10*86400000).toISOString(),endAt:new Date(Date.parse(segment.endAt)+10*86400000).toISOString()}))
 const next=await accepted(f,nextSegments,initial.booking.revision)
 assert.equal(await calendar('external_change',{...externalEdit,change_id:randomUUID(),revision:next.detail.booking.revision}),true)
 assert.deepEqual((await db.query('select id,created_at from public.lk_booking_calendar_changes where event_id=$1',[old.event_id])).rows,initialReview,'Repeated full scan must preserve the first review timestamp before the new consent')
 const committed=await rpc('confirm',confirmArgs(f.id,next.p.id,next.detail.booking.revision)),nextArgs={booking_id:f.id,proposal_id:next.p.id,revision:committed.booking.revision}
 assert.equal(await calendar('retire_authorization',{...nextArgs,event_id:old.event_id,etag:'edited-by-google'}),true)
 assert.equal(await count('lk_booking_segments'),4)
 assert.equal(await calendar('calendar_success',nextArgs),false)
 for(const segment of next.p.segments)assert.equal(await put(next.p,committed.booking.revision,segment),true)
 assert.equal(await calendar('calendar_ready',nextArgs),true)
 assert.equal(await count('lk_booking_segments'),2)
 assert.equal((await rpc('admin_detail',{id:f.id})).booking.syncStatus,'pending')
 assert.equal(await calendar('calendar_success',nextArgs),false)
 for(const link of oldLinks){
  assert.equal(await calendar('retire_intent',{...nextArgs,event_id:link.event_id,link_etag:link.etag,etag:link.event_id===old.event_id?'edited-by-google':link.etag}),true)
  assert.equal(await calendar('retire_authorization',{...nextArgs,event_id:link.event_id,etag:'deleted'}),true)
  assert.equal(await calendar('link_delete',{...nextArgs,event_id:link.event_id,etag:'stale-etag'}),false)
  assert.equal(await calendar('retire_authorization',{...nextArgs,event_id:link.event_id,etag:'deleted'}),true)
  assert.equal(await calendar('link_delete',{...nextArgs,event_id:link.event_id,etag:link.etag}),true)
 }
 assert.equal(await calendar('calendar_success',nextArgs),true)
 assert.equal(await count('lk_booking_outbox'),0);assert.equal(await count('lk_booking_calendar_retire_intents'),0)
 assert.equal((await rpc('admin_detail',{id:f.id})).booking.confirmedProposalId,next.p.id)
 await db.query("insert into public.lk_enquiries(id,reference,source,payload_json,status,revision,calendar_status) values($1,'DEMO-LEGACY-GUARD','web',$2,'submitted',1,'synced')",[f.id,JSON.stringify({demoSubmissionId:f.id,preferredDate:'2099-10-10'})])
 await assert.rejects(db.query("select public.lk_operations_command('schedule',$1::jsonb)",[JSON.stringify({id:f.id,revision:1,start:segments[0].startAt,end:segments[0].endAt,notes:'test'})]),code('LK409'))
 const legacyChange=randomUUID()
 await db.query("insert into public.lk_calendar_links(enquiry_id,event_id,etag) values($1,'legacy-test-event','legacy-test-etag')",[f.id])
 await db.query("insert into public.lk_change_requests(id,enquiry_id,kind,proposed_start_at,proposed_end_at,provider_etag,enquiry_revision,status,revision,created_at) values($1,$2,'move',$3,$4,'legacy-test-etag',1,'pending',1,now())",[legacyChange,f.id,segments[0].startAt,segments[0].endAt])
 for(const action of ['approve','reject'])await assert.rejects(db.query("select public.lk_operations_command('change_decide',$1::jsonb)",[JSON.stringify({id:legacyChange,revision:1,event:'legacy-test-event',calendar:'test-calendar',etag:'legacy-test-etag',action})]),code('LK409'))
 assert.deepEqual((await db.query('select status,revision from public.lk_change_requests where id=$1',[legacyChange])).rows[0],{status:'pending',revision:1})
})

test('private document downloads preserve the exact frozen PDF bytes for originals and acknowledged proposals',async()=>{
 const f=await fixture(),original=await rpc('admin_detail',{id:f.id})
 const frozen=(reference:string,suffix='')=>({from:'onboarding@resend.dev',to:['lnkgroupsydney@gmail.com'],subject:'[DEMO] Frozen document bytes',html:'<p>DEMO</p>',text:'DEMO',attachments:[{filename:`${reference}${suffix}-demo-quote.pdf`,content:Buffer.from('%PDF-1.7\nFrozen quote evidence\n%%EOF').toString('base64')},{filename:`${reference}${suffix}-signed-demo-terms.pdf`,content:Buffer.from('%PDF-1.7\nFrozen signed evidence\n%%EOF').toString('base64')}]})
 const originalPayload=frozen(original.submission.reference)
 await db.query('update public.lk_quote_submissions set email_payload=$1 where id=$2',[JSON.stringify(originalPayload),f.id])
 const downloaded=await api.bookingDocumentGet(req('quote/booking/documents/quote','GET',f.cookie),{admin:false,kind:'quote'})
 assert.equal(downloaded.status,200,await downloaded.clone().text());assert.equal(downloaded.headers.get('cache-control'),'private, no-store')
 assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),Buffer.from(originalPayload.attachments[0].content,'base64'))
 const proposal=await propose(f);await consent(f,proposal.p)
 const proposalPayload=frozen(original.submission.reference,`-schedule-${proposal.p.revision}`)
 await db.query('update public.lk_booking_proposals set email_payload=$1 where id=$2',[JSON.stringify(proposalPayload),proposal.p.id])
 const signed=await api.bookingDocumentGet(req('operations/bookings/documents/agreement'),{admin:true,id:f.id,kind:'agreement',proposalId:proposal.p.id})
 assert.equal(signed.status,200,await signed.clone().text());assert.deepEqual(Buffer.from(await signed.arrayBuffer()),Buffer.from(proposalPayload.attachments[1].content,'base64'))
 const foreign=await fixture()
 assert.equal((await api.bookingDocumentGet(req('quote/booking/documents/agreement','GET',foreign.cookie),{admin:false,kind:'agreement',proposalId:proposal.p.id})).status,404)
 assert.equal(JSON.stringify(await rpc('admin_detail',{id:f.id})).includes(originalPayload.attachments[0].content),false)
})

test('mismatched frozen PDF names fail closed instead of regenerating another document version',async()=>{
 const f=await fixture()
 const invalid={from:'onboarding@resend.dev',to:['lnkgroupsydney@gmail.com'],subject:'[DEMO] Frozen',html:'<p>DEMO</p>',text:'DEMO',attachments:[{filename:'DEMO-ANOTHER-demo-quote.pdf',content:Buffer.from('%PDF-1.7 test').toString('base64')},{filename:'DEMO-ANOTHER-signed-demo-terms.pdf',content:Buffer.from('%PDF-1.7 test').toString('base64')}]}
 await db.query('update public.lk_quote_submissions set email_payload=$1 where id=$2',[JSON.stringify(invalid),f.id])
 const response=await api.bookingDocumentGet(req('quote/booking/documents/quote','GET',f.cookie),{admin:false,kind:'quote'})
 assert.equal(response.status,503)
 assert.equal((await response.text()).includes('%PDF'),false)
})
