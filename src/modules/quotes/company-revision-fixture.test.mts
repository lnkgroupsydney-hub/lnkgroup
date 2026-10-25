import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {companyRevisionFixtureHarness,optimizedPublicLogo} from '../../../scripts/verify-esn-ui-fixture.mjs'
import {currentWorkDb} from '../enquiries/infrastructure/management-test-fixtures.mts'
import {seedCompanyFixture,fixtureHash} from '../bookings/infrastructure/live-test-fixtures.mts'
import {COMPANY_REVISION_ACK} from './domain/company-revision.ts'
// The loopback server is deliberately not started: this exercises its real handler without sockets.
test('fixture only proxies the exact public logo optimizer requests used by the UI',()=>{
 const request=(query:string,path='/_next/image')=>new URL(`${path}?${query}`,'http://127.0.0.1:3063');
 const image='url=%2Fimages%2Flk-group-logo-circle-transparent.png';
 for(const width of [48,96,128,256])assert.equal(optimizedPublicLogo(request(`${image}&w=${width}&q=75`)),true,`width ${width}`);
 for(const query of [
  'url=https%3A%2F%2Fexample.invalid%2Flogo.png&w=48&q=75',
  'url=%2Fapi%2Fquote%2Frequests&w=48&q=75',
  'url=%2Fimages%2Fother.png&w=48&q=75',
  `${image}&url=%2Fimages%2Flk-group-logo-circle-transparent.png&w=48&q=75`,
  `${image}&w=48&w=48&q=75`,`${image}&w=48&q=75&q=75`,
  `${image}&w=48&q=75&extra=1`,`${image}&w=4096&q=75`,`${image}&w=48&q=100`,
 ])assert.equal(optimizedPublicLogo(request(query)),false,query);
 assert.equal(optimizedPublicLogo(request(`${image}&w=48&q=75`,'/api/image')),false);
});
test('fixture publication, review and acceptance DTO keys match real DB output and GET never accepts',async()=>{
 const h=companyRevisionFixtureHarness(),base=`/api/admin/quote-requests/${h.requestId}/company-revisions`,first=await h.dispatch('GET',base),payload={...first.body.initialPayload,contact:{...first.body.initialPayload.contact,phone:''}},key=randomUUID()
 const saved=await h.dispatch('PUT',base,{expectedRevision:0,idempotencyKey:key,reason:'Reviewed scope',payload});assert.equal(saved.status,200);assert.ok(saved.body.detail);assert.equal('state'in saved.body,false)
 const published=await h.dispatch('POST',base+'/publish',{revisionId:saved.body.receipt.childId,expectedRevision:1,idempotencyKey:randomUUID(),reason:'Ready to publish'});assert.equal(published.status,200)
 const current=published.body.detail.current;const state=await h.dispatch('GET','/api/quote/requests/company-revision');assert.equal(state.body.current.status,'published')
 const review=await h.dispatch('POST','/api/quote/requests/company-revision/review',{revisionId:current.id,snapshotHash:current.snapshotHash}),accepted=await h.dispatch('POST','/api/quote/requests/company-revision/accept',{revisionId:current.id,expectedRevision:2,idempotencyKey:randomUUID(),reviewProof:review.body.review.reviewProof,acknowledgmentVersion:COMPANY_REVISION_ACK.version,acknowledged:true,signature:{name:'New Customer Signature',method:'typed',strokes:[],acknowledged:true}});assert.equal(accepted.status,200);assert.ok(accepted.body.state);assert.equal(h.outbox().length,2)
 const db=await currentWorkDb();try{const f=await seedCompanyFixture(db,{simple:true,pricingVersion:'lk-sydney-cabinet-v3-20261014'});const rpc=(command:string,args:Record<string,unknown>)=>db.query<{result:Record<string,unknown>}>('select public.lk_quote_company_revision_command($1,$2::jsonb) result',[command,JSON.stringify({companyId:'lk-group',...args})]).then(result=>result.rows[0].result)
 const realSaved=await rpc('revision_save',{...f.staffArgs,expectedRevision:0,idempotencyKey:randomUUID(),reason:'Reviewed scope',payload}),realReceipt=realSaved.receipt as {childId:string},i={...f.staffArgs,revisionId:realReceipt.childId,expectedRevision:1,idempotencyKey:randomUUID(),reason:'Ready to publish'},prep=await rpc('revision_prepare_publish',i),pdfBase64=Buffer.from('%PDF fixture contract').toString('base64'),frozenMail={pdfBase64,pdfHash:fixtureHash('%PDF fixture contract'),payload:{to:[f.email],subject:'Synthetic revision contract fixture',attachments:[{filename:'revision.pdf',content:pdfBase64}]}}
 const realPublished=await rpc('revision_publish',{...i,snapshotHash:prep.snapshotHash,frozenMail}),realAccepted=await rpc('customer_accept',{...f.customerArgs,revisionId:realReceipt.childId,expectedRevision:2,idempotencyKey:randomUUID(),snapshotHash:prep.snapshotHash,proofExpiresAt:new Date(Date.now()+600000).toISOString(),acknowledgmentVersion:COMPANY_REVISION_ACK.version,acknowledged:true,signature:f.signature,frozenMail})
 assert.deepEqual(Object.keys(published.body).sort(),Object.keys(realPublished).sort());const realCurrent=(realPublished.detail as {current:Record<string,unknown>}).current;assert.deepEqual(Object.keys(current).sort(),Object.keys(realCurrent).sort());assert.deepEqual(Object.keys(current.snapshot).sort(),Object.keys(realCurrent.snapshot as object).sort());const realAcceptance=((realAccepted.state as {current:{acceptance:object}}).current.acceptance);assert.deepEqual(Object.keys(accepted.body.state.current.acceptance).sort(),Object.keys(realAcceptance).sort())
 const fixtureFinal=await h.dispatch('GET',base),realFinal=await rpc('revision_detail',f.staffArgs),fixtureAudit=fixtureFinal.body.audit,realAudit=realFinal.audit as {details:{prior:Record<string,unknown>|null;new:Record<string,unknown>}}[]
 assert.equal(fixtureAudit.length,3);assert.equal(realAudit.length,3);assert.deepEqual(fixtureAudit[0],saved.body.detail.audit[0])
 for(let index=0;index<3;index++){assert.deepEqual(Object.keys(fixtureAudit[index]).sort(),Object.keys(realAudit[index]).sort());assert.deepEqual(Object.keys(fixtureAudit[index].details).sort(),Object.keys(realAudit[index].details).sort());assert.deepEqual(Object.keys(fixtureAudit[index].details.new).sort(),Object.keys(realAudit[index].details.new).sort());if(index===0)assert.equal(fixtureAudit[index].details.prior,null);else assert.deepEqual(Object.keys(fixtureAudit[index].details.prior).sort(),Object.keys(realAudit[index].details.prior!).sort());assert.equal(fixtureAudit[index].priorRevision,index);assert.equal(fixtureAudit[index].newRevision,index+1)}
 const auditJson=JSON.stringify(fixtureAudit);for(const secret of [payload.contact.email,payload.contact.name,'New Customer Signature','"input"','"scope"','"snapshot"','"signature"','"contact"','"customerNote"','"extraItems"'])assert.equal(auditJson.includes(secret),false,`Audit exposed ${secret}`)

 }finally{await db.close()}
})
test('fixture conflict, response loss, private access and exact replay controls preserve state',async()=>{const h=companyRevisionFixtureHarness(),base=`/api/admin/quote-requests/${h.requestId}/company-revisions`,initial=await h.dispatch('GET',base),payload={...initial.body.initialPayload,contact:{...initial.body.initialPayload.contact,phone:''}},input={expectedRevision:0,idempotencyKey:randomUUID(),reason:'Reviewed scope',payload};h.control({r3bLoseNextResponse:true});assert.equal((await h.dispatch('PUT',base,input)).status,503);assert.equal((await h.dispatch('PUT',base,input)).status,200);assert.equal((await h.dispatch('PUT',base,{...input,payload:{...payload,customerNote:'Changed retry'}})).status,409);h.control({r3bCustomerSignedIn:false});assert.equal((await h.dispatch('GET','/api/quote/requests/company-revision')).status,401);h.control({r3bCustomerSignedIn:true});assert.equal((await h.dispatch('GET','/api/quote/requests/company-revision',undefined,randomUUID())).status,403);assert.equal(h.outbox().length,0)})

