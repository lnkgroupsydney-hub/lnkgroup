import test,{beforeEach,after} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {currentWorkDb,resetCurrentWork,tableHash,workDbFailure as fail} from '../enquiries/infrastructure/management-test-fixtures.mts'
import {seedCompanyFixture,companyRpc,companyProof,fixtureHash} from '../bookings/infrastructure/live-test-fixtures.mts'
import {compareCompanyRevision,type CompanyRevisionPayload} from './domain/company-revision.ts'
const db=await currentWorkDb();beforeEach(()=>resetCurrentWork(db));after(()=>db.close())
// SQL response assertions intentionally inspect heterogeneous JSON envelopes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj=Record<string,any>
const rpc=async(command:string,args:Obj={})=>(await db.query<{result:Obj}>('select public.lk_quote_company_revision_command($1,$2::jsonb) result',[command,JSON.stringify({companyId:'lk-group',...args})])).rows[0].result
const seed=()=>seedCompanyFixture(db,{simple:true,pricingVersion:'lk-sydney-cabinet-v3-20261014'})
type Fixture=Awaited<ReturnType<typeof seed>>
const staff=(f:Fixture)=>f.staffArgs
const contact=(f:Fixture)=>{const {consent,...c}=f.snapshot.payload.contact;void consent;return c}
const payload=(f:Fixture,extra:Obj={})=>({contact:contact(f),quantities:{doorCount:1,drawerCount:0,moderateRepair:false},extraItems:[],customerNote:'Company revised scope',...extra})
const input=(f:Fixture,expectedRevision=0,extra:Obj={})=>({...staff(f),expectedRevision,idempotencyKey:randomUUID(),reason:'Verified revised scope',...extra})
const mail=(f:Fixture)=>{const pdfBase64=Buffer.from('%PDF synthetic fixed revision').toString('base64');return{pdfBase64,pdfHash:fixtureHash('%PDF synthetic fixed revision'),payload:{from:'L&K <quote@example.invalid>',reply_to:'company@example.invalid',to:[f.email],subject:'Company revision',text:'Synthetic only',attachments:[{filename:'revision.pdf',content:pdfBase64}]}}}
async function save(f:Fixture,extra:Obj={}){return rpc('revision_save',input(f,0,{payload:payload(f,extra)}))}
async function publish(f:Fixture,extra:Obj={}){const saved=await save(f,extra),i=input(f,1,{revisionId:saved.receipt.childId}),prepared=await rpc('revision_prepare_publish',i);return{saved,input:i,prepared,result:await rpc('revision_publish',{...i,snapshotHash:prepared.snapshotHash,frozenMail:mail(f)})}}
async function accept(f:Fixture,p:Awaited<ReturnType<typeof publish>>){const i={...f.customerArgs,revisionId:p.result.receipt.childId,expectedRevision:2,idempotencyKey:randomUUID(),snapshotHash:p.prepared.snapshotHash,acknowledgmentVersion:'company-quote-revision-ack-v1',acknowledged:true,signature:f.signature,proofExpiresAt:new Date(Date.now()+600000).toISOString()},prepared=await rpc('customer_prepare_accept',i);return{input:i,prepared,result:await rpc('customer_accept',{...i,frozenMail:mail(f)})}}
const legacyLineItems=[{code:'doors',label:'Cabinet door preparation and painting',quantity:12,unitAmount:15000,amount:180000},{code:'drawers',label:'Drawer front preparation and painting',quantity:4,unitAmount:10000,amount:40000}]
const times={takeOffEndLocal:'2030-01-01T10:00',installStartLocal:'2030-01-08T09:00',installEndLocal:'2030-01-08T11:00',companyNote:'Company installation note'}
async function confirm(f:Fixture){const i={...f.staffArgs,...times,expectedRevision:0,idempotencyKey:randomUUID()},p=await companyRpc<Obj>(db,'staff_prepare_request',i);return companyRpc<Obj>(db,'staff_confirm_request',{...i,calendarCheck:companyProof(p.hash)})}
test('v3 minimum applies before repair and positive extras; comparisons always retain original signed amount',async()=>{const f=await seed(),saved=await save(f,{quantities:{doorCount:1,drawerCount:0,moderateRepair:true},extraItems:[{id:randomUUID(),description:'Additional preparation',amountCents:12345,reason:'Observed at site'}]});assert.equal(saved.detail.current.totalCents,182345);assert.equal(saved.detail.current.pricing.tax,0);assert.equal(saved.detail.current.comparison.original.totalCents,145000);assert.equal(saved.detail.current.comparison.deltaCents,37345);assert.equal(saved.receipt.entityType,'company_revision')})
test('save is atomic idempotent, CAS rejects stale writes and conflicting key never overwrites',async()=>{const f=await seed(),i=input(f,0,{payload:payload(f)}),saved=await rpc('revision_save',i);assert.deepEqual(await rpc('revision_save',i),saved);await assert.rejects(rpc('revision_save',{...i,payload:payload(f,{customerNote:'Different'})}),fail('LK409'));await assert.rejects(rpc('revision_save',input(f,0,{payload:payload(f)})),fail('LK409'));assert.equal((await db.query<Obj>('select count(*)::int n from public.lk_quote_company_revision_audit')).rows[0].n,1);assert.deepEqual(await rpc('revision_receipt',{...staff(f),idempotencyKey:i.idempotencyKey}),saved)})
test('draft update keeps one active version and DB independently rejects arithmetic forgery',async()=>{const f=await seed(),first=await save(f),next=await rpc('revision_save',input(f,1,{payload:payload(f,{quantities:{doorCount:20,drawerCount:2,moderateRepair:false}})}));assert.equal(first.receipt.childId,next.receipt.childId);assert.equal(next.detail.current.totalCents,320000);await db.exec('reset role');await assert.rejects(db.query("update public.lk_quote_company_revisions set pricing=jsonb_set(pricing,'{total}','1'),total_cents=1 where id=$1",[first.receipt.childId]),fail('LK422'));await db.exec('set role service_role')})
test('invalid counts, duplicate extras, discounts and technical typo overflow cannot be persisted',async()=>{const f=await seed(),id=randomUUID(),item={id,description:'Extra',reason:'Site',amountCents:100};for(const extra of [{quantities:{doorCount:0,drawerCount:0,moderateRepair:false}},{quantities:{doorCount:501,drawerCount:0,moderateRepair:false}},{extraItems:[{...item,amountCents:-1}]},{extraItems:[{...item,amountCents:10000001}]},{extraItems:[item,item]}])await assert.rejects(save(f,extra),fail('LK422'))})
test('only ack-v2 current signed evidence is eligible and unauthorized staff cannot read or replay',async()=>{const f=await seedCompanyFixture(db,{simple:false});assert.equal((await rpc('revision_detail',staff(f))).eligibilityCode,'revision_not_eligible');await assert.rejects(save(f),fail('LK409'));const fresh=await seed();await db.exec('reset role');await db.query("update auth.users set raw_app_meta_data='{}' where id=$1",[fresh.staffId]);await db.exec('set role service_role');await assert.rejects(rpc('revision_detail',staff(fresh)),fail('LK403'))})
test('publication fixes snapshot, one notice and complete immutable audit; GET review never accepts',async()=>{const f=await seed(),p=await publish(f),r=p.result.detail.current;assert.equal(r.status,'published');assert.equal(r.snapshotHash,p.prepared.snapshotHash);await rpc('customer_state',f.customerArgs);await rpc('customer_review',{...f.customerArgs,revisionId:r.id,snapshotHash:r.snapshotHash});assert.equal((await rpc('customer_state',f.customerArgs)).current.status,'published');assert.deepEqual(await rpc('revision_prepare_publish',p.input),p.result);await assert.rejects(rpc('revision_save',input(f,2,{payload:payload(f)})),fail('LK409'));await db.exec('reset role');await assert.rejects(db.query("update public.lk_quote_company_revisions set payload=jsonb_set(payload,'{customerNote}','\"tampered\"') where id=$1",[r.id]),fail('LK409'));for(const table of ['lk_quote_company_revision_audit','lk_quote_company_revision_receipts'])await assert.rejects(db.exec('delete from public.'+table),fail('LK409'));assert.equal((await db.query<Obj>('select count(*)::int n from public.lk_quote_company_revision_outbox')).rows[0].n,1)})
test('draft stays staff-private, withdrawn state remains visible with no withdrawal mail',async()=>{const f=await seed(),saved=await save(f);assert.equal((await rpc('customer_state',f.customerArgs)).current,null);const i=input(f,1,{revisionId:saved.receipt.childId}),prep=await rpc('revision_prepare_publish',i);await rpc('revision_publish',{...i,snapshotHash:prep.snapshotHash,frozenMail:mail(f)});await rpc('revision_withdraw',input(f,2,{revisionId:saved.receipt.childId}));const state=await rpc('customer_state',f.customerArgs);assert.equal(state.current.status,'withdrawn');assert.equal(await rpc('worker_claim',{requestId:f.requestId,leaseToken:randomUUID()}),null);assert.equal(state.current.emailStatus,'cancelled');assert.equal('audit' in state,false);assert.equal('initialPayload' in state,false);assert.equal((await db.query<Obj>('select count(*)::int n from public.lk_quote_company_revision_outbox')).rows[0].n,1);await assert.rejects(rpc('customer_review',{...f.customerArgs,revisionId:saved.receipt.childId,snapshotHash:prep.snapshotHash}),fail('LK409'))})
test('customer acceptance requires selected access, matching proof hash, live expiry, ack and fresh valid signature',async()=>{const f=await seed(),p=await publish(f),base={...f.customerArgs,revisionId:p.result.receipt.childId,expectedRevision:2,idempotencyKey:randomUUID(),snapshotHash:p.prepared.snapshotHash,acknowledgmentVersion:'company-quote-revision-ack-v1',acknowledged:true,signature:f.signature,proofExpiresAt:new Date(Date.now()+600000).toISOString(),frozenMail:mail(f)};for(const extra of [{snapshotHash:'a'.repeat(64)},{proofExpiresAt:new Date(Date.now()-1000).toISOString()},{acknowledgmentVersion:'live-booking-request-ack-v2'},{acknowledged:false},{signature:{...f.signature,name:''}}])await assert.rejects(rpc('customer_accept',{...base,...extra}),e=>fail('LK409')(e)||fail('LK422')(e));const other=await seed();await assert.rejects(rpc('customer_accept',{...base,...other.customerArgs}),e=>fail('LK404')(e)||fail('LK409')(e));await db.exec('reset role');await db.query('delete from public.lk_quote_request_access where request_id=$1',[f.requestId]);await db.exec('set role service_role');await assert.rejects(rpc('customer_accept',base),e=>fail('LK403')(e)||fail('LK404')(e))})
test('acceptance is immutable and replay precedes expired proof/status but current access is still checked',async()=>{const f=await seed(),p=await publish(f),a=await accept(f,p);assert.equal(a.result.state.current.status,'accepted');assert.deepEqual(await rpc('customer_accept',{...a.input,proofExpiresAt:new Date(0).toISOString(),frozenMail:mail(f)}),a.result);assert.deepEqual(await rpc('customer_prepare_accept',{...a.input,proofExpiresAt:new Date(0).toISOString()}),a.result);await assert.rejects(rpc('customer_accept',{...a.input,signature:{...f.signature,name:'Other'},frozenMail:mail(f)}),fail('LK409'));await db.exec('reset role');await assert.rejects(db.exec('delete from public.lk_quote_company_revision_acceptances'),fail('LK409'));assert.equal((await db.query<Obj>('select count(*)::int n from public.lk_quote_company_revision_outbox')).rows[0].n,2);await db.query("update public.lk_quote_customer_sessions set expires_at=now()-interval '1 second' where id=$1",[f.customerSessionId]);await db.exec('set role service_role');await assert.rejects(rpc('customer_accept',{...a.input,frozenMail:mail(f)}),fail('LK401'))})
test('accepted basis is retained while new draft exists, then superseded only by explicit new acceptance',async()=>{const f=await seed(),p=await publish(f);await accept(f,p);const saved=await rpc('revision_save',input(f,3,{payload:payload(f,{quantities:{doorCount:20,drawerCount:0,moderateRepair:false}})}));assert.equal(saved.detail.current.basedOnRevisionId,p.result.receipt.childId);assert.equal(saved.detail.effectiveAccepted.id,p.result.receipt.childId);assert.equal(saved.detail.current.versionNo,2);const i=input(f,4,{revisionId:saved.receipt.childId}),prep=await rpc('revision_prepare_publish',i);await rpc('revision_publish',{...i,snapshotHash:prep.snapshotHash,frozenMail:mail(f)});await rpc('customer_accept',{...f.customerArgs,revisionId:saved.receipt.childId,expectedRevision:5,idempotencyKey:randomUUID(),snapshotHash:prep.snapshotHash,acknowledgmentVersion:'company-quote-revision-ack-v1',acknowledged:true,signature:f.signature,proofExpiresAt:new Date(Date.now()+600000).toISOString(),frozenMail:mail(f)});assert.equal((await rpc('revision_detail',staff(f))).revisions[1].status,'superseded')})
test('published customer wait blocks confirm, draft permits original price, accepted confirmation uses exact new evidence',async()=>{let f=await seed();await publish(f);await assert.rejects(confirm(f),fail('LK409'));await resetCurrentWork(db);f=await seed();await save(f);assert.equal((await confirm(f)).booking.confirmationBasis,'signed_request');await resetCurrentWork(db);f=await seed();const p=await publish(f,{quantities:{doorCount:20,drawerCount:2,moderateRepair:true}}),a=await accept(f,p),state=await confirm(f);assert.equal(state.proposal.total,345000);assert.equal(state.proposal.gst,0);assert.equal(state.booking.confirmationBasis,'accepted_revision');assert.equal(state.booking.companyRevisionId,p.result.receipt.childId);assert.equal(state.booking.companyRevisionSignedContentHash,a.result.state.current.acceptance.signedContentHash);await assert.rejects(rpc('revision_save',input(f,3,{payload:payload(f)})),fail('LK409'))})
test('original signed request, approval, PDF/mail and photos remain byte-identical through full revision and confirmation',async()=>{const f=await seed(),tables=['lk_quote_requests','lk_live_quote_approvals','lk_live_quote_submissions','lk_quote_analysis_jobs','lk_live_quote_photos','lk_quote_photos'],before=await Promise.all(tables.map(t=>tableHash(db,t)));const p=await publish(f);await accept(f,p);await confirm(f);assert.deepEqual(await Promise.all(tables.map(t=>tableHash(db,t))),before)})
test('outbox leases fence stale worker, frozen payload cannot change and completed messages are never reclaimed',async()=>{const f=await seed();await publish(f);const claim=await rpc('worker_claim',{requestId:f.requestId,leaseToken:randomUUID()});assert.ok(claim.frozenMail.pdfBase64);assert.equal(await rpc('worker_claim',{requestId:f.requestId,leaseToken:randomUUID()}),null);await assert.rejects(rpc('worker_email_attempt',{id:claim.id,leaseToken:randomUUID()}),fail('LK409'));assert.equal((await rpc('worker_email_attempt',{id:claim.id,leaseToken:claim.leaseToken})).emailStatus,'sending');await rpc('worker_email_accepted',{id:claim.id,leaseToken:claim.leaseToken,providerMessageId:'synthetic-only'});assert.equal(await rpc('worker_claim',{requestId:f.requestId,leaseToken:randomUUID()}),null);await db.exec('reset role');await assert.rejects(db.exec("update public.lk_quote_company_revision_outbox set payload='{}'"),fail('LK409'))})
test('unknown delivery outcome beyond provider retry window becomes manual review without another send',async()=>{const f=await seed();await publish(f);await db.exec('reset role');await db.exec("update public.lk_quote_company_revision_outbox set email_first_attempt_at=now()-interval '24 hours',email_status='retrying'");await db.exec('set role service_role');assert.equal(await rpc('worker_claim',{requestId:f.requestId,leaseToken:randomUUID()}),null);assert.equal((await db.query<Obj>('select email_status from public.lk_quote_company_revision_outbox')).rows[0].email_status,'manual_review')})
test('new tables have RLS, no browser privileges and only service_role can execute public RPC',async()=>{const rows=(await db.query<Obj>("select relname,relrowsecurity from pg_class where relname like 'lk_quote_company_revision%'")).rows.filter(x=>!x.relname.endsWith('_pkey')&&!x.relname.endsWith('_key')&&!x.relname.endsWith('_active'));assert.equal(rows.length,5);assert.ok(rows.every(x=>x.relrowsecurity));for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(rpc('customer_state',{}),fail('42501'));await assert.rejects(db.exec('select * from public.lk_quote_company_revisions'),fail('42501'));await db.exec('reset role')}const granted=(await db.query<Obj>("select has_function_privilege('authenticated','public.lk_quote_company_revision_command(text,jsonb)','execute') allowed")).rows[0].allowed;assert.equal(granted,false)})
test('D1 unchanged legacy source contact saves, changed invalid contact fails, publication validates every contact field',async()=>{const f=await seed();await db.exec('reset role');await db.query("update public.lk_quote_requests set payload=jsonb_set(payload,'{contact,phone}','\"legacy-bad-phone\"') where id=$1",[f.requestId]);await db.exec('set role service_role');const oldContact={...contact(f),phone:'legacy-bad-phone'},saved=await save(f,{contact:oldContact});await assert.rejects(rpc('revision_prepare_publish',input(f,1,{revisionId:saved.receipt.childId})),fail('LK422'));await assert.rejects(rpc('revision_save',input(f,1,{payload:payload(f,{contact:{...oldContact,phone:'new-bad-phone'}})})),fail('LK422'));const repaired=await rpc('revision_save',input(f,1,{payload:payload(f)}));assert.equal(repaired.detail.current.payload.contact.phone,'')})
test('partial active unique index independently prevents a second concurrent draft row',async()=>{const f=await seed(),saved=await save(f);await db.exec('reset role');await assert.rejects(db.query("insert into public.lk_quote_company_revisions(company_id,request_id,version_no,revision,base_submission_id,base_snapshot_hash,base_signed_content_hash,status,payload,pricing,total_cents,comparison,acknowledgment,created_by,updated_by) select company_id,request_id,2,2,base_submission_id,base_snapshot_hash,base_signed_content_hash,'draft',payload,pricing,total_cents,comparison,acknowledgment,created_by,updated_by from public.lk_quote_company_revisions where id=$1",[saved.receipt.childId]),fail('23505'))})
test('staff receipt replay still requires current membership and customer access cannot swap a selected request',async()=>{const f=await seed(),i=input(f,0,{payload:payload(f)});await rpc('revision_save',i);const other=await seed();await assert.rejects(rpc('customer_state',{...other.customerArgs,expectedRequestId:f.requestId}),fail('LK403'));await db.exec('reset role');await db.query("update auth.users set raw_app_meta_data='{}' where id=$1",[f.staffId]);await db.exec('set role service_role');await assert.rejects(rpc('revision_save',i),fail('LK403'));await assert.rejects(rpc('revision_receipt',{...staff(f),idempotencyKey:i.idempotencyKey}),fail('LK403'))})
test('every new revision mutation is refused after immutable company booking exists',async()=>{const f=await seed(),p=await publish(f),a=await accept(f,p);await confirm(f);for(const cmd of ['revision_publish','revision_withdraw'])await assert.rejects(rpc(cmd,input(f,3,{revisionId:p.result.receipt.childId,snapshotHash:p.prepared.snapshotHash,frozenMail:mail(f)})),fail('LK409'));await assert.rejects(rpc('customer_accept',{...a.input,expectedRevision:3,idempotencyKey:randomUUID(),frozenMail:mail(f)}),fail('LK409'))})

