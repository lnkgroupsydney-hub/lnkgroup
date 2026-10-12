import test from 'node:test';
import assert from 'node:assert/strict';
import type { LiveCompanyBookingState } from './domain/live-contracts.ts';
import { companyClaim, companyTestNow } from './live-test-data.mts';
import { reconcileLiveCompanyBookingBatch } from './live-maintenance.ts';

function confirmedState(): LiveCompanyBookingState {
  const claim=companyClaim();
  claim.booking!.status='confirmed';claim.booking!.confirmedAt=new Date(companyTestNow).toISOString();
  return {requestId:claim.requestId,revision:4,submission:claim.submission,proposal:claim.proposal,proposals:[claim.proposal],acceptance:claim.acceptance,booking:claim.booking,acknowledgment:{version:claim.acceptance!.acknowledgmentVersion,text:claim.acceptance!.acknowledgmentText}};
}
function harness(count=1){
  const states=Array.from({length:count},confirmedState), commands:{name:string;args:Record<string,unknown>}[]=[],reads:string[]=[];
  const holds=states.map(state=>({bookingId:state.booking!.id,segments:structuredClone(state.proposal!.segments)}));
  let clock=companyTestNow;
  const deps={now:()=>clock,maxJobs:1 as number|undefined,reconcile:async(state:LiveCompanyBookingState)=>{reads.push(state.requestId);return {ok:true,error:null as string|null};},command:async<T>(name:string,args:Record<string,unknown>):Promise<T>=>{
    commands.push({name,args:structuredClone(args)});
    if(name==='reconcile_batch')return {states} as T;
    assert.equal(name,'reconcile_result','maintenance must never release holds, rewrite customer evidence or create a new event');
    const state=states.find(state=>state.booking?.id===args.bookingId);assert.ok(state);
    if(args.ok===false)state.booking!.status='review_required';
    return structuredClone(state) as T;
  }};
  return {states,commands,reads,holds,deps,advance:(milliseconds:number)=>{clock+=milliseconds;}};
}