test('real customer entry, selection, hidden analysis and completed booking DTOs use scoped synthetic state', async () => {
 const h=companyRevisionFixtureHarness();h.control({r3bLegacyInvalidPhone:false});const before=h.state();
 assert.deepEqual((await h.dispatch('POST','/api/quote/requests/session')).body,{ready:true});
 const restored=await h.dispatch('GET','/api/quote/requests');assert.equal(restored.status,200);assert.equal(restored.body.request.id,h.requestId);
 const access=await h.dispatch('GET','/api/quote/requests/customer');assert.equal(access.body.currentRequestId,h.requestId);assert.deepEqual(access.body.requests.map((row:{id:string})=>row.id),[h.requestId]);
 assert.equal((await h.dispatch('POST','/api/quote/requests/customer/select',{requestId:h.requestId})).status,200);
 const analysis=await h.dispatch('GET','/api/quote/requests/analysis');assert.equal(analysis.status,200);assert.equal(analysis.body.request.id,h.requestId);assert.equal(analysis.body.photos[0].contentUrl,`/api/quote/requests/photos/${analysis.body.photos[0].id}/content`);
 const booking=await h.dispatch('GET','/api/quote/requests/booking');assert.equal(booking.status,200);assert.equal(booking.body.state.submission.snapshot.version,'live-booking-request-ack-v2');assert.equal(booking.body.state.canEdit,false);assert.equal(booking.body.state.verified,true);
 const company=await h.dispatch('GET','/api/quote/requests/company-booking');assert.equal(company.status,200);assert.equal(company.body.state.requestId,h.requestId);assert.equal('canWrite'in company.body.state,false);assert.equal('simpleDraft'in company.body.state,false);
 const other=before.liveRequests[0].id;
 for(const endpoint of ['/api/quote/requests','/api/quote/requests/analysis','/api/quote/requests/booking','/api/quote/requests/company-booking','/api/quote/requests/company-revision'])assert.equal((await h.dispatch('GET',endpoint,undefined,other)).status,403,endpoint);
 assert.equal((await h.dispatch('POST','/api/quote/requests/customer/select',{requestId:other})).status,403);
 assert.equal((await h.dispatch('POST','/api/quote/requests/customer/select',{requestId:h.requestId,admin:true})).status,422);
 assert.equal((await h.dispatch('POST','/api/quote/requests/session',{requestId:h.requestId})).status,422);
 assert.equal((await h.dispatch('GET','/api/quote/requests/unknown')).status,503);
 assert.deepEqual(h.state().liveBookings,before.liveBookings);assert.deepEqual(h.state().liveRequests,before.liveRequests);assert.deepEqual(h.state().liveAnalysis,before.liveAnalysis);
});

