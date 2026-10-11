import test, {after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readdirSync,readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import sharp from 'sharp';
import {createQuoteRequestApi} from './infrastructure/api.ts';
import {createQuoteMediaApi} from './infrastructure/media-api.ts';
import {createAnalysisRunner,type PhotoObjectPort} from './application/photo-media.ts';
import {normalizeLivePhoto} from './infrastructure/photo-objects.ts';
import {analyzeCabinetPhotos,PhotoAnalysisError} from './infrastructure/openai-photo-analyzer.ts';
import {AI_CONSENT_VERSION,PHOTO_ROLES,PHOTO_ANALYSIS_MODEL,PHOTO_ANALYSIS_PROMPT_VERSION,PHOTO_ANALYSIS_SCHEMA_VERSION} from './domain/analysis.ts';
import {QUOTE_PRICING_VERSION} from './domain/pricing.ts';
import {QuoteRequestError,type QuoteRequestActor,type LiveQuoteRequest} from './domain/contracts.ts';
import type {InternalPhoto,PhotoWorkspace} from './domain/photo-workspace.ts';

const db=new PGlite();
await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
for(const name of readdirSync(new URL('../../../supabase/migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(`../../../supabase/migrations/${name}`,import.meta.url),'utf8'));
const tables=(await db.query<{tablename:string}>("select tablename from pg_tables where schemaname='public' and tablename like 'lk_%'")).rows.map(row=>row.tablename);
const base='http://127.0.0.1:3002',sessionSecret='95'.repeat(32);
const actor:QuoteRequestActor={companyId:'lk-group',userId:randomUUID(),sessionId:randomUUID()};
const contact={name:'PRIVATE CLIENT',email:'private.client@example.invalid',phone:'',siteAddress:'PRIVATE STREET',suburb:'Synthetic',postcode:'2000',details:'PRIVATE CONTACT NOTES',consent:true};
const service={serviceId:'cabinet-painting' as const,intent:'full-repainting',surfaces:['doors','drawers','repairs'],doorCount:5,drawerCount:2,material:'PRIVATE MATERIAL NOTE',colourPreference:'PRIVATE COLOUR NOTE'};
const original=new Uint8Array(await sharp({create:{width:640,height:480,channels:3,background:'#e6e0d4'}}).jpeg().toBuffer());
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
let enabled=true,aiReady=true,staff:QuoteRequestActor|null=actor,now=Date.now();
let providerCalls=0,objectReadCalls=0,signCalls=0,finishCalls=0,loseFirstCompletion=false,changeAfterProvider:false|(()=>Promise<void>)=false,providerFailure:false|'network'|'refusal'|'missing_usage'|'missing_id'|'low_quality'|'moderate'|'severe'=false;
let sentBody='';
const staging=new Map<string,Uint8Array>(),stored=new Map<string,Uint8Array>();
const commands:string[]=[];
function storeFor(fn:string) {
 return {async command<T>(command:string,args:Record<string,unknown>):Promise<T>{
  commands.push(command);if(command==='analysis_finish') finishCalls++;
  try {
   const value=(await db.query<{result:T}>(`select public.${fn}($1,$2::jsonb) result`,[command,JSON.stringify(args)])).rows[0].result;
   if(command==='analysis_finish'&&loseFirstCompletion){loseFirstCompletion=false;throw new QuoteRequestError(503,'Synthetic response loss after committed completion.');}
   return value;
  } catch(error) {
   if(error instanceof QuoteRequestError)throw error;
   const sql=error as {code:string;message:string};const status=({LK400:400,LK401:401,LK403:403,LK404:404,LK409:409,LK429:429} as Record<string,number>)[sql.code];
   throw new QuoteRequestError(status??503,status?sql.message:'Storage unavailable.');
  }
 }};
}
const requestStore=storeFor('lk_quote_requests_command'),mediaStore=storeFor('lk_quote_media_command');
const requests=createQuoteRequestApi({store:requestStore,enabled:()=>enabled,baseUrl:()=>base,sessionKey:()=>sessionSecret,now:()=>now,authorize:async()=>{if(!staff)throw new QuoteRequestError(401,'Staff authentication required.');return staff;}});
const objects:PhotoObjectPort={
 async signUpload(photo){signCalls++;return{signedUrl:`https://private-storage.invalid/${photo.stagingPath}?token=synthetic`,token:'synthetic-upload-capability',path:photo.stagingPath};},
 async normalize(photo){
  if(photo.state==='ready'&&photo.contentHash){const bytes=await this.read(photo as InternalPhoto&{contentHash:string});return{contentHash:photo.contentHash,width:photo.width!,height:photo.height!,storedBytes:bytes.length};}
  const bytes=staging.get(photo.stagingPath);if(!bytes)throw new QuoteRequestError(503,'Original upload missing.');
  if(bytes.length!==photo.sizeBytes||hash(bytes)!==photo.sourceHash)throw new QuoteRequestError(409,'The uploaded photo did not match the selected file.');
  const result=await normalizeLivePhoto(bytes,photo.mimeType);stored.set(photo.objectPath,result.bytes);return{contentHash:result.contentHash,width:result.width,height:result.height,storedBytes:result.bytes.length};
 },
 async read(photo){objectReadCalls++;const bytes=stored.get(photo.objectPath);if(!bytes||hash(bytes)!==photo.contentHash)throw new QuoteRequestError(409,'Stored photo integrity check failed.');return bytes;},
 async discardStaging(photo){staging.delete(photo.stagingPath);},
};
const fakeProvider=(async(_url,init)=>{
 providerCalls++;sentBody=String(init?.body);
 if(providerFailure==='network')throw new Error('PRIVATE PROVIDER DIAGNOSTICS');
 const input=JSON.parse(sentBody).input[0].content as Array<{type:string;text?:string}>;
 const metadata=JSON.parse(input.find(item=>item.type==='input_text')!.text!);
 const ids=metadata.photos.map((photo:{id:string})=>photo.id);
 if(changeAfterProvider)await changeAfterProvider();
 const analysis:import('./domain/analysis.ts').PhotoAnalysis={summary:'Synthetic visible cabinet condition for transport testing.',outcome:'analysis_ready',photoQuality:ids.map((photoId:string)=>({photoId,usable:true,issues:[],retakeInstruction:null})),coverage:PHOTO_ROLES.map(role=>({role,covered:true,photoIds:ids,note:'Synthetic coverage in provider fixture.'})),observedDamage:[],quantities:{doors:{observed:metadata.service.doorCount,customer:metadata.service.doorCount,needsConfirmation:false},drawers:{observed:metadata.service.drawerCount,customer:metadata.service.drawerCount,needsConfirmation:false}},proposedWork:[{id:'work-preparation',title:'Surface preparation',description:'Check adhesion and prepare visible coating before painting.',photoIds:ids,repairIds:[]}],unknowns:['Hidden substrate needs confirmation.'],siteChecks:['Check adhesion on site.']};
 if(providerFailure==='low_quality'){analysis.outcome='additional_photos_required';analysis.coverage=analysis.coverage.map(x=>x.role==='side'?{...x,covered:false,photoIds:[]}:x);}
 if(providerFailure==='moderate'||providerFailure==='severe')analysis.observedDamage=['edge-1','edge-2'].map(id=>({id,kind:'chipping',location:id,description:'Visible coating damage.',photoIds:ids,severity:providerFailure==='severe'?'severe':'moderate'}));
 return Response.json({id:providerFailure==='missing_id'?null:'resp_transport_fixture',status:'completed',output:[{type:'message',role:'assistant',content:providerFailure==='refusal'?[{type:'refusal',refusal:'PRIVATE PROVIDER REFUSAL'}]:[{type:'output_text',text:JSON.stringify(analysis)}]}],usage:providerFailure==='missing_usage'?null:{input_tokens:1200,output_tokens:300,total_tokens:1500,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:100}}});
}) as typeof fetch;
const runner=createAnalysisRunner({store:mediaStore,objects,analyze:input=>analyzeCabinetPhotos(input,{apiKey:'synthetic-key-only',request:fakeProvider}),classify:error=>error instanceof PhotoAnalysisError?{status:error.status,message:error.message,providerResponseId:error.providerResponseId??undefined,usage:error.usage??undefined}:null});
const api=createQuoteMediaApi({access:requests.access,store:mediaStore,objects,run:runner,aiReady:()=>aiReady});
function req(method:string,cookie?:string,body?:unknown,path='/api/quote/requests/photos',headers:Record<string,string>={}) {
 return new Request(`${base}${path}`,{method,headers:{host:new URL(base).host,origin:base,...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
}
function write(expectedRevision:number,extra:Record<string,unknown>={}) {return{expectedRevision,idempotencyKey:randomUUID(),...extra};}
async function owner() {const response=await requests.session(req('POST',undefined,undefined,'/api/quote/requests/session'));assert.equal(response.status,200);const cookie=response.headers.get('set-cookie')!.split(';')[0];const saved=await requests.save(req('PUT',cookie,{...write(0),payload:{contact,service},storageConsent:true},'/api/quote/requests'));assert.equal(saved.status,200);return{cookie,request:(await saved.json()).request as LiveQuoteRequest};}
async function workspace(cookie:string) {const response=await api.workspace(req('GET',cookie));assert.equal(response.status,200,await response.clone().text());return await response.json() as PhotoWorkspace;}
async function ready(cookie:string,revision=1) {
 const response=await api.begin(req('POST',cookie,write(revision,{role:'overview',mimeType:'image/jpeg',sizeBytes:original.length,sourceHash:hash(original)})));assert.equal(response.status,200,await response.clone().text());
 const begun=await response.json();staging.set(begun.upload.path,original);
 const values=write(revision),finished=await api.finalize(req('POST',cookie,values),begun.photo.id);assert.equal(finished.status,200,await finished.clone().text());
 return{photoId:begun.photo.id as string,finalizeInput:values,workspace:await finished.json() as PhotoWorkspace};
}
function analysisInput(revision=2,extra:Record<string,unknown>={}) {return write(revision,{aiConsentVersion:AI_CONSENT_VERSION,aiConsent:true,coverage:{upperNotApplicable:false,damageNotPresent:false},...extra});}
async function start(cookie:string,revision=2) {const response=await api.start(req('POST',cookie,analysisInput(revision)));assert.equal(response.status,200,await response.clone().text());return await response.json() as PhotoWorkspace;}
async function count(table:string) {return(await db.query<{n:number}>(`select count(*)::integer n from public.${table}`)).rows[0].n;}
beforeEach(async()=>{await db.exec('reset role');await db.exec(`truncate ${tables.map(table=>'public.'+table).join(',')}`);await db.exec('set role service_role');enabled=true;aiReady=true;staff=actor;now=Date.now();providerCalls=0;objectReadCalls=0;signCalls=0;finishCalls=0;loseFirstCompletion=false;changeAfterProvider=false;providerFailure=false;sentBody='';staging.clear();stored.clear();commands.length=0;});
after(async()=>{await db.close();});

test('real request capability and media guards block unauthenticated, CSRF, wrong-host and paused writes before storage',async()=>{
 const {cookie}=await owner();commands.length=0;
 const values=write(1,{role:'overview',mimeType:'image/jpeg',sizeBytes:original.length,sourceHash:hash(original)});
 for(const [request,status] of [[req('POST',undefined,values),401],[req('POST',cookie,values,undefined,{origin:'https://attacker.invalid'}),403],[req('POST',cookie,values,undefined,{host:'attacker.invalid'}),403],[req('POST',cookie,values,undefined,{'sec-fetch-site':'cross-site'}),403]] as const)assert.equal((await api.begin(request)).status,status);
 for(const action of [api.start,api.reopen])assert.equal((await action(req('POST',cookie,values,undefined,{origin:'https://attacker.invalid'}))).status,403);
 for(const action of [api.finalize,api.remove,api.process])assert.equal((await action(req('POST',cookie,values,undefined,{origin:'https://attacker.invalid'}),randomUUID())).status,403);
 assert.equal((await api.content(req('GET',cookie,undefined,undefined,{'sec-fetch-site':'cross-site'}),randomUUID())).status,403);
 enabled=false;assert.equal((await api.begin(req('POST',cookie,values))).status,503);assert.equal(signCalls,0);assert.equal(commands.length,0);
 enabled=true;now+=86_401_000;assert.equal((await api.workspace(req('GET',cookie))).status,401);
});
test('signed reservation, actual image normalization, exact finalization replay and private content share one revision',async()=>{
 const {cookie}=await owner();const values=write(1,{role:'overview',mimeType:'image/jpeg',sizeBytes:original.length,sourceHash:hash(original)});
 const first=await(await api.begin(req('POST',cookie,values))).json(),retry=await(await api.begin(req('POST',cookie,values))).json();assert.equal(first.photo.id,retry.photo.id);assert.equal(await count('lk_live_quote_photos'),1);
 staging.set(first.upload.path,original);const finalValues=write(1),finished=await api.finalize(req('POST',cookie,finalValues),first.photo.id);assert.equal(finished.status,200);const saved=await finished.json();
 assert.equal(saved.request.revision,2);assert.equal(saved.photos[0].state,'ready');assert.equal(staging.size,0);assert.equal(stored.size,1);
 const again=await api.finalize(req('POST',cookie,finalValues),first.photo.id);assert.equal(again.status,200);assert.deepEqual(await again.json(),saved);
 const image=await api.content(req('GET',cookie),first.photo.id);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/jpeg');assert.equal(image.headers.get('cache-control'),'private, no-store');assert.equal(hash(new Uint8Array(await image.arrayBuffer())),saved.photos[0].contentHash);
 assert.ok(!JSON.stringify(saved).includes('stagingPath'));assert.ok(!JSON.stringify(saved).includes('objectPath'));assert.ok(!JSON.stringify(saved).includes('sourceHash'));assert.ok(!JSON.stringify(saved).includes('synthetic-upload-capability'));
});
test('tampered original source hash rejects finalization and retains the saved request revision',async()=>{
 const {cookie}=await owner();const response=await api.begin(req('POST',cookie,write(1,{role:'damage',mimeType:'image/jpeg',sizeBytes:original.length,sourceHash:hash(new Uint8Array([1,2,3]))})));assert.equal(response.status,200);const photo=await response.json();staging.set(photo.upload.path,original);
 assert.equal((await api.finalize(req('POST',cookie,write(1)),photo.photo.id)).status,409);assert.equal((await workspace(cookie)).request.revision,1);assert.equal(stored.size,0);
});
test('known photo/job identifiers do not grant another customer or unauthenticated staff access',async()=>{
 const a=await owner(),uploaded=await ready(a.cookie),job=(await start(a.cookie)).latest!,b=await owner();
 assert.equal((await api.content(req('GET',b.cookie),uploaded.photoId)).status,404);assert.equal((await api.finalize(req('POST',b.cookie,write(1)),uploaded.photoId)).status,404);
 assert.equal((await api.process(req('POST',b.cookie),job.id)).status,404);assert.equal(providerCalls,0);
 assert.equal((await workspace(b.cookie)).jobs.length,0);
 staff=null;assert.equal((await api.staffWorkspace(req('GET'),a.request.id)).status,401);assert.equal((await api.staffContent(req('GET'),a.request.id,uploaded.photoId)).status,401);
 staff={...actor,companyId:'another-company'};assert.equal((await api.staffWorkspace(req('GET'),a.request.id)).status,403);
 staff=actor;assert.equal((await api.staffContent(req('GET'),b.request.id,uploaded.photoId)).status,404);
});
test('explicit AI consent gates jobs; one provider call stores same validated result in customer and EMS without PII',async()=>{
 const {cookie,request}=await owner();await ready(cookie);
 for(const extra of [{aiConsent:false},{aiConsentVersion:'quote-storage-review-v1'},{coverage:{upperNotApplicable:'yes',damageNotPresent:false}}])assert.equal((await api.start(req('POST',cookie,analysisInput(2,extra)))).status,400);
 assert.equal(await count('lk_quote_analysis_jobs'),0);aiReady=false;assert.equal((await api.start(req('POST',cookie,analysisInput()))).status,503);aiReady=true;
 const queued=await start(cookie),process=await api.process(req('POST',cookie),queued.latest!.id);assert.equal(process.status,200,await process.clone().text());const completed=await process.json() as PhotoWorkspace;
 assert.equal(providerCalls,1);assert.equal(completed.latest!.status,'succeeded');assert.equal(completed.latest!.pricing!.status,'estimate_ready');assert.equal(completed.latest!.pricing!.subtotal,150000);assert.equal(completed.latest!.pricing!.tax,15000);assert.equal(completed.latest!.pricing!.total,165000);assert.equal(completed.latest!.usage!.reasoningTokens,100);
 assert.ok(!sentBody.includes('PRIVATE'));assert.ok(!sentBody.includes('private.client@example.invalid'));assert.equal(JSON.parse(sentBody).model,'gpt-6.1-sol');assert.deepEqual(JSON.parse(sentBody).reasoning,{effort:'medium'});
 const company=await(await api.staffWorkspace(req('GET'),request.id)).json();assert.deepEqual(company.latest,completed.latest);assert.notEqual(company.photos[0].contentUrl,completed.photos[0].contentUrl);
 for(const secret of ['inputSnapshot','manifest','leaseToken','ownerHash','objectPath','providerResponseId','inputKey'])assert.ok(!JSON.stringify(completed).includes(secret));
 assert.equal(await count('lk_quote_versions'),0);assert.equal(await count('lk_quote_acceptances'),0);assert.equal(await count('lk_customers'),0);
 const consent=(await db.query<{consent_version:string}>('select consent_version from public.lk_quote_analysis_jobs')).rows[0];assert.equal(consent.consent_version,AI_CONSENT_VERSION);
});
test('completion response loss retries only immutable DB completion, not the paid provider; repeated process/start reuses job',async()=>{
 const {cookie}=await owner();await ready(cookie);const started=await start(cookie);loseFirstCompletion=true;
 const response=await api.process(req('POST',cookie),started.latest!.id);assert.equal(response.status,200,await response.clone().text());assert.equal(providerCalls,1);assert.equal(finishCalls,2);
 assert.equal((await api.process(req('POST',cookie),started.latest!.id)).status,200);assert.equal(providerCalls,1);
 const again=await start(cookie);assert.equal(again.latest!.id,started.latest!.id);assert.equal(await count('lk_quote_analysis_jobs'),1);
 const audit=(await db.query<{n:number}>("select count(*)::integer n from public.lk_quote_media_audit where action='analysis_finish'")).rows[0].n;assert.equal(audit,1);
});
test('late analysis stays historical and stale after an in-flight service edit; latest customer counts retain newer values',async()=>{
 const {cookie}=await owner();await ready(cookie);const queued=await start(cookie);
 changeAfterProvider=async()=>{const response=await requests.save(req('PUT',cookie,{...write(2),payload:{contact,service:{...service,doorCount:7}},storageConsent:true},'/api/quote/requests'));assert.equal(response.status,200);};
 const response=await api.process(req('POST',cookie),queued.latest!.id);assert.equal(response.status,200,await response.clone().text());const done=await response.json() as PhotoWorkspace;
 assert.equal(done.request.revision,3);assert.equal(done.request.payload.service!.doorCount,7);assert.equal(done.latest!.stale,true);assert.equal(done.latest!.analysis!.quantities.doors.customer,5);assert.equal(done.latest!.inputRevision,2);
 const company=await(await api.staffWorkspace(req('GET'),done.request.id)).json();assert.deepEqual(company.latest,done.latest);assert.equal(providerCalls,1);
});
test('corrupted normalized content blocks provider calls and network/refusal failures remain safe without automatic retries',async()=>{
 const {cookie}=await owner();await ready(cookie);const job=(await start(cookie)).latest!;for(const [path]of stored)stored.set(path,new Uint8Array([1,2,3]));
 const corrupted=await api.process(req('POST',cookie),job.id);assert.equal(corrupted.status,200);assert.equal((await corrupted.json()).latest.status,'failed');assert.equal(providerCalls,0);
 const retryInput=analysisInput(2,{retryOf:job.id}),retried=await api.start(req('POST',cookie,retryInput));assert.equal(retried.status,200);
 // Restore the exact normalized bytes, then simulate an uncertain paid response.
 const normalized=await normalizeLivePhoto(original,'image/jpeg');for(const [path]of stored)stored.set(path,normalized.bytes);providerFailure='network';const second=(await retried.json()).latest;
 assert.equal((await api.process(req('POST',cookie),second.id)).status,200);const failed=await workspace(cookie);assert.equal(failed.latest!.status,'uncertain');assert.ok(!failed.latest!.error!.includes('PRIVATE'));assert.equal(providerCalls,1);
 assert.equal((await api.process(req('POST',cookie),second.id)).status,200);assert.equal(providerCalls,1);
 providerFailure='refusal';const third=await api.start(req('POST',cookie,analysisInput(2,{retryOf:second.id})));assert.equal(third.status,200);const thirdJob=(await third.json()).latest;assert.equal((await api.process(req('POST',cookie),thirdJob.id)).status,200);const refused=await workspace(cookie);assert.equal(refused.latest!.status,'failed');assert.ok(!refused.latest!.error!.includes('PRIVATE'));assert.equal(refused.latest!.usage!.inputTokens,1200);
});
test('completed provider output missing usage or response ID is safely failed before publication or DB finish retries',async()=>{
 for(const missing of ['missing_usage','missing_id'] as const) {
  const {cookie}=await owner();await ready(cookie);const job=(await start(cookie)).latest!;providerFailure=missing;
  const response=await api.process(req('POST',cookie),job.id);assert.equal(response.status,200,await response.clone().text());const current=await response.json() as PhotoWorkspace;
  assert.equal(current.latest!.status,'failed');assert.equal(current.latest!.analysis,null);assert.equal(current.latest!.pricing,null);assert.match(current.latest!.error!,/verifiable usage metadata/);
  assert.equal(finishCalls,0);assert.equal((await api.process(req('POST',cookie),job.id)).status,200);
 }
 assert.equal(providerCalls,2);assert.equal(finishCalls,0);
});


test('insufficient photos and severe damage publish saved review-only results; moderate repairs charge once',async()=>{
 for(const failure of ['low_quality','severe','moderate'] as const){
  const {cookie,request}=await owner();await ready(cookie);providerFailure=failure;const queued=await start(cookie);const response=await api.process(req('POST',cookie),queued.latest!.id);assert.equal(response.status,200,await response.clone().text());const done=await response.json() as PhotoWorkspace;assert.equal(done.latest!.status,'succeeded');assert.equal(done.latest!.pricing!.pricingVersion,QUOTE_PRICING_VERSION);
  if(failure==='moderate'){assert.equal(done.latest!.pricing!.total,192500);assert.equal(done.latest!.pricing!.lineItems.filter(x=>x.code==='moderate_repairs').length,1);}
  else{assert.equal(done.latest!.pricing!.status,'review_required');assert.equal(done.latest!.pricing!.total,null);assert.deepEqual(done.latest!.pricing!.lineItems,[]);}
  const company=await(await api.staffWorkspace(req('GET'),request.id)).json();assert.deepEqual(company.latest,done.latest);
 }
 assert.equal(providerCalls,3);
});
test('queued unconfigured pricing with the current execution contract retains historical pending pricing',async()=>{
 const {cookie}=await owner();await ready(cookie);const current=await workspace(cookie);
 const queued=await db.query<{id:string}>("select owner_hash id from public.lk_quote_requests where id=$1",[current.request.id]);const ownerHash=queued.rows[0].id;
 const pending=await mediaStore.command<import('./domain/photo-workspace.ts').InternalPhotoWorkspace>('analysis_start',{companyId:'lk-group',ownerHash,expectedRevision:2,idempotencyKey:randomUUID(),aiConsentVersion:AI_CONSENT_VERSION,model:PHOTO_ANALYSIS_MODEL,promptVersion:PHOTO_ANALYSIS_PROMPT_VERSION,schemaVersion:PHOTO_ANALYSIS_SCHEMA_VERSION,pricingVersion:'unconfigured',coverage:{upperNotApplicable:false,damageNotPresent:false}});
 const response=await api.process(req('POST',cookie),pending.latest!.id);assert.equal(response.status,200,await response.clone().text());const done=await response.json() as PhotoWorkspace;assert.equal(done.latest!.pricing!.status,'awaiting_company_rates');assert.equal(done.latest!.pricing!.total,null);assert.equal(providerCalls,1);
});
test('obsolete queued prompt fails before photo reads or paid calls; explicit retry uses the current contract',async()=>{
 const {cookie}=await owner();await ready(cookie);const current=await workspace(cookie),ownerHash=(await db.query<{owner_hash:string}>('select owner_hash from public.lk_quote_requests where id=$1',[current.request.id])).rows[0].owner_hash;
 const pending=await mediaStore.command<import('./domain/photo-workspace.ts').InternalPhotoWorkspace>('analysis_start',{companyId:'lk-group',ownerHash,expectedRevision:2,idempotencyKey:randomUUID(),aiConsentVersion:AI_CONSENT_VERSION,model:PHOTO_ANALYSIS_MODEL,promptVersion:'cabinet-observations-v1',schemaVersion:PHOTO_ANALYSIS_SCHEMA_VERSION,pricingVersion:QUOTE_PRICING_VERSION,coverage:{upperNotApplicable:false,damageNotPresent:false}});
 const stopped=await api.process(req('POST',cookie),pending.latest!.id);assert.equal(stopped.status,200);const failed=await stopped.json() as PhotoWorkspace;
 assert.equal(failed.latest!.status,'failed');assert.match(failed.latest!.error!,/version changed.*Explicitly retry/);assert.equal(failed.latest!.usage,null);assert.equal(failed.latest!.analysis,null);assert.equal(objectReadCalls,0);assert.equal(providerCalls,0);assert.equal(finishCalls,0);
 assert.equal((await api.process(req('POST',cookie),pending.latest!.id)).status,200);assert.equal(providerCalls,0);
 const restarted=await api.start(req('POST',cookie,analysisInput(2,{retryOf:pending.latest!.id})));assert.equal(restarted.status,200);const next=await restarted.json() as PhotoWorkspace;assert.notEqual(next.latest!.id,pending.latest!.id);
 const finished=await api.process(req('POST',cookie),next.latest!.id);assert.equal(finished.status,200);const done=await finished.json() as PhotoWorkspace;assert.equal(done.latest!.status,'succeeded');assert.equal(providerCalls,1);assert.equal(done.jobs.find(job=>job.id===pending.latest!.id)!.status,'failed');
 const snapshot=JSON.stringify(done.latest);assert.equal((await api.process(req('POST',cookie),next.latest!.id)).status,200);assert.equal(JSON.stringify((await workspace(cookie)).latest),snapshot);assert.equal(providerCalls,1);
});

async function legacyFailure(cookie:string,status:'failed'|'uncertain',versions:Record<string,string>={}) {
 const current=await workspace(cookie),ownerRow=await db.query<{owner_hash:string}>('select owner_hash from public.lk_quote_requests where id=$1',[current.request.id]);
 const queued=await mediaStore.command<import('./domain/photo-workspace.ts').InternalPhotoWorkspace>('analysis_start',{companyId:'lk-group',ownerHash:ownerRow.rows[0].owner_hash,expectedRevision:current.request.revision,idempotencyKey:randomUUID(),aiConsentVersion:AI_CONSENT_VERSION,model:'gpt-6.1-sol',promptVersion:'cabinet-observations-v1',schemaVersion:'cabinet-photo-analysis-v1',pricingVersion:'unconfigured',...versions,coverage:{upperNotApplicable:false,damageNotPresent:false}});
 const leaseToken=randomUUID();const claimed=await mediaStore.command<import('./domain/photo-workspace.ts').InternalAnalysisJob>('analysis_claim',{companyId:'lk-group',jobId:queued.latest!.id,leaseToken});
 await mediaStore.command('analysis_fail',{companyId:'lk-group',jobId:claimed.id,leaseToken,status,error:'Synthetic legacy failure without provider call.'});return claimed.id;
}
for(const status of ['failed','uncertain'] as const)test(`explicit ${status} legacy retry starts the new version and exact response-loss replay returns one job`,async()=>{
 const {cookie}=await owner();await ready(cookie);const legacyId=await legacyFailure(cookie,status),input=analysisInput(2,{retryOf:legacyId});
 const first=await api.start(req('POST',cookie,input));assert.equal(first.status,200,await first.clone().text());const started=await first.json() as PhotoWorkspace;assert.notEqual(started.latest!.id,legacyId);assert.equal(started.latest!.status,'queued');assert.equal(started.jobs.find(job=>job.id===legacyId)!.status,status);
 const repeated=await api.start(req('POST',cookie,input));assert.equal(repeated.status,200,await repeated.clone().text());assert.deepEqual(await repeated.json(),started);assert.equal(await count('lk_quote_analysis_jobs'),2);assert.equal(providerCalls,0);
 const row=(await db.query<{pricing_version:string}>('select pricing_version from public.lk_quote_analysis_jobs where id=$1',[started.latest!.id])).rows[0];assert.equal(row.pricing_version,QUOTE_PRICING_VERSION);
});
for(const version of ['promptVersion','schemaVersion'] as const)test(`explicit retry after ${version} update creates one new job and preserves exact replay`,async()=>{
 const {cookie}=await owner();await ready(cookie);
 const versions={model:PHOTO_ANALYSIS_MODEL,promptVersion:PHOTO_ANALYSIS_PROMPT_VERSION,schemaVersion:PHOTO_ANALYSIS_SCHEMA_VERSION,pricingVersion:QUOTE_PRICING_VERSION,[version]:`${version}-previous`};
 const oldId=await legacyFailure(cookie,'failed',versions),input=analysisInput(2,{retryOf:oldId});
 const first=await api.start(req('POST',cookie,input));assert.equal(first.status,200,await first.clone().text());const started=await first.json() as PhotoWorkspace;
 assert.notEqual(started.latest!.id,oldId);assert.equal(started.latest!.attempts,1);assert.equal(started.jobs.find(job=>job.id===oldId)!.status,'failed');
 const replay=await api.start(req('POST',cookie,input));assert.equal(replay.status,200);assert.deepEqual(await replay.json(),started);
 const row=(await db.query<{retry_of:string|null,prompt_version:string}>('select retry_of,prompt_version from public.lk_quote_analysis_jobs where id=$1',[started.latest!.id])).rows[0];assert.equal(row.retry_of,null);assert.equal(row.prompt_version,PHOTO_ANALYSIS_PROMPT_VERSION);assert.equal(await count('lk_quote_analysis_jobs'),2);assert.equal(providerCalls,0);
});
test('legacy retries reject foreign, unknown, stale and nonfailed jobs before creating a new priced job',async()=>{
 const a=await owner();await ready(a.cookie);const legacyId=await legacyFailure(a.cookie,'failed');const b=await owner();await ready(b.cookie);
 for(const retryOf of [legacyId,randomUUID()])assert.equal((await api.start(req('POST',b.cookie,analysisInput(2,{retryOf})))).status,404);
 assert.equal((await api.start(req('POST',a.cookie,analysisInput(1,{retryOf:legacyId})))).status,409);
 const changed=await requests.save(req('PUT',a.cookie,{...write(2),payload:{contact,service:{...service,doorCount:7}},storageConsent:true},'/api/quote/requests'));assert.equal(changed.status,200);
 assert.equal((await api.start(req('POST',a.cookie,analysisInput(3,{retryOf:legacyId})))).status,409);
 const queued=await start(b.cookie);assert.equal((await api.start(req('POST',b.cookie,analysisInput(2,{retryOf:queued.latest!.id})))).status,409);
 assert.equal(await count('lk_quote_analysis_jobs'),2);assert.equal(providerCalls,0);
});
test('same-version explicit retry retains the failed job link and replays without a provider call',async()=>{
 const {cookie}=await owner();await ready(cookie);const old=await start(cookie);const leaseToken=randomUUID();await mediaStore.command('analysis_claim',{companyId:'lk-group',jobId:old.latest!.id,leaseToken});await mediaStore.command('analysis_fail',{companyId:'lk-group',jobId:old.latest!.id,leaseToken,status:'failed',error:'Synthetic current version failure.'});
 const input=analysisInput(2,{retryOf:old.latest!.id});const first=await api.start(req('POST',cookie,input));assert.equal(first.status,200,await first.clone().text());const retried=await first.json() as PhotoWorkspace;assert.equal(retried.latest!.attempts,2);
 const replay=await api.start(req('POST',cookie,input));assert.equal(replay.status,200);assert.deepEqual(await replay.json(),retried);const row=(await db.query<{retry_of:string}>('select retry_of from public.lk_quote_analysis_jobs where id=$1',[retried.latest!.id])).rows[0];assert.equal(row.retry_of,old.latest!.id);assert.equal(providerCalls,0);
});