test('accepted revision notices cannot be claimed while acceptance receipts remain independently deliverable',async()=>{
 const f=await seed(),p=await publish(f),accepted=await accept(f,p)
 const receipt=await rpc('worker_claim',{requestId:f.requestId,leaseToken:randomUUID()})
 assert.equal(receipt.kind,'revision_acceptance_receipt');assert.equal(receipt.acceptanceSignedContentHash,accepted.result.state.current.acceptance.signedContentHash)
 await rpc('worker_email_attempt',{id:receipt.id,leaseToken:receipt.leaseToken})
 const retry=await rpc('worker_error',{id:receipt.id,leaseToken:receipt.leaseToken,outcome:'retrying',errorCode:'email_outcome_unknown'})
 assert.equal(retry.acceptanceSignedContentHash,receipt.acceptanceSignedContentHash)
 await db.exec('reset role');await db.query("update public.lk_quote_company_revision_outbox set next_attempt_at=now()-interval '1 second' where id=$1",[receipt.id]);await db.exec('set role service_role')
 const reclaimed=await rpc('worker_claim',{requestId:f.requestId,leaseToken:randomUUID()})
 assert.equal(reclaimed.id,receipt.id);assert.deepEqual(reclaimed.frozenMail,receipt.frozenMail);assert.equal(reclaimed.emailIdempotencyKey,receipt.emailIdempotencyKey)
 await rpc('worker_email_attempt',{id:reclaimed.id,leaseToken:reclaimed.leaseToken})
 await rpc('worker_email_accepted',{id:reclaimed.id,leaseToken:reclaimed.leaseToken,providerMessageId:'synthetic-receipt-accepted'})
 assert.equal(await rpc('worker_claim',{requestId:f.requestId,leaseToken:randomUUID()}),null)
 assert.deepEqual((await db.query<Obj>("select kind,email_status from public.lk_quote_company_revision_outbox order by kind")).rows,[{kind:'revision_acceptance_receipt',email_status:'provider_accepted'},{kind:'revision_notice',email_status:'pending'}])
})

