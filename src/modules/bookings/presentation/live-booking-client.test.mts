import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPANY_BOOKING_SITE_DAMAGE_NOTE, COMPANY_BOOKING_ACK_TEXT, COMPANY_BOOKING_ACK_VERSION, type LiveCompanyBookingState, type LiveCompanyProposal } from '../domain/live-contracts.ts';
import { companyBookingRequest, companyDraftAfterRead, companyPeriodSummary, companyProcessingRetryable, companySegmentLabel, currentAcceptance, dollarsToCents, LiveCompanyRequestError, newerCompanyState, parseCompanyCheck, parseCompanyProposal, parseCompanyReview, parseCompanyState, periodPayload, shiftDay, type CompanyPeriodInput, signedRequestConfirmationPayload, usesSignedRequestBooking } from './live-booking-client.ts';
import { companyBookingTone } from './booking-status-tone.ts';

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
  assert.equal(parseCompanyProposal({ ...proposal, confirmationBasis: null, companyNote: null }).companyNote, undefined, 'nullable legacy metadata does not change the original proposal');
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

import { BOOKING_SIMPLE_ACK_VERSION, BOOKING_SIMPLE_ACK_TEXT } from '../../quotes/domain/booking-flow.ts';
const signedSubmission = { id: 'signed-submission', requestId, preferredDate: '2026-10-29', preferredTime: '10:30', snapshot: { version: BOOKING_SIMPLE_ACK_VERSION, acknowledgment: { version: BOOKING_SIMPLE_ACK_VERSION, text: BOOKING_SIMPLE_ACK_TEXT }, preferredDate: '2026-10-29', preferredTime: '10:30', pricing: { total: 165000 } } };
const signedState = { ...state, submission: signedSubmission, proposal: null, proposals: [] } as unknown as LiveCompanyBookingState;
const visits = { takeOffEndLocal: '2026-10-29T12:00', installStartLocal: '2026-11-02T09:30', installEndLocal: '2026-11-02T13:00', companyNote: '  Please provide clear cabinet access.  ' };
test('single signed-request confirmation payload derives no price or customer start and requires both manually entered visit durations', () => {
  assert.deepEqual(signedRequestConfirmationPayload(signedState, visits, 'one-command-key'), { expectedRevision: 2, idempotencyKey: 'one-command-key', takeOffEndLocal: visits.takeOffEndLocal, installStartLocal: visits.installStartLocal, installEndLocal: visits.installEndLocal, companyNote: 'Please provide clear cabinet access.' });
  for (const input of [{ ...visits, takeOffEndLocal: '' }, { ...visits, takeOffEndLocal: '2026-10-29T10:30' }, { ...visits, installStartLocal: '2026-10-29T11:30' }, { ...visits, installEndLocal: visits.installStartLocal }, { ...visits, installStartLocal: '2026-02-30T09:30' }, { ...visits, companyNote: 'x'.repeat(3001) }]) assert.throws(() => signedRequestConfirmationPayload(signedState, input, 'key'));
  assert.equal(signedRequestConfirmationPayload(signedState, { ...visits, companyNote: '   ' }, 'key').companyNote, COMPANY_BOOKING_SITE_DAMAGE_NOTE, 'a dates-only confirmation always includes the standard site damage notice');
  assert.equal(signedRequestConfirmationPayload(signedState, { ...visits, companyNote: 'x'.repeat(3000) }, 'key').companyNote.length, 3000);
  assert.throws(() => signedRequestConfirmationPayload({ ...signedState, submission: { ...signedState.submission, preferredTime: null } }, visits, 'key'));
  assert.throws(() => signedRequestConfirmationPayload({ ...signedState, booking: { status: 'confirmed' } } as LiveCompanyBookingState, visits, 'key'));
});
test('v2 booking recovery protects the original estimate, selected time, two purpose-tagged visits and signed submission identity', () => {
  const signedProposal = { ...proposal, confirmationBasis: 'signed_request', companyNote: 'Keep cabinet access clear.', segments: [ { kind: 'timed', purpose: 'take_off', startDate: '2026-10-29', endDate: '2026-10-30', startLocal: '2026-10-29T10:30', endLocal: '2026-10-29T12:00', startAt: '2026-10-28T23:30:00Z', endAt: '2026-10-29T01:00:00Z' }, { kind: 'timed', purpose: 'install', startDate: '2026-11-02', endDate: '2026-11-03', startLocal: '2026-11-02T09:30', endLocal: '2026-11-02T13:00', startAt: '2026-11-01T22:30:00Z', endAt: '2026-11-02T02:00:00Z' } ] };
  const booking = { id: 'booking', proposalId: signedProposal.id, proposalHash: signedProposal.hash, confirmationBasis: 'signed_request', signedSubmissionId: signedSubmission.id, status: 'confirming', events: [] };
  const current = { ...signedState, proposal: signedProposal, proposals: [signedProposal], booking };
  assert.equal(parseCompanyState({ state: current }, requestId)?.booking?.signedSubmissionId, signedSubmission.id);
  for (const changed of [{ ...signedProposal, amountExGst: 160000, gst: 16000, total: 176000 }, { ...signedProposal, segments: signedProposal.segments.map((segment, i) => i === 0 ? { ...segment, startLocal: '2026-10-29T11:00' } : segment) }, { ...signedProposal, segments: signedProposal.segments.map(segment => ({ ...segment, purpose: 'install' })) }]) assert.throws(() => parseCompanyState({ state: { ...current, proposal: changed, proposals: [changed] } }, requestId));
  assert.throws(() => parseCompanyState({ state: { ...current, booking: { ...booking, signedSubmissionId: 'another-submission' } } }, requestId));
  assert.throws(() => parseCompanyState({ state: { ...signedState, proposal, proposals: [proposal] } }, requestId), 'new signed requests cannot be confused with old company-proposal loops');
});
test('only the newly signed v2 wording enables a one-confirmation EMS workflow; legacy signatures retain their original approval path', () => {
  assert.equal(usesSignedRequestBooking(signedState), true);
  assert.equal(usesSignedRequestBooking({ ...state, submission: { ...state.submission, snapshot: { version: 'live-booking-request-ack-v1' } } } as LiveCompanyBookingState), false);
});