test('all actual customer flow endpoints consistently deny lost access and foreign selected scope',async()=>{
 const h=companyRevisionFixtureHarness();const endpoints=['/api/quote/requests','/api/quote/requests/customer','/api/quote/requests/analysis','/api/quote/requests/booking','/api/quote/requests/company-booking','/api/quote/requests/company-revision'];
 h.control({r3bCustomerSignedIn:false});for(const endpoint of endpoints)assert.equal((await h.dispatch('GET',endpoint)).status,401,endpoint);assert.equal((await h.dispatch('POST','/api/quote/requests/session')).status,401);assert.equal((await h.dispatch('POST','/api/quote/requests/customer/select',{requestId:h.requestId})).status,401);
 h.control({r3bCustomerSignedIn:true,customerAccessStatus:403});for(const endpoint of endpoints)assert.equal((await h.dispatch('GET',endpoint)).status,403,endpoint);
 h.control({customerAccessStatus:0,r3bCustomerRequestId:h.state().liveRequests[0].id});for(const endpoint of endpoints)assert.equal((await h.dispatch('GET',endpoint,undefined,h.state().liveRequests[0].id)).status,403,endpoint);
});

test('fixture replay attempts and server-side proof expiry are observable without rewriting original signed data',async()=>{
 const h=companyRevisionFixtureHarness();h.control({r3bLegacyInvalidPhone:true});const base=`/api/admin/quote-requests/${h.requestId}/company-revisions`,sourceBefore=h.state(),first=await h.dispatch('GET',base);
 assert.ok(first.body.sourceIssues.some((issue:{field:string})=>issue.field==='payload.contact.phone'));
 const payload=first.body.initialPayload,input={expectedRevision:0,idempotencyKey:randomUUID(),reason:'Legacy original retained',payload};h.control({r3bLoseNextResponse:true});assert.equal((await h.dispatch('PUT',base,input)).status,503);assert.equal((await h.dispatch('PUT',base,input)).status,200);
 const attempts=h.state().r3bAttempts;assert.equal(attempts.length,2);assert.deepEqual(attempts[0].input,attempts[1].input);assert.equal(attempts.filter((row:{replay:boolean})=>!row.replay).length,1);assert.equal(attempts[1].replay,true);assert.equal(h.state().r3bReceipts.length,1);
 let saved=await h.dispatch('GET',base);const command={revisionId:saved.body.current.id,expectedRevision:1,idempotencyKey:randomUUID(),reason:'Strict publication gate'};const blocked=await h.dispatch('POST',base+'/publish',command);assert.equal(blocked.status,422);assert.ok(blocked.body.fields['payload.contact.phone']);assert.equal(h.outbox().length,0);
 const changed={...payload,contact:{...payload.contact,phone:'Still invalid new phone'}};const rejected=await h.dispatch('PUT',base,{...input,expectedRevision:1,idempotencyKey:randomUUID(),payload:changed});assert.equal(rejected.status,422);assert.ok(rejected.body.fields['payload.contact.phone']);
 saved=await h.dispatch('PUT',base,{...input,expectedRevision:1,idempotencyKey:randomUUID(),payload:{...payload,contact:{...payload.contact,phone:'0400 000 000'}}});assert.equal(saved.status,200);
 const publication=await h.dispatch('POST',base+'/publish',{...command,expectedRevision:2,idempotencyKey:randomUUID()});assert.equal(publication.status,200);const current=publication.body.detail.current;
 const review=await h.dispatch('POST','/api/quote/requests/company-revision/review',{revisionId:current.id,snapshotHash:current.snapshotHash});assert.ok(Date.parse(review.body.review.expiresAt)>Date.now());h.control({r3bExpireProofs:true});
 const accept={revisionId:current.id,expectedRevision:3,idempotencyKey:randomUUID(),reviewProof:review.body.review.reviewProof,acknowledgmentVersion:COMPANY_REVISION_ACK.version,acknowledged:true,signature:{name:'Synthetic New Signature',method:'typed',strokes:[],acknowledged:true}};const expired=await h.dispatch('POST','/api/quote/requests/company-revision/accept',accept);assert.equal(expired.status,409);assert.equal(expired.body.code,'review_proof_expired');assert.equal(h.outbox().length,1);
 assert.deepEqual(h.state().liveBookings,sourceBefore.liveBookings);assert.deepEqual(h.state().liveRequests,sourceBefore.liveRequests);
});