test('accepted revision confirmation audit records actual booking basis and acceptance evidence while preserving original signed hashes',async()=>{
 const f=await seed(),p=await publish(f,{quantities:{doorCount:20,drawerCount:2,moderateRepair:true}}),accepted=await accept(f,p),state=await confirm(f)
 const audit=(await db.query<{details:Obj}>("select details from public.lk_live_company_audit where request_id=$1 and action='staff_confirm_request'",[f.requestId])).rows[0].details
 assert.equal(audit.confirmationBasis,'accepted_revision');assert.equal(audit.companyRevisionId,state.booking.companyRevisionId);assert.equal(audit.companyRevisionSnapshotHash,p.prepared.snapshotHash)
 assert.equal(audit.companyRevisionAcceptanceId,state.booking.companyRevisionAcceptanceId);assert.equal(audit.companyRevisionSignedContentHash,accepted.result.state.current.acceptance.signedContentHash);assert.equal(audit.signedContentHash,audit.companyRevisionSignedContentHash)
 assert.equal(audit.originalSignedContentHash,state.submission.signedContentHash);assert.equal(audit.originalSnapshotHash,state.submission.snapshotHash);assert.equal(audit.signedSubmissionId,f.submissionId)
})

test('revision audit retains prior/new business evidence by IDs and hashes without duplicating personal or signed content',async()=>{
 const f=await seed(),published=await publish(f,{quantities:{doorCount:20,drawerCount:2,moderateRepair:true}}),accepted=await accept(f,published),revision=accepted.result.state.current
 const rows=(await db.query<{action:string;details:Obj}>("select action,details from public.lk_quote_company_revision_audit where request_id=$1 order by new_revision",[f.requestId])).rows
 assert.deepEqual(rows.map(row=>row.action),['revision_save','revision_publish','customer_accept']);assert.deepEqual(rows.map(row=>row.details.new.status),['draft','published','accepted']);assert.deepEqual(rows.map(row=>row.details.prior?.status??null),[null,'draft','published'])
 const forbidden=new Set(['contact','payload','snapshot','signature','strokes','pdfBase64','customerNote','extraItems','internalNotes','details'])
 function inspect(value:unknown):void{if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value)){assert.equal(forbidden.has(key),false,`Audit must not duplicate ${key}`);inspect(child)}}
 for(const row of rows){inspect(row.details);for(const summary of [row.details.prior,row.details.new]){if(!summary)continue;assert.equal(summary.revisionId,revision.id);assert.equal(summary.versionNo,1);assert.equal(summary.totalCents,345000);assert.equal(summary.pricingVersion,'lk-sydney-cabinet-v3-20261014');assert.deepEqual(summary.quantities,revision.payload.quantities);assert.equal(summary.baseSubmissionId,f.submissionId);assert.equal(summary.baseSnapshotHash,revision.baseSnapshotHash);assert.equal(summary.baseSignedContentHash,revision.baseSignedContentHash);assert.match(summary.payloadHash,/^[a-f0-9]{64}$/)}}
 assert.equal(rows[0].details.new.snapshotHash,null);assert.equal(rows[1].details.new.snapshotHash,published.prepared.snapshotHash);assert.equal(rows[2].details.new.acceptanceId,revision.acceptance.id);assert.equal(rows[2].details.new.signedContentHash,revision.acceptance.signedContentHash)
})


