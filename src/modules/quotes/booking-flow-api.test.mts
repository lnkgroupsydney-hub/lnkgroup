import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createLiveBookingApi } from './infrastructure/booking-flow-api.ts'
import { createQuoteRequestApi } from './infrastructure/api.ts'
import { QuoteRequestError, type QuoteRequestOwner } from './domain/contracts.ts'
import { BOOKING_ACKNOWLEDGMENT_TEXT, BOOKING_ACKNOWLEDGMENT_VERSION, validateBookingSignature, type LiveBookingSnapshot, type LiveBookingState, type LiveBookingAvailability } from './domain/booking-flow.ts'
const base='https://www.lnkgroupsydney.com.au',requestId=randomUUID(),analysisId=randomUUID(),approvalId=randomUUID(),authUserId=randomUUID(),sessionId=randomUUID(),idempotencyKey=randomUUID(),snapshotHash='a'.repeat(64)
const target={accountSub:'company-sub',calendarId:'lnkgroupsydney@gmail.com'},date=new Date(Date.now()+3*86400000).toISOString().slice(0,10)
const acknowledgment={version:BOOKING_ACKNOWLEDGMENT_VERSION,text:BOOKING_ACKNOWLEDGMENT_TEXT}
const snapshot={mode:'live',kind:'nonbinding_booking_request',version:BOOKING_ACKNOWLEDGMENT_VERSION,requestId,reference:'QUOTE-SYNTHETIC',inputRevision:1,analysisId,payload:{contact:{name:'Synthetic',email:'alice@example.invalid'},service:{}},verifiedEmail:'alice@example.invalid',analysis:{},inputSnapshot:{},pricing:{status:'provisional_estimate',total:165000},photos:[],acknowledgment,calendarTarget:target,preferredDate:date} as unknown as LiveBookingSnapshot
let now=Date.now(),current:QuoteRequestOwner,state:LiveBookingState,calendarCalls=0,externalUnavailable=false,submittedArgs:Record<string,unknown>|null=null,enqueued:string[]=[],replay:LiveBookingState|null=null,staffAllowed=true
const customerOwner=()=>({hash:'b'.repeat(64),expiresAt:new Date(now+3600000).toISOString(),customer:{companyId:'lk-group',sessionId,authUserId,email:'alice@example.invalid',requestId}})
const store={async command<T>(command:string,args:Record<string,unknown>):Promise<T>{
 if(command==='read')return {id:requestId} as T
 if(command==='state'||command==='staff_state'||command==='retry')return structuredClone(state) as T
 if(command==='replay')return replay as T
 if(command==='approve')return structuredClone(state) as T
 if(command==='date'){state.approval!.preferredDate=args.preferredDate as string;state.approval!.selectionRevision++;return structuredClone(state) as T}
 if(command==='review')return {snapshot,snapshotHash,approvalId,selectionRevision:state.approval!.selectionRevision} as T
 if(command==='submit'){
  submittedArgs=args
  if(!state.submission&&Date.parse(args.reviewExpiresAt as string)<=now)throw new QuoteRequestError(409,'Review expired.')
  state={...state,canEdit:false,submission:{id:randomUUID(),reference:'REQUEST-SYNTHETIC',requestId,approvalId,preferredDate:date,submittedAt:new Date(now).toISOString(),snapshot,snapshotHash,signedContentHash:'c'.repeat(64),signature:args.signature as ReturnType<typeof validateBookingSignature>,emailStatus:'pending',calendarStatus:'blocked',error:null,receiptReady:false,providerMessageId:null,calendarEventId:null}}
  return structuredClone(state) as T
 }
 if(command==='receipt')throw new QuoteRequestError(409,'Receipt pending.')
 throw Error('Unexpected '+command)
}}
const requests=createQuoteRequestApi({store,authorize:async()=>{if(!staffAllowed)throw new QuoteRequestError(403,'Denied');return{userId:randomUUID(),sessionId:randomUUID(),companyId:'lk-group'}},baseUrl:()=>base,enabled:()=>true,sessionKey:()=>'9a'.repeat(32),now:()=>now,customerOwner:async()=>current})
const api=createLiveBookingApi({access:requests.access,store,now:()=>now,reviewKey:()=>'9a'.repeat(32),calendarTarget:async()=>{calendarCalls++;if(externalUnavailable)throw new QuoteRequestError(503,'Calendar offline');return target},availability:async(month)=>({...target,month,minMonth:month,maxMonth:month,days:[{date,selectable:true}],revision:'v1',checkedAt:new Date(now).toISOString(),expiresAt:new Date(now+60000).toISOString()} satisfies LiveBookingAvailability),dateCheck:async(_date,expected)=>{calendarCalls++;if(externalUnavailable)throw new QuoteRequestError(409,'Calendar busy');return{...target,revision:expected??'v1',checkedAt:new Date(now).toISOString(),expiresAt:new Date(now+60000).toISOString()}},enqueue:id=>enqueued.push(id)})
function req(method='GET',body?:unknown,extra:Record<string,string>={}){return new Request(base+'/api/quote/requests/booking',{method,headers:{host:new URL(base).host,origin:base,'x-lk-quote-request-id':requestId,...(body===undefined?{}:{'content-type':'application/json'}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})})}
async function review(){const response=await api.review(req('POST',{approvalId,selectionRevision:1}));assert.equal(response.status,200,await response.clone().text());return(await response.json()).review as {reviewProof:string;snapshotHash:string}}
function submission(reviewProof:string,signature=validateBookingSignature({name:'Synthetic customer',method:'typed',strokes:[],acknowledged:true})){return{reviewProof,signature,idempotencyKey}}
beforeEach(()=>{now=Date.now();current=customerOwner();calendarCalls=0;externalUnavailable=false;submittedArgs=null;enqueued=[];replay=null;staffAllowed=true;state={requestId,verified:true,canEdit:true,acknowledgment,approval:{id:approvalId,version:1,analysisId,inputRevision:1,approvedAt:new Date(now).toISOString(),snapshot,snapshotHash,stale:false,preferredDate:date,selectionRevision:1,availabilityRevision:'v1'},submission:null}})
test('guest capability cannot read or write booking state while verified selected customer can recover',async()=>{
 current={hash:current.hash,expiresAt:current.expiresAt};assert.equal((await api.state(req())).status,403);assert.equal((await api.approve(req('POST',{analysisId,expectedRevision:1,idempotencyKey}))).status,403)
 current=customerOwner();const response=await api.state(req());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal((await response.json()).state.requestId,requestId)
})
test('write transport keeps same-origin and selected-request fences before Calendar calls',async()=>{
 for(const headers of [{origin:'https://attacker.invalid'},{'x-lk-quote-request-id':randomUUID()},{'x-lk-quote-request-id':''}]){const response=await api.approve(req('POST',{analysisId,expectedRevision:1,idempotencyKey},headers));assert.ok([403,409].includes(response.status))}
 assert.equal(calendarCalls,0)
})
test('review proof is encrypted and binds owner identity, request, snapshot and selection revision',async()=>{
 const reviewed=await review();assert.equal(reviewed.snapshotHash,snapshotHash);assert.ok(!reviewed.reviewProof.includes('alice'))
 const submitted=await api.submit(req('POST',submission(reviewed.reviewProof)));assert.equal(submitted.status,200,await submitted.clone().text());assert.equal(submittedArgs!.snapshotHash,snapshotHash);assert.equal(submittedArgs!.approvalId,approvalId);assert.equal(submittedArgs!.selectionRevision,1);assert.equal((await submitted.json()).state.submission.emailStatus,'pending');assert.equal(enqueued.length,1)
})
test('tampered or other-owner review proofs cannot submit',async()=>{
 const reviewed=await review();const chars=reviewed.reviewProof.split('');chars[20]=chars[20]==='A'?'B':'A';assert.equal((await api.submit(req('POST',submission(chars.join(''))))).status,409)
 current={...current,customer:{...current.customer!,authUserId:randomUUID()}};assert.equal((await api.submit(req('POST',submission(reviewed.reviewProof)))).status,403);assert.equal(submittedArgs,null)
})
test('expired review fails new submission; prior response-loss submission replays even with newly busy Calendar',async()=>{
 const reviewed=await review();now+=16*60000;assert.equal((await api.submit(req('POST',submission(reviewed.reviewProof)))).status,409)
 now-=16*60000;assert.equal((await api.submit(req('POST',submission(reviewed.reviewProof)))).status,200);now+=16*60000;externalUnavailable=true;const calls=calendarCalls;assert.equal((await api.submit(req('POST',submission(reviewed.reviewProof)))).status,200);assert.equal(calendarCalls,calls)
})
test('approval and date response-loss replay use current DB identity and no external Calendar dependency',async()=>{
 replay=state;externalUnavailable=true;const approve=await api.approve(req('POST',{analysisId,expectedRevision:1,idempotencyKey}));assert.equal(approve.status,200)
 const select=await api.date(req('PUT',{approvalId,preferredDate:date,availabilityRevision:'v1',idempotencyKey}));assert.equal(select.status,200,await select.clone().text());assert.equal(calendarCalls,0)
})
test('caller supplied prices and extra signed fields are rejected before storage',async()=>{
 assert.equal((await api.approve(req('POST',{analysisId,expectedRevision:1,idempotencyKey,total:1}))).status,400)
 const reviewed=await review();const forged={...submission(reviewed.reviewProof),snapshot:{pricing:{total:1}}};assert.equal((await api.submit(req('POST',forged))).status,400);assert.equal(submittedArgs,null)
})
test('drawn signature needs visible motion and bounded points; typed signature is explicit and accessible',()=>{
 for(const value of [{name:' ',method:'typed',strokes:[],acknowledged:true},{name:'Synthetic',strokes:[],acknowledged:true},{name:'Synthetic',method:'drawn',strokes:[[{x:.1,y:.1},{x:.1,y:.1}]],acknowledged:true},{name:'Synthetic',method:'drawn',strokes:[[{x:.1,y:.1},{x:.11,y:.1},{x:.11,y:.11},{x:.11,y:.1}]],acknowledged:true},{name:'Synthetic',method:'drawn',strokes:[Array.from({length:2001},(_,i)=>({x:i%2,y:.1}))],acknowledged:true}])assert.throws(()=>validateBookingSignature(value))
 assert.equal(validateBookingSignature({name:' Synthetic ',method:'typed',strokes:[],acknowledged:true}).name,'Synthetic');assert.equal(validateBookingSignature({name:'Synthetic',method:'drawn',strokes:[[{x:.1,y:.1},{x:.2,y:.1},{x:.3,y:.2},{x:.4,y:.2}]],acknowledged:true}).method,'drawn')
})
test('bounded streamed JSON rejects overlarge or malformed bodies and unsupported content types',async()=>{
 assert.equal((await api.submit(req('POST',{oversized:'x'.repeat(180001)}))).status,413)
 assert.equal((await api.submit(req('POST',{}, {'content-type':'text/plain'}))).status,415)
 assert.equal((await api.submit(new Request(base+'/api/quote/requests/booking',{method:'POST',headers:{host:new URL(base).host,origin:base,'x-lk-quote-request-id':requestId,'content-type':'application/json'},body:'{' }))).status,400)
})
test('private receipt pending status and staff authorization are preserved',async()=>{
 assert.equal((await api.receipt(req())).status,409);staffAllowed=false;assert.equal((await api.staff(req(),requestId)).status,403);staffAllowed=true;state.verified=false;const response=await api.staff(req(),requestId);assert.equal(response.status,200);assert.equal((await response.json()).state.verified,false)
})
