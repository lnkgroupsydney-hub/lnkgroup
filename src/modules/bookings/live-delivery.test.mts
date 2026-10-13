import test from 'node:test'
import assert from 'node:assert/strict'
import {companyClaim,companyTestNow,companyTestSender} from './live-test-data.mts'
import {processCompanyBookingOutbox,type CompanyBookingDeliveryPorts} from './live-delivery.ts'
import {createCompanyBookingMail,validCompanyBookingMail} from './infrastructure/live-receipt.ts'
import type {LiveCompanyWorkerClaim} from './domain/live-contracts.ts'
import {COMPANY_BOOKING_SITE_DAMAGE_NOTE} from './domain/live-contracts.ts'
import {BOOKING_SIMPLE_ACK_VERSION,bookingAcknowledgment} from '../quotes/domain/booking-flow.ts'
import {QUOTE_PRICING_VERSION} from '../quotes/domain/pricing.ts'
function signedRequestClaim(){
 const c=companyClaim();c.acceptance=null;c.submission.preferredTime='09:00';c.submission.snapshot.preferredTime='09:00';c.submission.snapshot.version=BOOKING_SIMPLE_ACK_VERSION;c.submission.snapshot.acknowledgment=bookingAcknowledgment()
 c.submission.calendarStatus='not_required';c.submission.calendarEventId=null
 c.submission.snapshot.pricing.pricingVersion=QUOTE_PRICING_VERSION
 c.submission.snapshot.pricing.lineItems=[{code:'doors',label:'Estimated cabinet door preparation and painting',quantity:10,unitAmount:15000,amount:150000}]
 c.submission.snapshot.pricing.basis={type:'ai_estimated_quantities',extent:'whole_project',anchorPhotoId:c.submission.snapshot.photos[0].id,doors:10,drawers:0}
 c.proposal.amountExGst=150000;c.proposal.gst=15000;c.proposal.total=165000;c.proposal.confirmationBasis='signed_request';c.proposal.companyNote=COMPANY_BOOKING_SITE_DAMAGE_NOTE
 c.proposal.segments=[{purpose:'take_off',kind:'timed',startDate:'2026-10-20',endDate:'2026-10-21',startLocal:'2026-10-20T09:00',endLocal:'2026-10-20T10:00',startAt:'2026-10-19T22:00:00.000Z',endAt:'2026-10-19T23:00:00.000Z'},{purpose:'install',kind:'timed',startDate:'2026-10-26',endDate:'2026-10-27',startLocal:'2026-10-26T09:00',endLocal:'2026-10-26T11:00',startAt:'2026-10-25T22:00:00.000Z',endAt:'2026-10-26T00:00:00.000Z'}]
 c.booking!.confirmationBasis='signed_request';c.booking!.signedSubmissionId=c.submission.id
 return c
}
function harness(kind:LiveCompanyWorkerClaim['kind']='confirmation'){
 let claim=companyClaim(kind),busy=false;const commands:string[]=[],payloads:string[]=[],keys:string[]=[]
 const deps:CompanyBookingDeliveryPorts={config:{enabled:true,apiKey:'synthetic',sender:companyTestSender},now:()=>companyTestNow,calendar:async(c,callbacks)=>{commands.push('calendar');await callbacks.assertLease();for(let i=0;i<c.proposal.segments.length;i++)await callbacks.recordEvent({segmentIndex:i,eventId:'synthetic-'+i,payloadHash:'d'.repeat(64),etag:'"verified"',verifiedAt:new Date(companyTestNow).toISOString()});return {...c.proposal.calendarTarget,checkedAt:new Date(companyTestNow).toISOString(),expiresAt:new Date(companyTestNow+60000).toISOString(),revision:'synthetic',conflicts:[]}},request:(async(_url,init)=>{payloads.push(String(init?.body));keys.push(new Headers(init?.headers).get('Idempotency-Key')!);return Response.json({id:'provider-id'})}) as typeof fetch,command:async<T>(name:string,args:Record<string,unknown>)=>{
  commands.push(name)
  if(name==='worker_claim'){if(busy||claim.emailStatus==='provider_accepted')return null as T;busy=true;claim.leaseToken=String(args.leaseToken);return structuredClone(claim) as T}
  assert.equal(args.leaseToken,claim.leaseToken);assert.equal(args.id,claim.id)
  if(name==='record_event')claim.booking!.events.push({segmentIndex:Number(args.segmentIndex),eventId:String(args.eventId),payloadHash:String(args.payloadHash),etag:String(args.etag),verifiedAt:String(args.verifiedAt)})
  if(name==='finish_calendar'){assert.deepEqual(args.calendarCheck,{...claim.proposal.calendarTarget,checkedAt:new Date(companyTestNow).toISOString(),expiresAt:new Date(companyTestNow+60000).toISOString(),revision:'synthetic',conflicts:[],proposalHash:claim.proposal.hash});claim.booking!.status='confirmed';claim.booking!.confirmedAt=new Date(companyTestNow).toISOString()}
  if(name==='freeze_mail')claim.frozenMail={pdfBase64:String(args.pdfBase64),pdfHash:String(args.pdfHash),payload:args.payload as Record<string,unknown>}
  if(name==='email_attempt'){claim.emailStatus='sending';claim.emailFirstAttemptAt??=new Date(companyTestNow).toISOString()}
  if(name==='mail_result'){claim.emailStatus='provider_accepted';busy=false}
  if(name==='worker_error'){if(args.stage==='email')claim.emailStatus=args.outcome as LiveCompanyWorkerClaim['emailStatus'];if(args.stage==='calendar'&&args.outcome==='manual_review')claim.booking!.status='review_required';busy=false}
  return structuredClone(claim) as T
 }}
 return {deps,commands,payloads,keys,claim:()=>claim,setClaim:(c:LiveCompanyWorkerClaim)=>{claim=c},unlock:()=>{busy=false}}
}
test('Calendar and DB confirmation precede receipt freeze, persisted send attempt and provider acceptance',async()=>{
 const h=harness(),r=await processCompanyBookingOutbox(undefined,h.deps);assert.equal(r.confirmed,1);assert.equal(r.accepted,1)
 assert.deepEqual(h.commands,['worker_claim','calendar','assert_lease','record_event','record_event','finish_calendar','freeze_mail','email_attempt','mail_result'])
 const p=JSON.parse(h.payloads[0]);assert.deepEqual(p.to,['verified@example.invalid']);assert.match(p.text,/AUD 1980.01/);assert.match(p.subject,/booking confirmed/);assert.equal(p.reply_to,companyTestSender.replyTo)
})
test('one company confirmation sends take-off and installation with the original request signature and provisional amount',async()=>{
 const h=harness();h.setClaim(signedRequestClaim());const r=await processCompanyBookingOutbox(undefined,h.deps)
 assert.equal(r.confirmed,1);assert.equal(r.accepted,1);assert.equal(h.claim().acceptance,null)
 const p=JSON.parse(h.payloads[0]);assert.match(p.text,/Take-off:/);assert.match(p.text,/Installation:/);assert.match(p.text,/provisional estimate: AUD 1650.00/)
 assert.match(p.text,/additional work and cost will be discussed/i);assert.match(p.text,/No further online approval/);assert.doesNotMatch(p.text,/Final company amount|review the saved proposal/)
 assert.ok(h.commands.indexOf('finish_calendar')<h.commands.indexOf('email_attempt'));assert.ok(validCompanyBookingMail(h.claim().frozenMail,h.claim()))
})
test('signed-request confirmation rejects a changed original time, increased price, forged acceptance or missing source binding',async()=>{
 const complete=async()=>{const h=harness();h.setClaim(signedRequestClaim());await processCompanyBookingOutbox(undefined,h.deps);return h.claim()}
 const c=await complete()
 for(const change of [c=>{c.submission.preferredTime='10:00'},c=>{c.proposal.total+=1100;c.proposal.amountExGst+=1000;c.proposal.gst+=100},c=>{c.booking!.signedSubmissionId='other'},c=>{c.acceptance=companyClaim().acceptance},c=>{c.proposal.segments[0].purpose='install'}]){
  const changed=structuredClone(c);change(changed);await assert.rejects(createCompanyBookingMail(changed,companyTestSender))
 }
})
test('partial Calendar errors and stale lease retain holds and never send confirmation notice',async()=>{
 const h=harness();h.deps.calendar=async()=>{throw Object.assign(Error('External change'),{code:'company_calendar_review_required'})}
 assert.equal((await processCompanyBookingOutbox(undefined,h.deps)).reviewRequired,1);assert.equal(h.payloads.length,0);assert.equal(h.claim().booking!.status,'review_required')
 const short=harness();short.claim().leaseExpiresAt=new Date(companyTestNow+100000).toISOString();assert.equal((await processCompanyBookingOutbox(undefined,short.deps)).retrying,1);assert.equal(short.payloads.length,0)
})
test('provider timeout retries frozen bytes and stable key without another Calendar write',async()=>{
 const h=harness();let attempt=0;h.deps.request=async(_url,init)=>{h.payloads.push(String(init?.body));h.keys.push(new Headers(init?.headers).get('Idempotency-Key')!);if(++attempt===1)throw Error('Unknown outcome');return Response.json({id:'accepted'})}
 assert.equal((await processCompanyBookingOutbox(undefined,h.deps)).retrying,1);assert.equal((await processCompanyBookingOutbox(undefined,h.deps)).accepted,1)
 assert.equal(h.commands.filter(x=>x==='calendar').length,1);assert.equal(h.commands.filter(x=>x==='freeze_mail').length,1);assert.equal(h.payloads[0],h.payloads[1]);assert.equal(h.keys[0],h.keys[1])
})
test('confirmed notice is fenced again after email_attempt; review cannot send stale confirmation',async()=>{
 const h=harness(),command=h.deps.command
 h.deps.command=async<T>(name,args)=>{const result=await command<T>(name,args);if(name==='email_attempt'){h.claim().booking!.status='review_required';return structuredClone(h.claim()) as T}return result}
 const r=await processCompanyBookingOutbox(undefined,h.deps);assert.equal(r.storageErrors,1);assert.equal(h.payloads.length,0)
})
test('expired ambiguity, recipient alteration and frozen-byte DB failures never create a new email',async()=>{
 const expired=harness('proposal_notice');expired.claim().emailFirstAttemptAt=new Date(companyTestNow-24*3600000).toISOString();assert.equal((await processCompanyBookingOutbox(undefined,expired.deps)).reviewRequired,1);assert.equal(expired.payloads.length,0)
 const bad=harness('proposal_notice');bad.deps.createMail=async(c,s)=>{const mail=await createCompanyBookingMail(c,s);mail.payload.to=['other@example.invalid'];return mail};assert.equal((await processCompanyBookingOutbox(undefined,bad.deps)).reviewRequired,1);assert.equal(bad.payloads.length,0)
 const failed=harness('proposal_notice'),command=failed.deps.command;failed.deps.command=async<T>(name,args)=>{if(name==='freeze_mail')throw Error('DB failure');return command<T>(name,args)};assert.equal((await processCompanyBookingOutbox(undefined,failed.deps)).storageErrors,1);assert.equal(failed.payloads.length,0)
})
test('private receipt binds proposal/signature/verified recipient; generated PDF validates for all notice types',async()=>{
 for(const kind of ['proposal_notice','acceptance_receipt','confirmation'] as const){const h=harness(kind);await processCompanyBookingOutbox(undefined,h.deps);const c=h.claim();assert.ok(validCompanyBookingMail(c.frozenMail,c));assert.equal(Buffer.from(c.frozenMail!.pdfBase64,'base64').includes(Buffer.from('PRIVATE-OBJECT-PATH')),false);assert.equal(validCompanyBookingMail({...c.frozenMail,pdfHash:'f'.repeat(64)},c),false)}
 const c=companyClaim('acceptance_receipt');c.acceptance!.proposalHash='f'.repeat(64);await assert.rejects(createCompanyBookingMail(c,companyTestSender))
})