test('SQL and TypeScript preserve exact legacy GST signed pricing and infer only stored monetary evidence',async()=>{
 const cases=[
  {subtotal:220000,tax:22000,total:242000,pricingVersion:'lk-sydney-cabinet-v2-20261011',lineItems:legacyLineItems},
  {subtotal:220000,tax:null,gst:22000,total:242000,pricingVersion:'legacy-gst'},
  {subtotal:220000,tax:null,total:242000,pricingVersion:null},
  {subtotal:null,tax:22000,total:242000},
  {subtotal:145000,tax:0,total:145000,pricingVersion:'lk-sydney-cabinet-v3-20261014'},
 ]
 for(const pricing of cases){
  const f=await seedCompanyFixture(db,{simple:true,originalPricing:pricing,sourceQuantities:{doorCount:12,drawerCount:4}}),value=payload(f,{quantities:{doorCount:6,drawerCount:3,moderateRepair:false}}),saved=await save(f,{quantities:value.quantities})
  assert.deepEqual(saved.detail.current.comparison,compareCompanyRevision(f.snapshot,value as CompanyRevisionPayload))
  assert.equal(saved.detail.current.comparison.original.subtotalCents+saved.detail.current.comparison.original.taxCents,saved.detail.current.comparison.original.totalCents)
 }
 const f=await seed(),value=payload(f),pricing={lineItems:[],total:145000}
 await db.exec('reset role')
 for(const original of [
  {subtotal:220000,tax:22001,total:242000},{subtotal:null,tax:null,total:242000},
  {subtotal:220000,tax:22000,gst:22001,total:242000},{subtotal:'220000',tax:22000,total:242000},
  {subtotal:220000,tax:22000,total:242000.5},{subtotal:220000,tax:-1,total:219999},
  {subtotal:9007199254740992,tax:0,total:9007199254740992},{subtotal:220000,tax:22000,total:242000,pricingVersion:3},
 ]){
  const snapshot={...f.snapshot,pricing:original}
  assert.throws(()=>compareCompanyRevision(snapshot,value as CompanyRevisionPayload))
  await assert.rejects(db.query("select lk_private.company_revision_comparison(jsonb_populate_record(null::public.lk_live_quote_submissions,$1::jsonb),$2::jsonb,$3::jsonb)",[JSON.stringify({snapshot}),JSON.stringify(value),JSON.stringify(pricing)]),fail('LK422'))
 }
})