test('transient Google timeout, OAuth and quota failures do not mark a confirmed booking as externally changed',async()=>{
  for(const code of ['company_calendar_unavailable','timeout','oauth_unavailable','google_429']){
    const h=harness(),originalHolds=structuredClone(h.holds);h.deps.reconcile=async()=>{throw Object.assign(new Error('Synthetic temporary provider failure'),{code});};
    assert.deepEqual(await reconcileLiveCompanyBookingBatch(h.deps),{checked:0,reviewRequired:0,unavailable:1,storageErrors:0});
    assert.equal(h.states[0].booking!.status,'confirmed');assert.deepEqual(h.holds,originalHolds);assert.deepEqual(h.commands.map(command=>command.name),['reconcile_batch']);
  }
});
test('a proven external drift is persisted as review-required while exact work holds and customer acknowledgment remain unchanged',async()=>{
  const h=harness(),originalHolds=structuredClone(h.holds),acceptance=structuredClone(h.states[0].acceptance),proposal=structuredClone(h.states[0].proposal);
  h.deps.reconcile=async()=>({ok:false,error:'Google work period was moved externally.'});
  assert.deepEqual(await reconcileLiveCompanyBookingBatch(h.deps),{checked:1,reviewRequired:1,unavailable:0,storageErrors:0});
  assert.deepEqual(h.commands[1],{name:'reconcile_result',args:{bookingId:h.states[0].booking!.id,ok:false,error:'Google work period was moved externally.'}});
  assert.equal(h.states[0].booking!.status,'review_required');assert.deepEqual(h.holds,originalHolds);assert.deepEqual(h.states[0].acceptance,acceptance);assert.deepEqual(h.states[0].proposal,proposal);
});
test('healthy verification is persisted for the existing booking without issuing another confirmation or changing work periods',async()=>{
  const h=harness(),originalHolds=structuredClone(h.holds);
  assert.deepEqual(await reconcileLiveCompanyBookingBatch(h.deps),{checked:1,reviewRequired:0,unavailable:0,storageErrors:0});
  assert.deepEqual(h.commands[1],{name:'reconcile_result',args:{bookingId:h.states[0].booking!.id,ok:true,error:null}});assert.deepEqual(h.holds,originalHolds);
});
test('batch storage failures and incomplete batch responses are classified as storage errors before any Google call',async()=>{
  for(const mode of ['throws','missing-states','wrong-states']){
    const h=harness();h.deps.command=async<T>()=>{if(mode==='throws')throw Error('Synthetic storage outage');return (mode==='missing-states'?{}:{states:null}) as T;};
    assert.deepEqual(await reconcileLiveCompanyBookingBatch(h.deps),{checked:0,reviewRequired:0,unavailable:0,storageErrors:1});assert.deepEqual(h.reads,[]);assert.equal(h.states[0].booking!.status,'confirmed');
  }
});
test('failure to store a verified result is a storage error and cannot report a successful review transition',async()=>{
  for(const ok of [true,false]){
    const h=harness(),command=h.deps.command,originalHolds=structuredClone(h.holds);h.deps.reconcile=async()=>({ok,error:ok?null:'Proven external drift'});h.deps.command=async<T>(name,args)=>{if(name==='reconcile_result')throw Error('Synthetic write outage');return command<T>(name,args);};
    assert.deepEqual(await reconcileLiveCompanyBookingBatch(h.deps),{checked:0,reviewRequired:0,unavailable:0,storageErrors:1});assert.equal(h.states[0].booking!.status,'confirmed');assert.deepEqual(h.holds,originalHolds);
  }
});
test('the daily default checks one booking, explicit jobs are capped at five, and zero jobs performs no provider work',async()=>{
  for(const [maxJobs,expected] of [[undefined,1],[1,1],[3,3],[5,5],[99,5],[0,0]] as const){
    const h=harness(8);h.deps.maxJobs=maxJobs;const result=await reconcileLiveCompanyBookingBatch(h.deps);assert.equal(result.checked,expected);assert.equal(h.reads.length,expected);assert.equal(h.commands.filter(command=>command.name==='reconcile_result').length,expected);
  }
});
test('negative, non-finite or fractional job limits never exceed the five-row bound',async()=>{
  for(const maxJobs of [-1,Number.NaN,Number.NEGATIVE_INFINITY,2.9]){
    const h=harness(12);h.deps.maxJobs=maxJobs;const result=await reconcileLiveCompanyBookingBatch(h.deps);assert.ok(result.checked>=0&&result.checked<=5);assert.ok(h.reads.length<=5);
  }
});
test('the forty-second budget prevents starting the next booking while completing the current bounded verification',async()=>{
  const h=harness(4);h.deps.maxJobs=4;h.deps.reconcile=async(state)=>{h.reads.push(state.requestId);h.advance(40_000);return {ok:true,error:null};};
  assert.deepEqual(await reconcileLiveCompanyBookingBatch(h.deps),{checked:1,reviewRequired:0,unavailable:0,storageErrors:0});assert.equal(h.reads.length,1);
});
test('time consumed by the initial storage read prevents any later Google verification after budget expiration',async()=>{
  const h=harness(4),command=h.deps.command;h.deps.maxJobs=4;h.deps.command=async<T>(name,args)=>{const value=await command<T>(name,args);if(name==='reconcile_batch')h.advance(40_000);return value;};
  assert.deepEqual(await reconcileLiveCompanyBookingBatch(h.deps),{checked:0,reviewRequired:0,unavailable:0,storageErrors:0});assert.deepEqual(h.reads,[]);
});
test('a transient provider error on one booking does not prevent a later bounded booking from being checked',async()=>{
  const h=harness(3);h.deps.maxJobs=3;h.deps.reconcile=async(state)=>{h.reads.push(state.requestId);if(state.requestId===h.states[0].requestId)throw Error('Synthetic transient outage');return {ok:true,error:null};};
  assert.deepEqual(await reconcileLiveCompanyBookingBatch(h.deps),{checked:2,reviewRequired:0,unavailable:1,storageErrors:0});assert.equal(h.reads.length,3);assert.equal(h.states[0].booking!.status,'confirmed');
});
