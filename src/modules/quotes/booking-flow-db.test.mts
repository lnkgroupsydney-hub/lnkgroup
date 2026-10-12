import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { PHOTO_ROLES, type ProvisionalPhotoAnalysis } from './domain/analysis.ts'
import { calculateEstimatePricing } from './domain/pricing.ts'
import { BOOKING_ACKNOWLEDGMENT_TEXT, validateBookingSignature, type LiveBookingState, type LiveBookingDeliveryClaim } from './domain/booking-flow.ts'
const db = new PGlite()
await db.exec('create role anon;create role authenticated;create role service_role bypassrls;')
for (const name of readdirSync(new URL('../../../supabase/migrations/', import.meta.url)).filter(n => n.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url),'utf8'))
const tables = (await db.query<{tablename:string}>("select tablename from pg_tables where schemaname='public' and tablename like 'lk_%'")).rows.map(x=>x.tablename)
const companyId='lk-group', target={accountSub:'company-sub',calendarId:'lnkgroupsydney@gmail.com'}, email='alice@example.invalid', ownerHash='a'.repeat(64)
const service={serviceId:'cabinet-painting',intent:'full-repainting',surfaces:['doors','drawers'],doorCount:8,drawerCount:3,material:'',colourPreference:''}
const contact={name:'Synthetic customer',email,phone:'',siteAddress:'1 Synthetic St',suburb:'Test',postcode:'2000',details:'Synthetic only',consent:true}
const hash=(v:string)=>createHash('sha256').update(v).digest('hex')
const failure=(code:string)=>(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code===code
async function rpc<T=LiveBookingState>(cmd:string,args:Record<string,unknown>={}) {return (await db.query<{result:T}>('select public.lk_live_quote_booking_command($1,$2::jsonb) result',[cmd,JSON.stringify({companyId,...args})])).rows[0].result}
async function requests<T>(cmd:string,args:Record<string,unknown>) {return(await db.query<{result:T}>('select public.lk_quote_requests_command($1,$2::jsonb) result',[cmd,JSON.stringify({companyId,...args})])).rows[0].result}
async function media(cmd:string,args:Record<string,unknown>) {return(await db.query<{result:unknown}>('select public.lk_quote_media_command($1,$2::jsonb) result',[cmd,JSON.stringify({companyId,...args})])).rows[0].result}
async function fixture(owner=ownerHash,customerEmail=email) {
 const r=await requests<{id:string;revision:number}>('save',{ownerHash:owner,expiresAt:new Date(Date.now()+23*3600000).toISOString(),expectedRevision:0,idempotencyKey:randomUUID(),payload:{contact:{...contact,email:customerEmail},service},storageConsent:true,consentVersion:'quote-storage-review-v1'})
 const authUserId=randomUUID(),sessionId=randomUUID()
 await db.query('insert into public.lk_quote_request_access(company_id,request_id,auth_user_id,verified_email,verified_at) values($1,$2,$3,$4,now())',[companyId,r.id,authUserId,customerEmail])
 await db.query('insert into public.lk_quote_customer_sessions(id,company_id,auth_user_id,auth_session_id,verified_email,expires_at) values($1,$2,$3,$4,$5,now()+interval \'1 hour\')',[sessionId,companyId,authUserId,randomUUID(),customerEmail])
 const photoId=randomUUID();await db.query("insert into public.lk_live_quote_photos(id,company_id,request_id,role,state,mime_type,source_hash,size_bytes,stored_bytes,staging_path,object_path,content_hash,width,height,ready_at) values($1,$2,$3,'overview','ready','image/jpeg',$4,1000,900,$5,$6,$4,640,480,now())",[photoId,companyId,r.id,hash(photoId),'staging/'+photoId,'private/'+photoId])
 const manifest=(await db.query<{result:unknown}>('select public.lk_live_booking_manifest(q) result from public.lk_quote_requests q where q.id=$1',[r.id])).rows[0].result
 const analysis:ProvisionalPhotoAnalysis={summary:'Synthetic visible fronts.',outcome:'analysis_ready',photoQuality:[{photoId,usable:true,issues:[],retakeInstruction:null}],coverage:PHOTO_ROLES.map(role=>({role,covered:true,photoIds:[photoId],note:'Visible.'})),observedDamage:[],quantities:{doors:{observed:8,customer:8,needsConfirmation:false,estimated:8,basisPhotoIds:[photoId],confidence:'medium',note:'Synthetic estimate.'},drawers:{observed:3,customer:3,needsConfirmation:false,estimated:3,basisPhotoIds:[photoId],confidence:'medium',note:'Synthetic estimate.'}},proposedWork:[],unknowns:[],siteChecks:[],estimateScope:{status:'estimable',extent:'whole_project',anchorPhotoId:photoId,scopePhotoIds:[photoId],contextPhotoIds:[],conflictingPhotoIds:[],description:'Synthetic matching fronts.',assumptions:['Exact quantities require site confirmation.']}}
 const pricing=calculateEstimatePricing(analysis,service),analysisId=randomUUID(),snapshot={service,photos:manifest,coverage:{upperNotApplicable:false,damageNotPresent:true},model:'gpt-6.1-sol',promptVersion:'cabinet-v2',schemaVersion:'cabinet-v2',pricingVersion:pricing.pricingVersion}
 await db.query("insert into public.lk_quote_analysis_jobs(id,company_id,request_id,input_revision,input_key,input_snapshot,status,model,prompt_version,schema_version,pricing_version,consent_version,attempts,analysis,pricing,usage,completed_at) values($1,$2,$3,$4,$5,$6,'succeeded','gpt-6.1-sol','cabinet-v2','cabinet-v2',$7,'openai-photo-analysis-v1',1,$8,$9,'{}',now())",[analysisId,companyId,r.id,r.revision,hash(analysisId),snapshot,pricing.pricingVersion,analysis,pricing])
 return {r,authUserId,sessionId,photoId,analysisId,analysis,pricing,args:{ownerHash:owner,expectedRequestId:r.id,customerAccess:{companyId,sessionId,authUserId,email:customerEmail,requestId:r.id}}}
}
function check(extra:Record<string,unknown>={}) {return {...target,revision:'availability-v1',checkedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),...extra}}
function preferred() {return new Date(Date.now()+3*86400000).toISOString().slice(0,10)}
async function approve(f:Awaited<ReturnType<typeof fixture>>,extra:Record<string,unknown>={}) {return rpc('approve',{...f.args,analysisId:f.analysisId,expectedRevision:f.r.revision,idempotencyKey:randomUUID(),calendarTarget:target,...extra})}
async function selected(f:Awaited<ReturnType<typeof fixture>>) {const a=await approve(f);return rpc('date',{...f.args,approvalId:a.approval!.id,preferredDate:preferred(),availabilityRevision:'availability-v1',idempotencyKey:randomUUID(),dateCheck:check()})}
async function submit(f:Awaited<ReturnType<typeof fixture>>,extra:Record<string,unknown>={}) {const a=await selected(f),review=await rpc<{approvalId:string;selectionRevision:number;snapshotHash:string}>('review',{...f.args,approvalId:a.approval!.id,selectionRevision:a.approval!.selectionRevision});const args={...f.args,...review,reviewExpiresAt:new Date(Date.now()+900000).toISOString(),signature:validateBookingSignature({name:'Synthetic customer',method:'typed',strokes:[],acknowledged:true}),idempotencyKey:randomUUID(),dateCheck:check(),...extra};return {state:await rpc('submit',args),args}}
beforeEach(async()=>{await db.exec('reset role');await db.exec(`truncate ${tables.map(x=>'public.'+x).join(',')}`);await db.exec('set role service_role');await db.query("insert into public.lk_google_connection(id,account_sub,email,access_cipher,refresh_cipher,expires_at,selected_calendar_id) values(1,$1,$2,'cipher','refresh',9999999999999,'legacy-test-calendar')",[target.accountSub,target.calendarId])})
after(async()=>db.close())
test('booking tables, commands and helper functions are private to service role',async()=>{
 for(const role of ['anon','authenticated']) {await db.exec(`set role ${role}`);for(const name of ['lk_live_quote_approvals','lk_live_quote_submissions','lk_live_quote_booking_receipts','lk_live_booking_confirmed_segments']) await assert.rejects(db.query(`select * from public.${name}`),failure('42501'));await assert.rejects(rpc('state'),failure('42501'));await assert.rejects(db.query('select public.lk_live_booking_ack()'),failure('42501'))}
 await db.exec('set role service_role')
 const flags=(await db.query<{n:number}>("select count(*)::integer n from pg_class where relname in ('lk_live_quote_approvals','lk_live_quote_submissions','lk_live_quote_booking_receipts','lk_live_booking_confirmed_segments') and relrowsecurity")).rows[0].n;assert.equal(flags,4)
})
test('verified identity is resolved per transaction; guests and other customers cannot approve known requests',async()=>{
 const a=await fixture(),b=await fixture('b'.repeat(64),'bob@example.invalid');await assert.rejects(rpc('state',{ownerHash,expectedRequestId:a.r.id}),failure('LK403'))
 await assert.rejects(rpc('state',{...a.args,customerAccess:b.args.customerAccess}),failure('LK403'))
 await db.query('update public.lk_quote_customer_sessions set revoked_at=now() where id=$1',[a.sessionId]);await assert.rejects(approve(a),failure('LK401'))
})
test('approval freezes numeric current estimate and canonical acknowledgment without changing source revision',async()=>{
 const f=await fixture(),state=await approve(f);assert.equal(state.approval!.snapshot.pricing.total,165000);assert.ok(state.approval!.snapshot.pricing.reviewReasons.length>0);assert.equal(state.approval!.snapshot.acknowledgment.text,BOOKING_ACKNOWLEDGMENT_TEXT);assert.equal(state.approval!.stale,false)
 const r=(await db.query<{revision:number}>('select revision from public.lk_quote_requests where id=$1',[f.r.id])).rows[0];assert.equal(r.revision,1)
 await assert.rejects(db.query("update public.lk_live_quote_approvals set source_snapshot=source_snapshot||'{\"forged\":true}' where id=$1",[state.approval!.id]),failure('LK409'))
})
test('approval denies wrong latest job, changed manifest, uploading photos, revision mismatch and forged numeric pricing',async()=>{
 const f=await fixture();await assert.rejects(approve(f,{analysisId:randomUUID()}),failure('LK409'));await assert.rejects(approve(f,{expectedRevision:2}),failure('LK409'))
 await db.query("update public.lk_quote_analysis_jobs set pricing=jsonb_set(pricing,'{total}','1') where id=$1",[f.analysisId]);await assert.rejects(approve(f),failure('LK409'));await db.query('update public.lk_quote_analysis_jobs set pricing=$2 where id=$1',[f.analysisId,f.pricing])
 await db.query('update public.lk_live_quote_photos set content_hash=$2 where id=$1',[f.photoId,'c'.repeat(64)]);await assert.rejects(approve(f),failure('LK409'));await db.query('update public.lk_live_quote_photos set content_hash=$2 where id=$1',[f.photoId,hash(f.photoId)])
 await media('photo_begin',{...f.args,expectedRevision:1,idempotencyKey:randomUUID(),role:'damage',mimeType:'image/jpeg',sizeBytes:1000,sourceHash:'d'.repeat(64)});assert.equal((await rpc('state',f.args)).approval,null);await assert.rejects(approve(f),failure('LK409'))
})
test('latest job started without input revision change makes approved source stale',async()=>{
 const f=await fixture(),a=await approve(f)
 await db.query("insert into public.lk_quote_analysis_jobs(company_id,request_id,input_revision,input_key,input_snapshot,model,prompt_version,schema_version,pricing_version,consent_version,attempts,created_at) select company_id,request_id,input_revision,$2,input_snapshot,model,prompt_version,schema_version,pricing_version,consent_version,1,now()+interval '1 second' from public.lk_quote_analysis_jobs where id=$1",[f.analysisId,'e'.repeat(64)])
 assert.equal((await rpc('state',f.args)).approval!.stale,true);await assert.rejects(rpc('review',{...f.args,approvalId:a.approval!.id,selectionRevision:0}),failure('LK409'))
})
test('selection rejects missing, expired or changed Calendar proof and confirmed occupied dates',async()=>{
 const f=await fixture(),a=await approve(f),args={...f.args,approvalId:a.approval!.id,preferredDate:preferred(),availabilityRevision:'availability-v1',idempotencyKey:randomUUID()}
 for(const bad of [undefined,check({checkedAt:null}),check({expiresAt:null}),check({checkedAt:new Date(Date.now()+60000).toISOString()}),check({calendarId:'another'}),check({accountSub:'other'}),check({revision:'v2'})]) await assert.rejects(rpc('date',{...args,dateCheck:bad}),failure('LK409'))
 const state=await rpc('date',{...args,dateCheck:check()});assert.equal(state.approval!.selectionRevision,1);assert.equal(state.approval!.inputRevision,1)
})
test('review and submission bind current selection, proof expiry, signature and immutable source',async()=>{
 const f=await fixture(),a=await selected(f),review=await rpc<{snapshotHash:string}>('review',{...f.args,approvalId:a.approval!.id,selectionRevision:1}),args={...f.args,approvalId:a.approval!.id,selectionRevision:1,snapshotHash:review.snapshotHash,reviewExpiresAt:new Date(Date.now()+900000).toISOString(),signature:validateBookingSignature({name:'Synthetic customer',method:'typed',strokes:[],acknowledged:true}),idempotencyKey:randomUUID(),dateCheck:check()}
 for(const extra of [{reviewExpiresAt:null},{reviewExpiresAt:new Date(Date.now()-1).toISOString()},{snapshotHash:'f'.repeat(64)},{selectionRevision:0},{signature:{...args.signature,acknowledged:false}},{dateCheck:check({expiresAt:null})}]) await assert.rejects(rpc('submit',{...args,...extra}),failure(extra.signature?'LK400':'LK409'))
 const state=await rpc('submit',args);assert.equal(state.canEdit,false);assert.equal(state.submission!.emailStatus,'pending');assert.equal(state.submission!.calendarStatus,'blocked');assert.notEqual(state.submission!.signedContentHash,state.submission!.snapshotHash)
 for(const cmd of ['photo_begin','photo_finalize','photo_remove','reopen','analysis_start']) await assert.rejects(media(cmd,{...f.args,expectedRevision:1,idempotencyKey:randomUUID()}),failure('LK409'))
 await assert.rejects(requests('save',{...f.args,expectedRevision:1,idempotencyKey:randomUUID(),payload:{contact,service},storageConsent:true,consentVersion:'quote-storage-review-v1'}),failure('LK409'))
 await assert.rejects(db.query("update public.lk_live_quote_submissions set signature='{}' where id=$1",[state.submission!.id]),failure('LK409'))
})
test('atomic retry keys reject different payload; submitted replay permits original despite expired proof and busy-check omission',async()=>{
 const f=await fixture(),submitted=await submit(f),state=submitted.state
 assert.equal((await rpc('submit',{...submitted.args,dateCheck:undefined,reviewExpiresAt:new Date(Date.now()-10000).toISOString()})).submission!.id,state.submission!.id)
 await assert.rejects(rpc('submit',{...submitted.args,signature:{...submitted.args.signature,name:'Different name'}}),failure('LK409'))
 assert.equal((await rpc('submit',{...submitted.args,idempotencyKey:randomUUID(),dateCheck:undefined,reviewExpiresAt:new Date(Date.now()-10000).toISOString()})).submission!.id,state.submission!.id)
 await assert.rejects(rpc('submit',{...submitted.args,idempotencyKey:randomUUID(),signature:{...submitted.args.signature,name:'Different name'}}),failure('LK409'))
})
test('pending requests on the same date have no occupancy hold',async()=>{
 const a=await fixture(),b=await fixture('b'.repeat(64),'bob@example.invalid');const first=await submit(a),second=await submit(b);assert.equal(first.state.submission!.preferredDate,second.state.submission!.preferredDate);assert.deepEqual(await rpc('occupancy',target),{segments:[]})
})
test('delivery lease CAS, frozen recipient/bytes, accepted email gate and readback preserve signed record',async()=>{
 const f=await fixture(),{state}=await submit(f),id=state.submission!.id,leaseToken=randomUUID(),claim=await rpc<LiveBookingDeliveryClaim>('delivery_claim',{id,leaseToken});assert.equal(claim.leaseToken,leaseToken)
 assert.equal(await rpc('delivery_claim',{id,leaseToken:randomUUID()}),null)
 await assert.rejects(rpc('delivery_email_attempt',{id,leaseToken}),failure('LK409'));await assert.rejects(rpc('delivery_calendar_synced',{id,leaseToken,eventId:'event',eventEtag:'etag'}),failure('LK409'))
 const pdf=Buffer.from('%PDF-synthetic receipt'),values={id,leaseToken,pdfBase64:pdf.toString('base64'),pdfHash:hash(pdf.toString()),payload:{to:email,subject:'Synthetic nonbinding request'}}
 await assert.rejects(rpc('delivery_freeze',{...values,payload:{to:'bob@example.invalid'}}),failure('LK403'))
 await assert.rejects(rpc('delivery_freeze',{...values,pdfHash:'f'.repeat(64)}),failure('LK400'))
 const frozen=await rpc<LiveBookingDeliveryClaim>('delivery_freeze',values);assert.equal(frozen.frozenReceipt!.pdfHash,values.pdfHash)
 await assert.rejects(rpc('delivery_freeze',{...values,payload:{...values.payload,subject:'changed'}}),failure('LK409'))
 const attempt=await rpc<LiveBookingDeliveryClaim>('delivery_email_attempt',{id,leaseToken});assert.ok(attempt.emailFirstAttemptAt)
 const accepted=await rpc<{emailStatus:string;calendarStatus:string}>('delivery_email_accepted',{id,leaseToken,providerMessageId:'provider-id'});assert.equal(accepted.emailStatus,'provider_accepted');assert.equal(accepted.calendarStatus,'pending')
 await assert.rejects(rpc('delivery_calendar_synced',{id,leaseToken:randomUUID(),eventId:'event',eventEtag:'etag'}),failure('LK409'))
 const synced=await rpc<{calendarStatus:string}>('delivery_calendar_synced',{id,leaseToken,eventId:'event',eventEtag:'etag'});assert.equal(synced.calendarStatus,'synced');assert.equal((await rpc('state',f.args)).submission!.signedContentHash,state.submission!.signedContentHash)
})
test('interrupted leases recover with the original email key and uncertain attempts age into manual review',async()=>{
 const f=await fixture(),{state}=await submit(f),id=state.submission!.id,leaseToken=randomUUID(),claim=await rpc<LiveBookingDeliveryClaim>('delivery_claim',{id,leaseToken})
 await db.query("update public.lk_live_quote_submissions set lease_expires_at=now()-interval '1 second' where id=$1",[id]);const recovery=await rpc<LiveBookingDeliveryClaim>('delivery_claim',{id,leaseToken:randomUUID()});assert.equal(recovery.emailIdempotencyKey,claim.emailIdempotencyKey)
 await db.query("update public.lk_live_quote_submissions set lease_expires_at=now()-interval '1 second',email_first_attempt_at=now()-interval '25 hours',email_status='outcome_unknown' where id=$1",[id]);assert.equal(await rpc('delivery_claim',{id,leaseToken:randomUUID()}),null);assert.equal((await rpc('state',f.args)).submission!.emailStatus,'manual_review')
})
test('confirmed segments block date selection and submit after selection, with exclusive end date',async()=>{
 const confirmed=await fixture(),{state:record}=await submit(confirmed),request=await fixture('b'.repeat(64),'bob@example.invalid'),selectedState=await selected(request),approvalId=selectedState.approval!.id
 await db.exec('reset role');await db.query('insert into public.lk_live_booking_confirmed_segments(company_id,submission_id,account_sub,calendar_id,start_date,end_date,confirmation_version) values($1,$2,$3,$4,$5,$6,1)',[companyId,record.submission!.id,target.accountSub,target.calendarId,preferred(),new Date(Date.parse(preferred())+86400000).toISOString().slice(0,10)]);await db.exec('set role service_role')
 assert.equal((await rpc<{segments:unknown[]}>('occupancy',target)).segments.length,1)
 await assert.rejects(rpc('date',{...request.args,approvalId,preferredDate:preferred(),availabilityRevision:'availability-v1',idempotencyKey:randomUUID(),dateCheck:check()}),failure('LK409'))
 const reviewed=await rpc<{snapshotHash:string}>('review',{...request.args,approvalId,selectionRevision:1})
 await assert.rejects(rpc('submit',{...request.args,approvalId,selectionRevision:1,snapshotHash:reviewed.snapshotHash,reviewExpiresAt:new Date(Date.now()+900000).toISOString(),signature:validateBookingSignature({name:'Synthetic',method:'typed',strokes:[],acknowledged:true}),idempotencyKey:randomUUID(),dateCheck:check()}),failure('LK409'))
 const exclusiveEnd=new Date(Date.parse(preferred())+86400000).toISOString().slice(0,10)
 const end=await rpc('date',{...request.args,approvalId,preferredDate:exclusiveEnd,availabilityRevision:'availability-v1',idempotencyKey:randomUUID(),dateCheck:check()});assert.equal(end.approval!.preferredDate,exclusiveEnd)
})
test('an expired uncertain outbox row does not prevent claiming a later pending job',async()=>{
 const a=await fixture(),b=await fixture('b'.repeat(64),'bob@example.invalid'),first=await submit(a),second=await submit(b)
 await db.query("update public.lk_live_quote_submissions set email_first_attempt_at=now()-interval '25 hours',email_status='outcome_unknown',next_attempt_at=now()-interval '1 hour' where id=$1",[first.state.submission!.id])
 const claim=await rpc<LiveBookingDeliveryClaim>('delivery_claim',{leaseToken:randomUUID()});assert.equal(claim.submission.id,second.state.submission!.id);assert.equal((await rpc('state',a.args)).submission!.emailStatus,'manual_review')
})
test('editing source retains prior approval and recomputation creates a distinct immutable approval version',async()=>{
 const f=await fixture(),original=await approve(f),firstSnapshot=original.approval!.snapshot
 await requests('save',{...f.args,expiresAt:new Date(Date.now()+3600000).toISOString(),expectedRevision:1,idempotencyKey:randomUUID(),payload:{contact:{...contact,details:'Changed details'},service},storageConsent:true,consentVersion:'quote-storage-review-v1'})
 assert.equal((await rpc('state',f.args)).approval!.stale,true)
 const newJobId=randomUUID();await db.query("insert into public.lk_quote_analysis_jobs(id,company_id,request_id,input_revision,input_key,input_snapshot,status,model,prompt_version,schema_version,pricing_version,consent_version,attempts,analysis,pricing,usage,completed_at,created_at) select $2,company_id,request_id,2,$3,input_snapshot,status,model,prompt_version,schema_version,pricing_version,consent_version,1,analysis,pricing,usage,now(),now()+interval '1 second' from public.lk_quote_analysis_jobs where id=$1",[f.analysisId,newJobId,hash(newJobId)])
 const updated=await approve(f,{analysisId:newJobId,expectedRevision:2});assert.equal(updated.approval!.version,2);assert.notEqual(updated.approval!.id,original.approval!.id)
 const prior=(await db.query<{source_snapshot:unknown}>('select source_snapshot from public.lk_live_quote_approvals where id=$1',[original.approval!.id])).rows[0].source_snapshot;assert.deepEqual(prior,firstSnapshot)
})