test('legacy GST signed source remains byte-identical through revision acceptance and confirmation',async()=>{
 const f=await seedCompanyFixture(db,{simple:true,originalPricing:{subtotal:220000,tax:22000,total:242000,pricingVersion:'lk-sydney-cabinet-v2-20261011',lineItems:legacyLineItems},sourceQuantities:{doorCount:12,drawerCount:4}})
 const tables=['lk_quote_requests','lk_live_quote_approvals','lk_live_quote_submissions','lk_quote_analysis_jobs','lk_live_quote_photos','lk_quote_photos'],before=await Promise.all(tables.map(t=>tableHash(db,t)))
 const p=await publish(f,{quantities:{doorCount:6,drawerCount:3,moderateRepair:false}})
 assert.equal(p.result.detail.current.comparison.original.taxCents,22000)
 await accept(f,p);const confirmed=await confirm(f)
 assert.equal(confirmed.proposal.total,145000);assert.equal(confirmed.proposal.gst,0)
 assert.deepEqual(await Promise.all(tables.map(t=>tableHash(db,t))),before)
})

test('no signed submission detail remains safely ineligible without manufacturing monetary evidence',async()=>{
 const f=await seed();await db.exec('reset role');await db.query('delete from public.lk_live_quote_submissions where id=$1',[f.submissionId]);await db.exec('set role service_role')
 const state=await rpc('revision_detail',staff(f));assert.equal(state.eligible,false);assert.equal(state.eligibilityCode,'revision_not_eligible');assert.deepEqual(state.initialPayload.quantities,{doorCount:8,drawerCount:3,moderateRepair:false})
})

