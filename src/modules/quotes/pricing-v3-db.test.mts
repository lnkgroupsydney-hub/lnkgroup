import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { calculateEstimatePricing, calculatePreviousEstimatePricing, calculateLegacyEstimatePricing, QUOTE_PRICING_VERSION, PREVIOUS_QUOTE_PRICING_VERSION, LEGACY_QUOTE_PRICING_VERSION } from './domain/pricing.ts'
import { PHOTO_ROLES, type ProvisionalPhotoAnalysis } from './domain/analysis.ts'
import type { InternalPhotoWorkspace, InternalPhoto, InternalAnalysisJob } from './domain/photo-workspace.ts'
import type { LiveBookingState } from './domain/booking-flow.ts'
import type { ServiceDetails } from './domain/contracts.ts'
import type { LiveCompanyState, LiveCompanyWorkerClaim } from '../bookings/domain/live-contracts.ts'
import { initializeCompanyFixtureAuth, seedCompanyFixture, companyRpc, companyProof, companyTarget } from '../bookings/infrastructure/live-test-fixtures.mts'
const companyId='lk-group',hash=(s:string)=>createHash('sha256').update(s).digest('hex')
const service:ServiceDetails={serviceId:'cabinet-painting',intent:'full-repainting',surfaces:['doors','drawers'],doorCount:2,drawerCount:1,material:'',colourPreference:''}
const payload={contact:{name:'Synthetic customer',email:'synthetic@example.invalid',siteAddress:'Synthetic street',suburb:'Synthetic',postcode:'2000',consent:true},service}
const migrationNames=readdirSync(new URL('../../../supabase/migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()
const migration=(name:string)=>readFileSync(new URL(`../../../supabase/migrations/${name}`,import.meta.url),'utf8')
const newMigration=migrationNames.find(n=>n.endsWith('_live_quote_no_gst_pricing_v3.sql'))!
const errorCode=(expected:string)=>(error:unknown)=>!!error&&typeof error==='object'&&'code' in error&&error.code===expected
function analysis(job:InternalAnalysisJob):ProvisionalPhotoAnalysis {
 const id=job.manifest[0].id
 return {summary:'Synthetic cabinet fronts.',outcome:'analysis_ready',photoQuality:job.manifest.map(p=>({photoId:p.id,usable:true,issues:[],retakeInstruction:null})),coverage:PHOTO_ROLES.map(role=>({role,covered:true,photoIds:[id],note:'Synthetic evidence.'})),observedDamage:[],quantities:{doors:{observed:2,customer:2,needsConfirmation:false,estimated:2,basisPhotoIds:[id],confidence:'medium',note:'Synthetic.'},drawers:{observed:1,customer:1,needsConfirmation:false,estimated:1,basisPhotoIds:[id],confidence:'medium',note:'Synthetic.'}},proposedWork:[],unknowns:[],siteChecks:[],estimateScope:{status:'estimable',extent:'whole_project',anchorPhotoId:id,scopePhotoIds:job.manifest.map(p=>p.id),contextPhotoIds:[],conflictingPhotoIds:[],description:'Synthetic scope.',assumptions:[]}}
}
test('v3 migration preserves populated history, freezes request policy and accepts only exact versioned money through analysis and booking',async()=>{
 const db=new PGlite()
 try {
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);')
  for(const name of migrationNames.filter(n=>n!==newMigration))await db.exec(migration(name))
  const rpc=async<T>(fn:string,command:string,args:Record<string,unknown>)=>(await db.query<{result:T}>(`select public.${fn}($1,$2::jsonb) result`,[command,JSON.stringify({companyId,...args})])).rows[0].result
  const media=<T=InternalPhotoWorkspace>(command:string,args:Record<string,unknown>)=>rpc<T>('lk_quote_media_command',command,args)
  const save=(ownerHash:string,expectedRevision=0)=>rpc<InternalPhotoWorkspace['request']>('lk_quote_requests_command','save',{ownerHash,expiresAt:new Date(Date.now()+86400000).toISOString(),expectedRevision,idempotencyKey:randomUUID(),payload,storageConsent:true,consentVersion:'quote-storage-review-v1'})
  async function ready(ownerHash:string){const r=await save(ownerHash);const p=await media<InternalPhoto>('photo_begin',{ownerHash,expectedRevision:1,idempotencyKey:randomUUID(),role:'overview',mimeType:'image/jpeg',sizeBytes:1000,sourceHash:hash(ownerHash)});await media('photo_finalize',{ownerHash,expectedRevision:1,idempotencyKey:randomUUID(),photoId:p.id,contentHash:hash(p.id),width:640,height:480,storedBytes:900});return r}
  const input=(ownerHash:string,pricingVersion:string,expectedRevision=2)=>({ownerHash,expectedRevision,idempotencyKey:randomUUID(),aiConsentVersion:'openai-photo-analysis-v1',model:'gpt-6.1-sol',promptVersion:'cabinet-observations-v3',schemaVersion:'cabinet-photo-analysis-v2',pricingVersion,coverage:{upperNotApplicable:false,damageNotPresent:false}})
  const claim=(jobId:string)=>media<InternalAnalysisJob>('analysis_claim',{jobId,leaseToken:randomUUID()})
  const finish=(job:InternalAnalysisJob,pricing:unknown)=>media('analysis_finish',{jobId:job.id,leaseToken:job.leaseToken,analysis:analysis(job),pricing,usage:{inputTokens:100,outputTokens:50},providerResponseId:'synthetic-'+job.id})
  await db.exec('set role service_role')
  const oldOwner=hash('historical request'),oldRequest=await ready(oldOwner),oldQueued=await media('analysis_start',input(oldOwner,PREVIOUS_QUOTE_PRICING_VERSION)),oldJob=await claim(oldQueued.latest!.id)
  const v1Owner=hash('historical v1'),v1Request=await ready(v1Owner),v1Queued=await media('analysis_start',{...input(v1Owner,LEGACY_QUOTE_PRICING_VERSION),schemaVersion:'cabinet-photo-analysis-v1',promptVersion:'cabinet-observations-v2'}),v1Job=await claim(v1Queued.latest!.id)
  const snapshot=async()=>{
   const result:Record<string,unknown>={}
   for(const table of ['lk_quote_requests','lk_quote_request_audit','lk_live_quote_photos','lk_quote_analysis_jobs','lk_quote_media_receipts','lk_quote_media_audit','lk_live_quote_approvals','lk_live_quote_submissions'])result[table]=(await db.query(`select ${table==='lk_quote_requests'?"to_jsonb(t)-'pricing_version'":'to_jsonb(t)'} row from public.${table} t order by to_jsonb(t)::text`)).rows
   return hash(JSON.stringify(result))
  }
  await db.exec('reset role');await initializeCompanyFixtureAuth(db);const historicalBooking=await seedCompanyFixture(db,{simple:true,email:'historical@example.invalid'});
  const preserved=await snapshot();await db.exec('reset role');await db.exec(migration(newMigration));await db.exec('set role service_role');assert.equal(await snapshot(),preserved)
  assert.equal((await media('workspace',{ownerHash:oldOwner})).request.pricingVersion,PREVIOUS_QUOTE_PRICING_VERSION)
  await assert.rejects(db.query('update public.lk_quote_requests set pricing_version=$1 where id=$2',[QUOTE_PRICING_VERSION,oldRequest.id]),errorCode('LK409'))
  const oldPrice=calculatePreviousEstimatePricing(analysis(oldJob),service);assert.equal(oldPrice.total,165000);assert.equal((await finish(oldJob,oldPrice)).latest!.status,'succeeded')
  const legacyPrice=calculateLegacyEstimatePricing(analysis(v1Job),service);assert.equal(legacyPrice.total,165000);assert.equal((await finish(v1Job,legacyPrice)).latest!.status,'succeeded')
  await assert.rejects(media('analysis_start',input(oldOwner,QUOTE_PRICING_VERSION)),errorCode('LK409'))
  await save(oldOwner,2);const rerun=await media('analysis_start',input(oldOwner,PREVIOUS_QUOTE_PRICING_VERSION,3));assert.equal(rerun.latest!.inputSnapshot.pricingVersion,PREVIOUS_QUOTE_PRICING_VERSION)
  const newOwner=hash('new v3'),newRequest=await ready(newOwner);assert.equal(newRequest.pricingVersion,QUOTE_PRICING_VERSION)
  await assert.rejects(media('photo_lookup',{ownerHash:newOwner,photoId:oldJob.manifest[0].id}),errorCode('LK404'))
  await assert.rejects(media('analysis_start',input(newOwner,PREVIOUS_QUOTE_PRICING_VERSION)),errorCode('LK409'))
  const args=input(newOwner,QUOTE_PRICING_VERSION),queued=await media('analysis_start',args);assert.deepEqual(await media('analysis_start',args),queued)
  const newJob=await claim(queued.latest!.id),price=calculateEstimatePricing(analysis(newJob),service);assert.equal(price.total,145000);assert.equal(price.tax,0)
  for(const forged of [{...price,tax:14500,total:159500},{...price,gstRateBps:1000},{...price,minimumSubtotal:150000},calculatePreviousEstimatePricing(analysis(newJob),service)])await assert.rejects(finish(newJob,forged),errorCode('LK400'))
  const done=await finish(newJob,price);assert.equal(done.latest!.status,'succeeded');assert.deepEqual(await finish(newJob,price),done)
  for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(media('workspace',{ownerHash:newOwner}),errorCode('42501'));await assert.rejects(db.query("select public.lk_quote_pricing_v3_valid('{}','{}','{}','[]')"),errorCode('42501'));await assert.rejects(db.query('select * from public.lk_quote_analysis_jobs'),errorCode('42501'))}
  await db.exec('reset role');await initializeCompanyFixtureAuth(db)
  const fixture=await seedCompanyFixture(db,{simple:true,pricingVersion:QUOTE_PRICING_VERSION,email:'synthetic@example.invalid'})
  await db.exec('reset role');await db.query("insert into public.lk_quote_request_access(company_id,request_id,auth_user_id,verified_email,verified_at) values('lk-group',$1,$2,$3,now())",[newRequest.id,fixture.userId,fixture.email]);await db.exec('set role service_role')
  const customerArgs={ownerHash:newOwner,expectedRequestId:newRequest.id,customerAccess:{...fixture.customerArgs.customerAccess,requestId:newRequest.id}}
  const booking=(command:string,args:Record<string,unknown>)=>rpc<LiveBookingState>('lk_live_quote_booking_command',command,{...customerArgs,...args})
  const approved=await booking('approve',{analysisId:newJob.id,expectedRevision:2,idempotencyKey:randomUUID(),calendarTarget:companyTarget,acknowledgmentVersion:'live-booking-request-ack-v2'})
  const takeOffDate=new Date(Date.now()+30*86400000).toISOString().slice(0,10),installDate=new Date(Date.now()+37*86400000).toISOString().slice(0,10)
  const dateCheck={...companyTarget,revision:'availability-v1',checkedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()}
  await booking('date',{approvalId:approved.approval!.id,preferredDate:takeOffDate,preferredTime:'09:00',availabilityRevision:'availability-v1',idempotencyKey:randomUUID(),dateCheck})
  const review=await rpc<{approvalId:string;selectionRevision:number;snapshotHash:string}>('lk_live_quote_booking_command','review',{...customerArgs,approvalId:approved.approval!.id,selectionRevision:1})
  const submitArgs={...review,reviewExpiresAt:new Date(Date.now()+900000).toISOString(),signature:fixture.signature,idempotencyKey:randomUUID(),dateCheck}
  const submitted=await booking('submit',submitArgs);assert.deepEqual(await booking('submit',submitArgs),submitted);assert.equal(submitted.submission!.snapshot.pricing.total,145000);assert.equal(submitted.submission!.snapshot.pricing.tax,0)
  const signedSnapshot=submitted.submission!.snapshot
  const confirmArgs={...fixture.staffArgs,requestId:newRequest.id,expectedRevision:0,idempotencyKey:randomUUID(),takeOffEndLocal:takeOffDate+'T10:00',installStartLocal:installDate+'T09:00',installEndLocal:installDate+'T11:00',companyNote:'Synthetic: discuss any additional damage before proceeding.'}
  const prepared=await companyRpc<{hash:string;gst:number;total:number}>(db,'staff_prepare_request',confirmArgs);assert.equal(prepared.gst,0);assert.equal(prepared.total,145000)
  const confirmed=await companyRpc<LiveCompanyState>(db,'staff_confirm_request',{...confirmArgs,calendarCheck:companyProof(prepared.hash)});assert.equal(confirmed.proposal!.total,145000);assert.equal(confirmed.proposal!.gst,0);assert.deepEqual(confirmed.submission.snapshot,signedSnapshot)
  const leaseToken=randomUUID(),worker=await companyRpc<LiveCompanyWorkerClaim>(db,'worker_claim',{requestId:newRequest.id,leaseToken})
  for(const event of worker.booking!.events)await companyRpc(db,'record_event',{id:worker.id,leaseToken,...event,payloadHash:'a'.repeat(64),etag:'synthetic-etag'})
  const final=await companyRpc<LiveCompanyWorkerClaim>(db,'finish_calendar',{id:worker.id,leaseToken,calendarCheck:companyProof(prepared.hash)});assert.equal(final.booking!.status,'confirmed');assert.equal(final.proposal!.gst,0)
  assert.equal((await media('workspace',{ownerHash:v1Owner})).request.id,v1Request.id)
  const oldSigned=(await db.query<{snapshot:unknown;snapshot_hash:string}>('select snapshot,snapshot_hash from public.lk_live_quote_submissions where id=$1',[historicalBooking.submissionId])).rows[0];assert.deepEqual(oldSigned.snapshot,historicalBooking.snapshot);assert.equal(oldSigned.snapshot_hash,(await db.query<{hash:string}>('select public.lk_live_booking_hash($1::jsonb) hash',[JSON.stringify(historicalBooking.snapshot)])).rows[0].hash)
 } finally {await db.close()}
})