test('company booking badge tones preserve existing confirmed, processing and review labels', () => {
  for (const [status, tone, label] of [['confirmed', 'success', 'Confirmed and Google verified'], ['confirming', 'info', 'Confirmation processing'], ['review_required', 'danger', 'Company review required']] as const) {
    assert.deepEqual(companyBookingTone({ ...state, booking: { status } as NonNullable<LiveCompanyBookingState['booking']> }), { tone, label });
  }
});
test('company booking badges distinguish company action, customer response and draft states', () => {
  const legacy = { ...state, submission: { ...state.submission, snapshot: { version: 'live-booking-request-ack-v1' } } } as LiveCompanyBookingState;
  const acceptance = { id: 'acceptance', proposalId: proposal.id, proposalHash: proposal.hash, acceptedAt: '2026-10-25T00:00:00Z', signature: { name: 'Synthetic customer' }, acknowledgmentVersion: COMPANY_BOOKING_ACK_VERSION, acknowledgmentText: COMPANY_BOOKING_ACK_TEXT, emailStatus: 'pending', receiptReady: false } as NonNullable<LiveCompanyBookingState['acceptance']>;
  assert.deepEqual(companyBookingTone({ ...legacy, acceptance }), { tone: 'warning', label: 'Awaiting company confirmation' });
  for (const stale of [{ ...acceptance, proposalId: 'older-proposal' }, { ...acceptance, proposalHash: 'older-hash' }]) assert.deepEqual(companyBookingTone({ ...legacy, acceptance: stale }), { tone: 'info', label: 'Awaiting customer' });
  assert.deepEqual(companyBookingTone(legacy), { tone: 'info', label: 'Awaiting customer' });
  assert.deepEqual(companyBookingTone({ ...legacy, proposal: { ...proposal, status: 'draft' } }), { tone: 'warning', label: 'Company draft' });
  assert.deepEqual(companyBookingTone({ ...legacy, proposal: null }), { tone: 'warning', label: 'Awaiting company review' });
  for (const status of ['confirmed', 'confirming', 'review_required'] as const) assert.deepEqual(companyBookingTone({ ...legacy, acceptance, booking: { status } as NonNullable<LiveCompanyBookingState['booking']> }), companyBookingTone({ ...legacy, booking: { status } as NonNullable<LiveCompanyBookingState['booking']> }));
});
test('signed requests await company review before acceptance checks, while existing bookings keep priority', () => {
  assert.deepEqual(companyBookingTone(signedState), { tone: 'warning', label: 'Awaiting company review' });
  const acceptance = { id: 'acceptance', proposalId: proposal.id, proposalHash: proposal.hash, acceptedAt: '2026-10-25T00:00:00Z', signature: { name: 'Synthetic customer' }, acknowledgmentVersion: COMPANY_BOOKING_ACK_VERSION, acknowledgmentText: COMPANY_BOOKING_ACK_TEXT, emailStatus: 'pending', receiptReady: false } as NonNullable<LiveCompanyBookingState['acceptance']>;
  // This synthetic overlap fixes tone precedence; real signed-request parsing rejects acceptance.
  assert.deepEqual(companyBookingTone({ ...signedState, proposal, acceptance }), { tone: 'warning', label: 'Awaiting company review' });
  for (const [status, tone, label] of [['confirmed', 'success', 'Confirmed and Google verified'], ['confirming', 'info', 'Confirmation processing'], ['review_required', 'danger', 'Company review required']] as const) assert.deepEqual(companyBookingTone({ ...signedState, booking: { status } as NonNullable<LiveCompanyBookingState['booking']> }), { tone, label });
});

test('legacy submitted requests without a company proposal await company review', () => {
  const pending = { ...state, proposal: null, proposals: [], acceptance: null, booking: null, submission: { ...state.submission, snapshot: { version: 'live-booking-request-ack-v1' } } } as LiveCompanyBookingState;
  assert.deepEqual(companyBookingTone(pending), { tone: 'warning', label: 'Awaiting company review' });
});