test('withdraw cancels never-attempted notice and revokes any issued lease without changing frozen evidence',async()=>{
 const f=await seed(),p=await publish(f),claim=await rpc('worker_claim',{requestId:f.requestId,leaseToken:randomUUID()}),before=(await db.query<Obj>('select payload,pdf_base64,pdf_hash,email_idempotency_key from public.lk_quote_company_revision_outbox where id=$1',[claim.id])).rows[0]
 await rpc('revision_withdraw',input(f,2,{revisionId:p.result.receipt.childId}))
 assert.equal(await rpc('worker_claim',{requestId:f.requestId,leaseToken:randomUUID()}),null)
 for(const token of [claim.leaseToken,null])for(const command of ['worker_email_attempt','worker_error'])await assert.rejects(rpc(command,{id:claim.id,leaseToken:token,outcome:'retrying',errorCode:'synthetic'}),fail('LK409'))
 const row=(await db.query<Obj>('select * from public.lk_quote_company_revision_outbox where id=$1',[claim.id])).rows[0]
 assert.equal(row.email_status,'cancelled');assert.equal(row.error_code,'revision_withdrawn');assert.equal(row.email_first_attempt_at,null);assert.equal(row.lease_token,null);assert.equal(row.lease_expires_at,null)
 assert.deepEqual({payload:row.payload,pdf_base64:row.pdf_base64,pdf_hash:row.pdf_hash,email_idempotency_key:row.email_idempotency_key},before)
 assert.equal((await rpc('customer_state',f.customerArgs)).current.status,'withdrawn')
})

