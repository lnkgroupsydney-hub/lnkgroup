import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPANY_BOOKING_ACK_TEXT, COMPANY_BOOKING_ACK_VERSION, type LiveCompanyBookingState, type LiveCompanyProposal } from '../domain/live-contracts.ts';
import { companyBookingRequest, companyDraftAfterRead, companyPeriodSummary, companyProcessingRetryable, companySegmentLabel, currentAcceptance, dollarsToCents, LiveCompanyRequestError, newerCompanyState, parseCompanyCheck, parseCompanyProposal, parseCompanyReview, parseCompanyState, periodPayload, shiftDay, type CompanyPeriodInput } from './live-booking-client.ts';

const requestId='895f8919-7e19-4506-972d-944285b0185a';
const proposal={id:'company-proposal',version:1,revision:1,status:'published',hash:'immutable-proposal-hash',amountExGst:150000,gst:15000,total:165000,currency:'AUD',scope:'Cabinet repainting only',adjustmentReason:'Site quantity confirmed',calendarTarget:{calendarId:'lnkgroupsydney@gmail.com',accountEmail:'lnkgroupsydney@gmail.com'},segments:[{kind:'all_day',startDate:'2026-10-20',endDate:'2026-10-22',startAt:'2026-10-19T13:00:00Z',endAt:'2026-10-21T13:00:00Z'}]} as LiveCompanyProposal;
const acknowledgment={version:COMPANY_BOOKING_ACK_VERSION,text:COMPANY_BOOKING_ACK_TEXT};
const state={requestId,revision:2,submission:{requestId},proposal,proposals:[proposal],acceptance:null,booking:null,acknowledgment} as unknown as LiveCompanyBookingState;