for (const attempted of [false,true]) test(`fixture withdrawal matches real DTO and ${attempted?'preserves attempted retry evidence':'cancels an unattempted notice'}`,async()=>{
 const h=companyRevisionFixtureHarness(),before=h.state(),base=`/api/admin/quote-requests/${h.requestId}/company-revisions`,initial=await h.dispatch('GET',base),payload={...initial.body.initialPayload,contact:{...initial.body.initialPayload.contact,phone:''}};
 const saved=await h.dispatch('PUT',base,{expectedRevision:0,idempotencyKey:randomUUID(),reason:'Synthetic withdrawal contract',payload}),revisionId=saved.body.receipt.childId;
 const published=await h.dispatch('POST',base+'/publish',{revisionId,expectedRevision:1,idempotencyKey:randomUUID(),reason:'Ready to review'});assert.equal(published.status,200);
 if(attempted)h.control({r3bAttemptRevisionNotice:revisionId});
 const beforeWithdraw=h.outbox(),withdrawn=await h.dispatch('POST',base+'/withdraw',{revisionId,expectedRevision:2,idempotencyKey:randomUUID(),reason:'Withdraw before acceptance'});assert.equal(withdrawn.status,200);
 const outbox=h.outbox();assert.equal(outbox.length,1);assert.deepEqual(outbox,attempted?beforeWithdraw:beforeWithdraw.map(row=>({...row,emailStatus:'cancelled',errorCode:'revision_withdrawn'})));
 assert.equal(outbox[0].emailStatus,attempted?'retrying':'cancelled');assert.equal(outbox[0].errorCode,attempted?'email_outcome_unknown':'revision_withdrawn');assert.equal(outbox[0].providerMessageId,null);assert.equal(outbox.filter(row=>row.emailStatus==='provider_accepted').length,0);
 if(attempted)assert.ok(Number.isFinite(Date.parse(outbox[0].emailFirstAttemptAt!)));else assert.equal(outbox[0].emailFirstAttemptAt,null);
 assert.equal(withdrawn.body.detail.current.emailStatus,outbox[0].emailStatus);assert.equal('errorCode'in withdrawn.body.detail.current,false);
 const customer=await h.dispatch('GET','/api/quote/requests/company-revision');assert.equal(customer.body.current.status,'withdrawn');assert.equal(customer.body.current.emailStatus,outbox[0].emailStatus);
 assert.deepEqual(h.state().liveBookings,before.liveBookings);assert.deepEqual(h.state().liveRequests,before.liveRequests);
 const db=await currentWorkDb();try{
  const f=await seedCompanyFixture(db,{simple:true,pricingVersion:'lk-sydney-cabinet-v3-20261014'});
  type StateResult={detail:{current:Record<string,unknown>};receipt:{childId:string};snapshotHash:string};
  const rpc=async<T=StateResult>(command:string,args:Record<string,unknown>)=>(await db.query<{result:T}>('select public.lk_quote_company_revision_command($1,$2::jsonb) result',[command,JSON.stringify({companyId:'lk-group',...args})])).rows[0].result;
  const realSaved=await rpc('revision_save',{...f.staffArgs,expectedRevision:0,idempotencyKey:randomUUID(),reason:'Synthetic withdrawal contract',payload}),realId=realSaved.receipt.childId,input={...f.staffArgs,revisionId:realId,expectedRevision:1,idempotencyKey:randomUUID(),reason:'Ready to review'},prep=await rpc('revision_prepare_publish',input),pdfBase64=Buffer.from('%PDF fixed synthetic withdrawal').toString('base64');
  await rpc('revision_publish',{...input,snapshotHash:prep.snapshotHash,frozenMail:{pdfBase64,pdfHash:fixtureHash('%PDF fixed synthetic withdrawal'),payload:{to:[f.email],subject:'Synthetic withdrawal',attachments:[{filename:'revision.pdf',content:pdfBase64}]}}});
  if(attempted){const claim=await rpc<{id:string;leaseToken:string}>('worker_claim',{requestId:f.requestId,leaseToken:randomUUID()});await rpc('worker_email_attempt',claim);await rpc('worker_error',{...claim,outcome:'retrying',errorCode:'email_outcome_unknown'});}
  const real=await rpc('revision_withdraw',{...f.staffArgs,revisionId:realId,expectedRevision:2,idempotencyKey:randomUUID(),reason:'Withdraw before acceptance'});
  assert.deepEqual(Object.keys(withdrawn.body.detail.current).sort(),Object.keys(real.detail.current).sort());assert.equal(withdrawn.body.detail.current.emailStatus,real.detail.current.emailStatus);
  const row=(await db.query<{email_status:string;error_code:string;email_first_attempt_at:Date|null;provider_message_id:string|null}>('select email_status,error_code,email_first_attempt_at,provider_message_id from public.lk_quote_company_revision_outbox where revision_id=$1',[realId])).rows[0];
  assert.equal(row.email_status,outbox[0].emailStatus);assert.equal(row.error_code,outbox[0].errorCode);assert.equal(row.email_first_attempt_at===null,outbox[0].emailFirstAttemptAt===null);assert.equal(row.provider_message_id,null);
  assert.equal(await rpc('worker_claim',{requestId:f.requestId,leaseToken:randomUUID()}),null);
 }finally{await db.close()}
});