test('withdraw preserves attempted retry evidence but prevents both new claims and a leased retry attempt',async()=>{
 const f=await seed(),p=await publish(f),claim=await rpc('worker_claim',{requestId:f.requestId,leaseToken:randomUUID()})
 await rpc('worker_email_attempt',{id:claim.id,leaseToken:claim.leaseToken});await rpc('worker_error',{id:claim.id,leaseToken:claim.leaseToken,outcome:'retrying',errorCode:'provider_unavailable'})
 await db.exec('reset role');await db.query("update public.lk_quote_company_revision_outbox set next_attempt_at=now()-interval '1 second' where id=$1",[claim.id]);await db.exec('set role service_role')
 const retry=await rpc('worker_claim',{requestId:f.requestId,leaseToken:randomUUID()}),before=(await db.query<Obj>('select * from public.lk_quote_company_revision_outbox where id=$1',[claim.id])).rows[0]
 await rpc('revision_withdraw',input(f,2,{revisionId:p.result.receipt.childId}))
 assert.deepEqual((await db.query<Obj>('select * from public.lk_quote_company_revision_outbox where id=$1',[claim.id])).rows[0],before)
 await assert.rejects(rpc('worker_email_attempt',{id:retry.id,leaseToken:retry.leaseToken}),fail('LK409'))
 assert.equal(await rpc('worker_claim',{requestId:f.requestId,leaseToken:randomUUID()}),null)
 // After expiry the published-only claim predicate still prevents a retry.
 await db.exec('reset role');await db.query("update public.lk_quote_company_revision_outbox set lease_expires_at=now()-interval '1 second' where id=$1",[claim.id]);await db.exec('set role service_role')
 assert.equal(await rpc('worker_claim',{requestId:f.requestId,leaseToken:randomUUID()}),null)
 assert.equal((await rpc('customer_state',f.customerArgs)).current.status,'withdrawn')
})

test('accepted revision confirmation scope always describes quantities and appends only nonblank company notes',async()=>{
 for(const note of ['', '   ', '\t\n\u00a0', '  Agreed preparation detail  ']){
  await resetCurrentWork(db);const f=await seed(),p=await publish(f,{quantities:{doorCount:6,drawerCount:3,moderateRepair:false},customerNote:note});await accept(f,p)
  const state=await confirm(f),expected='6 cabinet doors, 3 drawer fronts'+(note.trim()?'\n'+note.trim():'')
  assert.equal(state.proposal.scope,expected)
  const row=(await db.query<{snapshot:Obj}>('select snapshot from public.lk_live_company_proposals where request_id=$1',[f.requestId])).rows[0]
  assert.equal(row.snapshot.scope,expected)
 }
})