test('final company amount converts decimal dollars to exact bounded cents',()=>{
  assert.equal(dollarsToCents('1500'),150000);assert.equal(dollarsToCents('1500.01'),150001);assert.equal(dollarsToCents('0.10'),10);
  for(const value of ['-1','0','1.005','1e3','NaN','Infinity','1,500','1000000.01'])assert.throws(()=>dollarsToCents(value));
});
test('all-day last work day is inclusive in UI and exclusive in the saved payload across month/year/leap boundaries',()=>{
  const periods=[{key:'a',kind:'all_day',startDate:'2026-12-30',lastDate:'2027-01-01',startLocal:'',endLocal:''}] as CompanyPeriodInput[];
  assert.deepEqual(periodPayload(periods),[{kind:'all_day',startDate:'2026-12-30',endDate:'2027-01-02'}]);
  assert.equal(shiftDay('2028-02-29',1),'2028-03-01');assert.throws(()=>shiftDay('2026-02-30',1));assert.throws(()=>shiftDay('not-a-day',1));
  assert.match(companySegmentLabel(proposal.segments[0]),/2026-10-20 to 2026-10-21 inclusive/);
});
test('timed periods preserve Sydney local input and reject missing or reversed intervals',()=>{
  const timed={key:'t',kind:'timed',startDate:'',lastDate:'',startLocal:'2026-10-23T09:15',endLocal:'2026-10-23T14:45'} as CompanyPeriodInput;
  assert.deepEqual(periodPayload([timed]),[{kind:'timed',startLocal:timed.startLocal,endLocal:timed.endLocal}]);
  assert.throws(()=>periodPayload([{...timed,endLocal:timed.startLocal}]));assert.throws(()=>periodPayload([]));assert.throws(()=>periodPayload(Array(21).fill(timed)));
});
test('period summary counts civil all-day dates and explicit timed hours without filling gaps or inferring working hours',()=>{
  const mixed={...proposal,segments:[...proposal.segments,{kind:'timed',startDate:'2026-10-24',endDate:'2026-10-25',startAt:'2026-10-23T22:15:00Z',endAt:'2026-10-24T03:45:00Z'}]} as LiveCompanyProposal;
  assert.equal(companyPeriodSummary(mixed),'2 all-day work dates · 5.5 hours in timed periods · 2 periods');
});
test('company recovery rejects another request, mismatched history and forged totals or acknowledgment',()=>{
  assert.equal(parseCompanyState({state},requestId)?.requestId,requestId);assert.equal(parseCompanyState({state:null},requestId),null);
  for(const value of [{...state,requestId:'other'},{...state,proposals:[]},{...state,acknowledgment:{...acknowledgment,text:'payment obligation'}}])assert.throws(()=>parseCompanyState({state:value},requestId));
  assert.throws(()=>parseCompanyProposal({...proposal,total:165001}));assert.throws(()=>parseCompanyProposal({...proposal,amountExGst:-1}));
});
test('customer acknowledgment is tied to the exact published proposal ID and hash',()=>{
  const acceptance={id:'acceptance',proposalId:proposal.id,proposalHash:proposal.hash,acceptedAt:'2026-10-13T00:00:00Z',signature:{name:'QA Customer'},acknowledgmentVersion:acknowledgment.version};
  assert.equal(currentAcceptance({...state,acceptance} as unknown as LiveCompanyBookingState),true);
  assert.equal(currentAcceptance({...state,acceptance:{...acceptance,proposalHash:'old-hash'}} as unknown as LiveCompanyBookingState),false);
  assert.throws(()=>parseCompanyState({state:{...state,acceptance:{...acceptance,proposalId:'other-request-proposal'}}},requestId));
});
test('review proof rejects changed proposal, expired proof and invented contract language',()=>{
  const review={proposal,acknowledgment,reviewProof:'encrypted-review',expiresAt:new Date(Date.now()+60_000).toISOString()};
  assert.equal(parseCompanyReview({review},proposal).reviewProof,review.reviewProof);
  for(const value of [{...review,proposal:{...proposal,hash:'changed'}},{...review,expiresAt:'2000-01-01T00:00:00Z'},{...review,acknowledgment:{...acknowledgment,text:'Invented binding contract'}}])assert.throws(()=>parseCompanyReview({review:value},proposal));
});
test('a later response cannot replace a newer saved company revision',()=>{
  const current={...state,revision:8};assert.equal(newerCompanyState(current,{...state,revision:7}),current);assert.equal(newerCompanyState(current,{...state,revision:9})?.revision,9);
});
test('own published version and later clean status reads adopt canonical draft without warning while unsaved edits and uncertain commands retain their bound version',()=>{
  const saved={revision:1,dirty:false,amount:'2900.00',scope:'Saved scope'},published={...saved,revision:2};
  assert.equal(companyDraftAfterRead(saved,published,false),published);
  const edited={...saved,dirty:true,amount:'3200.00',scope:'New unsaved scope'};
  assert.equal(companyDraftAfterRead(edited,published,false),edited);assert.equal(companyDraftAfterRead(saved,published,true),saved);
  assert.equal(companyDraftAfterRead(published,saved,false),published);
});
test('pending processing is retryable while confirmed delivery and review-required bookings expose no automatic retry',()=>{
  assert.equal(companyProcessingRetryable({...state,proposal:{...proposal,status:'draft',emailStatus:'pending'}}),false);
  assert.equal(companyProcessingRetryable({...state,proposal:{...proposal,emailStatus:'pending'}}),true);
  for(const [status,emailStatus,expected] of [['confirming','pending',true],['confirmed','pending',true],['confirmed','provider_accepted',false],['review_required','pending',false],['confirmed','manual_review',false]] as const)assert.equal(companyProcessingRetryable({...state,booking:{status,emailStatus}} as LiveCompanyBookingState),expected);
});
test('conflict response keeps all-period source detail and rejects partial invalid periods',()=>{
  const check={checkedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60_000).toISOString(),revision:'check-hash',conflicts:[{segmentIndex:1,source:'google',startAt:'2026-10-22T22:00:00Z',endAt:'2026-10-23T03:00:00Z',message:'A later work period overlaps another event.'}]};
  assert.equal(parseCompanyCheck({check}).conflicts[0].segmentIndex,1);assert.throws(()=>parseCompanyCheck({check:{...check,conflicts:[{...check.conflicts[0],endAt:null}]}}));
});
test('reads and writes bind quote identity, private credentials/cache, and preserve actionable server errors',async()=>{
  const original=globalThis.fetch;const calls:RequestInit[]=[];
  globalThis.fetch=async(_path,init)=>{calls.push(init!);return new Response(JSON.stringify({state}),{status:200,headers:{'content-type':'application/json'}});};
  try {await companyBookingRequest('/api/quote/requests/company-booking',requestId);await companyBookingRequest('/api/quote/requests/company-booking/accept',requestId,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});for(const init of calls){assert.equal(init.cache,'no-store');assert.equal(init.credentials,'same-origin');assert.equal(new Headers(init.headers).get('x-lk-quote-request-id'),requestId);}assert.equal(new Headers(calls[1].headers).get('content-type'),'application/json');
    globalThis.fetch=async()=>new Response(JSON.stringify({error:'The company proposal changed. Review its latest version.'}),{status:409,headers:{'content-type':'application/json'}});await assert.rejects(companyBookingRequest('/api/test',requestId),error=>error instanceof LiveCompanyRequestError&&error.status===409&&error.message.includes('latest version'));
  } finally {globalThis.fetch=original;}
});
