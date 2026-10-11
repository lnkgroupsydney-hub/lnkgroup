import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { calculateEstimatePricing, pendingCompanyPricing, QUOTE_PRICING_VERSION } from './domain/pricing.ts'
import { PHOTO_ROLES, type PhotoAnalysis } from './domain/analysis.ts'
const db = new PGlite()
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`)
for (const name of readdirSync(new URL('../../../supabase/migrations/', import.meta.url)).filter(n => n.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8'))
const tables = (await db.query<{tablename:string}>("select tablename from pg_tables where schemaname='public' and tablename like 'lk_%'")).rows.map(x => x.tablename)
type Photo = { id:string; requestId:string; state:string; sourceHash:string; objectPath:string; stagingPath:string }
type Job = { id:string; status:string; stale:boolean; attempts:number; inputRevision:number; inputSnapshot:Record<string,unknown>; manifest:Array<{id:string;objectPath:string}>; analysis:unknown; pricing:unknown; leaseToken:string|null }
type Workspace = {request:{id:string;revision:number;status:string};photos:Photo[];jobs:Job[];latest:Job|null}
const companyId = 'lk-group'
const ownerA = 'a'.repeat(64), ownerB = 'b'.repeat(64)
const actor = { actorUserId:randomUUID(),actorSessionId:randomUUID() }
const hash = (s:string) => createHash('sha256').update(s).digest('hex')
const service = { serviceId:'cabinet-painting', intent:'full-repainting', surfaces:['doors','drawers'], doorCount:5, drawerCount:2, material:'', colourPreference:'' }
const payload = { contact:{name:'PRIVATE PERSON',email:'private@example.invalid',siteAddress:'PRIVATE ADDRESS',suburb:'Test',postcode:'2000',consent:true},service }
const code = (value:string) => (e:unknown) => !!e && typeof e==='object' && 'code' in e && e.code===value
async function raw<T>(fn:string,cmd:string,args:Record<string,unknown>):Promise<T> {return (await db.query<{result:T}>(`select public.${fn}($1,$2::jsonb) result`,[cmd,JSON.stringify({companyId,...args})])).rows[0].result}
const media = <T=Workspace>(cmd:string,args:Record<string,unknown>={}) => raw<T>('lk_quote_media_command',cmd,args)
const old = <T=Workspace['request']>(cmd:string,args:Record<string,unknown>) => raw<T>('lk_quote_requests_command',cmd,args)
async function create(ownerHash=ownerA,selectedService=service) {return old('save',{ownerHash,expiresAt:new Date(Date.now()+23*3600000).toISOString(),expectedRevision:0,idempotencyKey:randomUUID(),payload:{...payload,service:selectedService},storageConsent:true,consentVersion:'quote-storage-review-v1'})}
async function workspace(ownerHash=ownerA) {return media('workspace',{ownerHash})}
function write(expectedRevision=1,extra:Record<string,unknown>={},ownerHash=ownerA) {return {ownerHash,expectedRevision,idempotencyKey:randomUUID(),...extra}}
async function begin(revision=1,extra:Record<string,unknown>={},ownerHash=ownerA) {return media<Photo>('photo_begin',write(revision,{role:'overview',mimeType:'image/jpeg',sizeBytes:1000,sourceHash:hash(randomUUID()),...extra},ownerHash))}
async function finalize(photoId:string,revision=1,extra:Record<string,unknown>={}) {return media('photo_finalize',write(revision,{photoId,contentHash:hash(photoId),width:640,height:480,storedBytes:900,...extra}))}
async function ready() {await create();const p=await begin();return finalize(p.id)}
function startInput(revision=2,extra:Record<string,unknown>={}) {return write(revision,{aiConsentVersion:'openai-photo-analysis-v1',model:'gpt-6.1-sol',promptVersion:'cabinet-v1',schemaVersion:'cabinet-v1',pricingVersion:'unconfigured',coverage:{upperNotApplicable:false,damageNotPresent:false},...extra})}
async function start(revision=2,extra:Record<string,unknown>={}) {return media('analysis_start',startInput(revision,extra))}
async function claim(jobId:string,leaseToken=randomUUID()) {return media<Job|null>('analysis_claim',{jobId,leaseToken})}
function completion(job:Job,extra:Record<string,unknown>={}) {return {jobId:job.id,leaseToken:job.leaseToken,analysis:{summary:'Visible peeling paint',observations:[{photoId:job.manifest[0].id}]},pricing:{status:'awaiting_company_rates',currency:'AUD',pricingVersion:'unconfigured',lineItems:[],subtotal:null,tax:null,total:null,notice:'Company price configuration pending.'},usage:{inputTokens:1200,outputTokens:300},providerResponseId:'resp_synthetic',...extra}}
async function count(table:string) {return (await db.query<{n:number}>(`select count(*)::integer n from public.${table}`)).rows[0].n}
beforeEach(async()=> {await db.exec('reset role');await db.exec(`truncate ${tables.map(t=>'public.'+t).join(',')}`);await db.exec('set role service_role')})
after(async()=> {await db.close()})

test('additive private buckets and service-only RLS prevent direct client writes and RPC',async()=> {
 await db.exec('reset role')
 const buckets=(await db.query<{id:string;public:boolean;file_size_limit:number;allowed_mime_types:string[]}>('select * from storage.buckets order by id')).rows
 assert.equal(buckets.length,2);assert.ok(buckets.every(b=>b.public===false));assert.equal(buckets.find(b=>b.id==='live-quote-photos')!.file_size_limit,3145728)
 await db.exec('set role service_role');const w=await ready()
 for(const role of ['anon','authenticated']) {
  await db.exec(`set role ${role}`)
  for(const table of ['lk_live_quote_photos','lk_quote_analysis_jobs','lk_quote_media_receipts','lk_quote_media_audit']) {
   for(const sql of [`select * from public.${table}`,`delete from public.${table}`,`update public.${table} set company_id='lk-group'`]) await assert.rejects(db.query(sql),code('42501'))
  }
  await assert.rejects(media('workspace',{ownerHash:ownerA}),code('42501'))
  await assert.rejects(media('analysis_claim',{jobId:randomUUID(),leaseToken:randomUUID()}),code('42501'))
 }
 await db.exec('set role service_role')
 assert.equal(w.photos.length,1)
 for(const table of ['lk_quote_media_receipts','lk_quote_media_audit']) await assert.rejects(db.query(`delete from public.${table}`),code('42501'))
 const enabled=(await db.query<{n:number}>("select count(*)::integer n from pg_class where relname in ('lk_live_quote_photos','lk_quote_analysis_jobs','lk_quote_media_receipts','lk_quote_media_audit') and relrowsecurity")).rows[0].n;assert.equal(enabled,4)
})

test('photo ownership and company/staff boundaries apply even with known identifiers',async()=> {
 const a=await ready();await create(ownerB)
 assert.equal((await workspace(ownerB)).photos.length,0)
 await assert.rejects(media('photo_lookup',{ownerHash:ownerB,photoId:a.photos[0].id}),code('LK404'))
 await assert.rejects(media('photo_remove',write(1,{photoId:a.photos[0].id},ownerB)),code('LK404'))
 await assert.rejects(media('staff_workspace',{id:a.request.id}),code('LK403'))
 await assert.rejects(media('staff_workspace',{...actor,id:a.request.id,companyId:'wrong'}),code('LK403'))
 assert.deepEqual(await media('staff_workspace',{...actor,id:a.request.id}),a)
 assert.equal((await media<Photo>('staff_photo',{...actor,id:a.request.id,photoId:a.photos[0].id})).id,a.photos[0].id)
 await assert.rejects(media('workspace',{ownerHash:'broken'}),code('LK401'))
 await db.query("update public.lk_quote_requests set owner_expires_at=now()-interval '1 minute' where owner_hash=$1",[ownerA])
 await assert.rejects(workspace(),code('LK401'))
 assert.equal((await media('staff_workspace',{...actor,id:a.request.id})).photos.length,1)
})

test('begin retries reserve one object, enforce bytes/hash/type and bounded upload count',async()=> {
 await create();const values=write(1,{role:'overview',mimeType:'image/jpeg',sizeBytes:1000,sourceHash:hash('original')})
 const p=await media<Photo>('photo_begin',values)
 assert.deepEqual(await media('photo_begin',values),p);assert.equal(await count('lk_live_quote_photos'),1)
 assert.equal(p.sourceHash,hash('original'));assert.ok(p.objectPath.includes(p.requestId));assert.notEqual(p.objectPath,p.stagingPath)
 await assert.rejects(media('photo_begin',{...values,sourceHash:hash('changed')}),code('LK409'))
 for(const bad of [{sizeBytes:10485761},{mimeType:'image/svg+xml'},{sourceHash:'invalid'},{role:'arbitrary'}]) await assert.rejects(begin(1,bad),code('LK400'))
 for(let i=0;i<7;i++) await begin()
 await assert.rejects(begin(),code('LK409'));assert.equal((await workspace()).request.revision,1)
})

test('validated finalization atomically advances revision with exact response-loss replay and duplicate hash protection',async()=> {
 await create();const p=await begin(),values=write(1,{photoId:p.id,contentHash:hash('normalized'),width:640,height:480,storedBytes:900})
 const w=await media('photo_finalize',values)
 assert.equal(w.request.revision,2);assert.equal(w.photos[0].state,'ready');assert.deepEqual(await media('photo_finalize',values),w)
 assert.equal(await count('lk_quote_media_audit'),2)
 const second=await begin(2)
 await assert.rejects(finalize(second.id,2,{contentHash:hash('normalized')}),code('LK409'))
 await assert.rejects(finalize(second.id,1),code('LK409'))
 for(const bad of [{width:0},{width:50000,height:50000},{storedBytes:3145729},{contentHash:'invalid'}]) await assert.rejects(finalize(second.id,2,bad),code('LK400'))
 assert.equal((await workspace()).request.revision,2)
})

test('expired staged uploads cannot finalize; explicit removal frees capacity, cleanup respects signed token lifetime',async()=> {
 await create();const p=await begin()
 await db.query("update public.lk_live_quote_photos set upload_expires_at=now()-interval '1 second' where id=$1",[p.id])
 await assert.rejects(finalize(p.id),code('LK409'))
 assert.equal((await media<Photo[]>('staging_cleanup')).length,0)
 const w=await media('photo_remove',write(1,{photoId:p.id}));assert.equal(w.request.revision,2);assert.equal(w.photos.length,0)
 await db.query("update public.lk_live_quote_photos set upload_expires_at=now()-interval '2 hours 1 second' where id=$1",[p.id])
 assert.equal((await media<Photo[]>('staging_cleanup'))[0].id,p.id)
 await media('staging_cleaned',{photoId:p.id});assert.equal((await media<Photo[]>('staging_cleanup')).length,0)
 assert.equal(await count('lk_live_quote_photos'),1,'Soft removal retains historic objects')
})

test('review lock requires explicit reopen and preserves original request audit/result snapshot',async()=> {
 const initial=await ready();const reviewed=await old('request_review',{ownerHash:ownerA,expectedRevision:2,idempotencyKey:randomUUID()})
 await assert.rejects(begin(3),code('LK409'));await assert.rejects(start(3),code('LK409'))
 const values=write(3),opened=await media('reopen',values)
 assert.equal(opened.request.revision,4);assert.equal(opened.request.status,'draft');assert.deepEqual(await media('reopen',values),opened)
 const detail=await old<{audit:Array<{action:string}>}>('detail',{...actor,id:initial.request.id})
 assert.equal(detail.audit.length,2);assert.equal(detail.audit[0].action,'request_review')
 const history=(await db.query<{result_json:{status:string;revision:number}}>("select result_json from public.lk_quote_request_audit where action='request_review'")).rows[0].result_json
 assert.equal(history.status,'review_requested');assert.equal(history.revision,reviewed.revision)
 assert.equal((await begin(4)).state,'uploading');assert.equal(await count('lk_quote_versions'),0)
})

test('AI snapshot excludes customer contact, captures immutable manifest and deduplicates new keys on same input',async()=> {
 const w=await ready(),values=startInput(),one=await media('analysis_start',values)
 assert.equal(one.latest!.status,'queued');assert.equal(one.request.revision,w.request.revision);assert.equal(one.latest!.attempts,1)
 assert.equal(one.latest!.inputSnapshot.contact,undefined)
 const snapshot=JSON.stringify(one.latest!.inputSnapshot)
 assert.ok(!snapshot.includes('PRIVATE'));assert.ok(!snapshot.includes('private@example'))
 assert.equal(one.latest!.manifest[0].id,w.photos[0].id)
 assert.deepEqual(await media('analysis_start',values),one)
 assert.equal((await start()).latest!.id,one.latest!.id);assert.equal(await count('lk_quote_analysis_jobs'),1)
 await assert.rejects(start(2,{aiConsentVersion:'storage-consent'}),code('LK400'))
 await assert.rejects(start(2,{model:'arbitrary'}),code('LK400'))
 await assert.rejects(start(2,{pricingVersion:'invented-price'}),code('LK400'))
})

test('analysis rejects absent photos, service, unfinished upload and stale revisions without creating jobs',async()=> {
 await create();await assert.rejects(start(1),code('LK400'))
 await begin();await assert.rejects(start(1),code('LK409'))
 await db.query("update public.lk_quote_requests set payload=jsonb_set(payload,'{service}','null'::jsonb)")
 await assert.rejects(start(1),code('LK400'));assert.equal(await count('lk_quote_analysis_jobs'),0)
})

test('worker claims once; wrong leases fail; completion and usage persist together, immutable duplicate completion',async()=> {
 await ready();const started=await start(),job=await claim(started.latest!.id)
 assert.ok(job);assert.equal(job.status,'running');assert.equal(await claim(job.id),null)
 await assert.rejects(media('analysis_finish',completion(job,{leaseToken:randomUUID()})),code('LK409'))
 await assert.rejects(media('analysis_finish',completion(job,{pricing:{status:'estimated',total:1250}})),code('LK400'))
 const values=completion(job),done=await media('analysis_finish',values)
 assert.equal(done.latest!.status,'succeeded');assert.deepEqual(done.latest!.analysis,values.analysis);assert.deepEqual(done.latest!.pricing,values.pricing)
 assert.deepEqual(await media('analysis_finish',values),done)
 await assert.rejects(media('analysis_finish',{...values,analysis:{summary:'changed'}}),code('LK409'))
 assert.equal((await start()).latest!.id,job.id)
 assert.equal((await db.query<{n:number}>("select count(*)::integer n from public.lk_quote_media_audit where action='analysis_finish'")).rows[0].n,1)
 assert.equal(await count('lk_quote_versions'),0)
})

test('expired lease becomes uncertain and cannot be claimed or overwrite result; retry is explicit and bounded',async()=> {
 await ready();const queued=await start(),job=(await claim(queued.latest!.id))!
 await db.query("update public.lk_quote_analysis_jobs set lease_expires_at=now()-interval '1 second' where id=$1",[job.id])
 const current=await workspace();
 assert.equal(await claim(job.id),null);assert.equal(current.latest!.status,'uncertain')
 const late=await media('analysis_finish',completion(job));assert.equal(late.latest!.status,'uncertain');assert.equal(late.latest!.analysis,null)
 assert.equal((await start()).latest!.id,job.id,'No automatic paid retry')
 const second=await start(2,{retryOf:job.id});assert.equal(second.latest!.attempts,2)
 const attempt=(await claim(second.latest!.id))!
 await media('analysis_fail',{jobId:attempt.id,leaseToken:attempt.leaseToken,status:'failed',error:'Analysis could not be validated. Please review the photos.',usage:{inputTokens:500,outputTokens:30},providerResponseId:'resp_invalid'})
 const failed=(await media<Job>('analysis_get',{jobId:attempt.id})) as Job & {usage:{inputTokens:number};providerResponseId:string}
 assert.equal(failed.usage.inputTokens,500);assert.equal(failed.providerResponseId,'resp_invalid')
 await assert.rejects(start(2,{retryOf:job.id}),code('LK409'))
 const third=await start(2,{retryOf:attempt.id});assert.equal(third.latest!.attempts,3)
 const thirdJob=(await claim(third.latest!.id))!
 await media('analysis_fail',{jobId:thirdJob.id,leaseToken:thirdJob.leaseToken,status:'uncertain',error:'Provider outcome unknown.'})
 await assert.rejects(start(2,{retryOf:thirdJob.id}),code('LK429'));assert.equal(await count('lk_quote_analysis_jobs'),3)
})

test('stale completion preserves historical manifest while changed current photos/details cannot receive old result',async()=> {
 const initial=await ready(),s=await start(),job=(await claim(s.latest!.id))!
 const removed=await media('photo_remove',write(2,{photoId:initial.photos[0].id}));assert.equal(removed.request.revision,3)
 const done=await media('analysis_finish',completion(job));assert.equal(done.latest!.stale,true);assert.equal(done.photos.length,0)
 assert.equal(done.latest!.manifest[0].id,initial.photos[0].id)
 const photo=(await db.query<{state:string}>('select state from public.lk_live_quote_photos')).rows[0];assert.equal(photo.state,'deleted')
 await assert.rejects(media('photo_lookup',{ownerHash:ownerA,photoId:initial.photos[0].id}),code('LK404'))
 assert.equal((await media<Photo>('staff_photo',{...actor,id:initial.request.id,photoId:initial.photos[0].id})).id,initial.photos[0].id)
 const p=await begin(3);await finalize(p.id,3);const latest=await start(4)
 assert.equal(latest.latest!.stale,false);assert.notEqual(latest.latest!.id,job.id);assert.equal(latest.jobs.length,2)
})

test('global and owner paid request limits rollback atomically; exact replay and same-input reuse cost no additional job',async()=> {
 await ready();const values=startInput(),one=await media('analysis_start',values)
 await db.query("update public.lk_rate_buckets set count=20 where bucket='live-analysis:start:global'")
 assert.deepEqual(await media('analysis_start',values),one);assert.equal((await start()).latest!.id,one.latest!.id)
 await assert.rejects(start(2,{promptVersion:'new-version'}),code('LK429'))
 assert.equal(await count('lk_quote_analysis_jobs'),1)
 await db.query("update public.lk_rate_buckets set count=1 where bucket='live-analysis:start:global'")
 await db.query("update public.lk_rate_buckets set count=3 where bucket=$1",['live-analysis:start:'+ownerA])
 await assert.rejects(start(2,{promptVersion:'new-version'}),code('LK429'))
 assert.equal((await db.query<{count:number}>("select count from public.lk_rate_buckets where bucket='live-analysis:start:global'")).rows[0].count,1,'Global reservation rolls back when owner limit fails')
})

test('write rate limits preserve exact photo receipts and do not leave half-finalized objects',async()=> {
 await create();const p=await begin(),values=write(1,{photoId:p.id,contentHash:hash(p.id),width:640,height:480,storedBytes:900})
 await db.query("update public.lk_rate_buckets set count=60 where bucket=$1",['live-quote-requests:write:'+ownerA])
 await assert.rejects(media('photo_finalize',values),code('LK429'))
 assert.equal((await workspace()).photos[0].state,'uploading');assert.equal((await workspace()).request.revision,1)
 await db.query("update public.lk_rate_buckets set count=59 where bucket=$1",['live-quote-requests:write:'+ownerA])
 const saved=await media('photo_finalize',values);assert.deepEqual(await media('photo_finalize',values),saved)
})

test('parallel reservation/finalization and claim calls have one winning revision and provider lease',async()=> {
 await create();const p=await begin();const finals=await Promise.allSettled([finalize(p.id),finalize(p.id)])
 assert.equal(finals.filter(f=>f.status==='fulfilled').length,1);assert.equal((await workspace()).request.revision,2)
 const queued=await start();const claims=await Promise.all([claim(queued.latest!.id),claim(queued.latest!.id)])
 assert.equal(claims.filter(Boolean).length,1)
})


test('staff polling and restarted worker queue sweep expired leases without requeue or duplicate timeout audit',async()=> {
 const w=await ready()
 for(const command of ['staff_workspace','queued_jobs']) {
  const queued=await start(2,{promptVersion:'sweep-'+command}),job=(await claim(queued.latest!.id))!
  await db.query("update public.lk_quote_analysis_jobs set lease_expires_at=now()-interval '1 second' where id=$1",[job.id])
  if(command==='staff_workspace') {
   const current=await media(command,{...actor,id:w.request.id});assert.equal(current.latest!.status,'uncertain')
  } else assert.deepEqual(await media(command,{limit:5}),[])
  assert.equal((await media<Job>('analysis_get',{jobId:job.id})).status,'uncertain')
 }
 assert.equal((await db.query<{n:number}>("select count(*)::integer n from public.lk_quote_media_audit where action='analysis_expired'")).rows[0].n,2)
 await media('queued_jobs',{limit:5});await media('staff_workspace',{...actor,id:w.request.id})
 assert.equal((await db.query<{n:number}>("select count(*)::integer n from public.lk_quote_media_audit where action='analysis_expired'")).rows[0].n,2)
 assert.equal(await count('lk_quote_analysis_jobs'),2)
})

test('new pricing version saves only checked integer cents, GST and immutable calculation results',async()=>{
 await ready();const started=await start(2,{pricingVersion:QUOTE_PRICING_VERSION});const job=(await claim(started.latest!.id))!;
 const a=priceAnalysis(job);const pricing=calculateEstimatePricing(a,service);
 assert.equal(pricing.status,'estimate_ready');assert.equal(pricing.subtotal,175000);assert.equal(pricing.tax,17500);assert.equal(pricing.total,192500);
 const values=completion(job,{analysis:a,pricing});
 const missingTax:Partial<typeof pricing>={...pricing};delete missingTax.tax;
 for(const bad of [missingTax,{...pricing,total:1},{...pricing,tax:0},{...pricing,pricingVersion:'unconfigured'},{...pricing,lineItems:[...pricing.lineItems,pricing.lineItems.at(-1)]},{...pricing,lineItems:pricing.lineItems.map(x=>({...x,amount:x.amount+1}))},pendingCompanyPricing()])await assert.rejects(media('analysis_finish',{...values,pricing:bad}),code('LK400'));
 const doubled={...pricing,lineItems:pricing.lineItems.map(item=>item.code==='moderate_repairs'?{...item,quantity:2,amount:50000}:item),subtotal:200000,tax:20000,total:220000};await assert.rejects(media('analysis_finish',{...values,pricing:doubled}),code('LK400'));
 const done=await media('analysis_finish',values);assert.deepEqual(done.latest!.pricing,pricing);assert.deepEqual(await media('analysis_finish',values),done);assert.equal((await start(2,{pricingVersion:QUOTE_PRICING_VERSION})).latest!.id,job.id);
 await assert.rejects(media('analysis_finish',{...values,pricing:{...pricing,notice:'Changed'}}),code('LK409'));
 assert.equal((await db.query<{n:number}>("select count(*)::integer n from public.lk_quote_media_audit where action='analysis_finish'")).rows[0].n,1);
})
test('pricing review stores starting subtotal only, severe and insufficient-photo forged ready money is refused',async()=>{
 await ready();const started=await start(2,{pricingVersion:QUOTE_PRICING_VERSION});const job=(await claim(started.latest!.id))!;
 const readyAnalysis=priceAnalysis(job),readyPricing=calculateEstimatePricing(readyAnalysis,service);
 const lowQuality={...readyAnalysis,outcome:'additional_photos_required' as const};
 const severe={...readyAnalysis,observedDamage:readyAnalysis.observedDamage.map(item=>({...item,severity:'severe' as const}))};
 for(const badAnalysis of [lowQuality,severe,{...readyAnalysis,quantities:{...readyAnalysis.quantities,doors:{observed:4,customer:5,needsConfirmation:true}}}])await assert.rejects(media('analysis_finish',completion(job,{analysis:badAnalysis,pricing:readyPricing})),code('LK400'));
 const reviewPricing=calculateEstimatePricing(lowQuality,service);const values=completion(job,{analysis:lowQuality,pricing:reviewPricing});
 const result=await media('analysis_finish',values);assert.deepEqual(result.latest!.pricing,reviewPricing);assert.equal(reviewPricing.total,null);assert.deepEqual(await media('analysis_finish',values),result);
})
test('legacy queued jobs cannot accept the new price version and new version keys preserve earlier history',async()=>{
 await ready();const previous=await start();const oldJob=(await claim(previous.latest!.id))!;
 await assert.rejects(media('analysis_finish',completion(oldJob,{analysis:priceAnalysis(oldJob),pricing:calculateEstimatePricing(priceAnalysis(oldJob),service)})),code('LK400'));
 const oldResult=await media('analysis_finish',completion(oldJob));const current=await start(2,{pricingVersion:QUOTE_PRICING_VERSION});assert.notEqual(current.latest!.id,oldJob.id);assert.equal(current.jobs.length,2);assert.deepEqual(current.jobs.find(j=>j.id===oldJob.id)!.pricing,oldResult.latest!.pricing);
})
function priceAnalysis(job:Job): PhotoAnalysis {
 const photoId=job.manifest[0].id;
 return {summary:'Synthetic observed coating wear.',outcome:'analysis_ready',photoQuality:[{photoId,usable:true,issues:[],retakeInstruction:null}],coverage:PHOTO_ROLES.map(role=>({role,covered:true,photoIds:[photoId],note:'Synthetic coverage.'})),observedDamage:['edge-1','edge-2'].map(id=>({id,kind:'chipping' as const,location:id,description:'Visible coating damage.',photoIds:[photoId],severity:'moderate' as const})),quantities:{doors:{observed:5,customer:5,needsConfirmation:false},drawers:{observed:2,customer:2,needsConfirmation:false}},proposedWork:[],unknowns:[],siteChecks:[]};
}

for(const scenario of [{label:'unselected drawers',surfaces:['doors'],doorCount:8,drawerCount:3},{label:'repair-only surfaces',surfaces:['repairs'],doorCount:12,drawerCount:4}])test(`DB rejects ready prices charging ${scenario.label} and stores scope review`,async()=>{
 const selected={...service,surfaces:scenario.surfaces,doorCount:scenario.doorCount,drawerCount:scenario.drawerCount};
 await create(ownerA,selected);const photo=await begin();await finalize(photo.id);const queued=await start(2,{pricingVersion:QUOTE_PRICING_VERSION});const job=(await claim(queued.latest!.id))!;
 const input=priceAnalysis(job);input.quantities.doors={observed:scenario.doorCount,customer:scenario.doorCount,needsConfirmation:false};input.quantities.drawers={observed:scenario.drawerCount,customer:scenario.drawerCount,needsConfirmation:false};
 const wholeCabinetPrice=calculateEstimatePricing(input,{...selected,surfaces:['doors','drawers']});assert.equal(wholeCabinetPrice.status,'estimate_ready');
 await assert.rejects(media('analysis_finish',completion(job,{analysis:input,pricing:wholeCabinetPrice})),code('LK400'));
 const review=calculateEstimatePricing(input,selected);assert.equal(review.status,'review_required');const values=completion(job,{analysis:input,pricing:review});const done=await media('analysis_finish',values);assert.deepEqual(done.latest!.pricing,review);assert.equal(review.total,null);assert.deepEqual(await media('analysis_finish',values),done);
});
