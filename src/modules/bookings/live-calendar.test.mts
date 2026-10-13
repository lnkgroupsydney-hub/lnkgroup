import test from 'node:test'
import assert from 'node:assert/strict'
import {companyClaim,companyTestNow} from './live-test-data.mts'
import {checkLiveCompanyCalendar,ensureLiveCompanyEvents,liveCompanyEventId,liveCompanyEventPlan,reconcileLiveCompanyEvents,type CompanyCalendarPorts} from './live-calendar.ts'
import type {LiveCompanyBookingState} from './domain/live-contracts.ts'
function harness(claim=companyClaim()){
 const events=new Map<string,Record<string,unknown>>(),writes:string[]=[],records:unknown[]=[],calls:string[]=[]
 const deps:CompanyCalendarPorts={target:async()=>claim.proposal.calendarTarget,now:()=>new Date(companyTestNow),occupancy:async()=>({segments:[]}),request:async(url,init)=>{
  calls.push(`${init?.method??'GET'} ${url}`);const u=new URL(url),id=u.pathname.split('/').at(-1)!
  if(init?.method==='POST'){const p=JSON.parse(String(init.body));writes.push(p.id);events.set(p.id,{...p,etag:'"readback-'+p.id+'"'});return Response.json({id:p.id})}
  if(id==='events')return Response.json({accessRole:'owner',items:[...events.values()]})
  return events.has(id)?Response.json(events.get(id)):new Response(null,{status:404})
 }}
 const owned=()=>({booking:claim.booking!,proposal:claim.proposal,reference:claim.submission.reference})
 const addOwn=(index:number)=>{const p=liveCompanyEventPlan(owned(),index);events.set(p.payload.id,{...p.payload,etag:'"prior"'});return p}
 const callbacks={assertLease:async()=>{},recordEvent:async(e:unknown)=>{records.push(e)}}
 return{claim,events,writes,records,calls,deps,owned,addOwn,callbacks}
}
const review=(e:unknown)=>e instanceof Error&&'code'in e&&e.code==='company_calendar_review_required'
test('all periods create distinct private busy events, independently read and verify the complete final range',async()=>{
 const h=harness(),proof=await ensureLiveCompanyEvents(h.claim,h.callbacks,h.deps)
 assert.equal(h.writes.length,2);assert.equal(new Set(h.writes).size,2);assert.equal(h.records.length,2);assert.deepEqual(proof.conflicts,[])
 for(const p of h.events.values()){assert.equal(p.visibility,'private');assert.equal(p.transparency,'opaque');assert.equal(p.status,'confirmed');assert.equal('attendees'in p,false);assert.equal(JSON.stringify(p).includes('verified@example.invalid'),false)}
 assert.ok(h.calls.at(-1)!.includes('/events?'))
})
test('single-confirmation appointments retain distinct take-off and installation purposes through independent readback',async()=>{
 const c=companyClaim();c.proposal.confirmationBasis='signed_request';c.booking!.confirmationBasis='signed_request';c.proposal.segments[0].purpose='take_off';c.proposal.segments[1].purpose='install'
 const h=harness(c);await ensureLiveCompanyEvents(h.claim,h.callbacks,h.deps)
 for(const [index,s] of c.proposal.segments.entries()){
  const event=h.events.get(liveCompanyEventId(c.booking!.id,c.proposal.hash,index))!
  assert.match(String(event.summary),index===0?/Cabinet take-off/:/Cabinet installation/)
  assert.equal((event.extendedProperties as {private:Record<string,string>}).private.purpose,s.purpose)
 }
 const first=h.events.get(liveCompanyEventId(c.booking!.id,c.proposal.hash,0))!
 ;(first.extendedProperties as {private:Record<string,string>}).private.purpose='install'
 await assert.rejects(ensureLiveCompanyEvents(h.claim,h.callbacks,h.deps),review)
})
test('lost provider response retries a proven deterministic event without duplicate POST or excluding unrelated events',async()=>{
 const h=harness();h.addOwn(0)
 await ensureLiveCompanyEvents(h.claim,h.callbacks,h.deps);assert.equal(h.writes.length,1);assert.equal(h.records.length,2)
 h.events.set('foreign',{id:'foreign',status:'confirmed',start:{date:'2026-10-20'},end:{date:'2026-10-21'}})
 const result=await checkLiveCompanyCalendar(h.claim.proposal.calendarTarget,h.claim.proposal.segments,{ignoreBookingId:h.claim.booking!.id,owned:h.owned()},h.deps)
 assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].source,'google')
})
test('Google omitted default opaque value still independently proves a busy owned event',async()=>{
 const h=harness();for(let i=0;i<2;i++){const p=h.addOwn(i);delete h.events.get(p.payload.id)!.transparency}
 await ensureLiveCompanyEvents(h.claim,h.callbacks,h.deps);assert.equal(h.writes.length,0);assert.equal(h.records.length,2)
})
test('verified event removed or externally moved remains held for review and is never recreated',async()=>{
 for(const mode of ['removed','moved','wrong-owner']){
  const h=harness(),p=h.addOwn(0);h.claim.booking!.events=[{segmentIndex:0,eventId:p.payload.id,payloadHash:p.payloadHash,etag:'"stored"',verifiedAt:new Date(companyTestNow).toISOString()}]
  if(mode==='removed')h.events.delete(p.payload.id)
  else if(mode==='moved')h.events.get(p.payload.id)!.start={date:'2026-10-19'}
  else h.events.get(p.payload.id)!.extendedProperties={private:{kind:'foreign'}}
  await assert.rejects(ensureLiveCompanyEvents(h.claim,h.callbacks,h.deps),review);assert.equal(h.writes.length,0)
 }
})
test('timed periods conflict with all-day occupancy; adjacent periods and transparent markers are allowed',async()=>{
 const h=harness();h.events.set('edge',{id:'edge',status:'confirmed',start:{dateTime:'2026-10-22T21:00:00Z'},end:{dateTime:'2026-10-22T22:00:00Z'}});h.events.set('pending',{id:'pending',status:'tentative',transparency:'transparent',start:{date:'2026-10-20'},end:{date:'2026-10-21'}})
 assert.deepEqual((await checkLiveCompanyCalendar(h.claim.proposal.calendarTarget,h.claim.proposal.segments,{},h.deps)).conflicts,[])
 h.deps.occupancy=async()=>({segments:[{bookingId:'other',startAt:'2026-10-22T13:00:00.000Z',endAt:'2026-10-23T13:00:00.000Z'}]})
 const check=await checkLiveCompanyCalendar(h.claim.proposal.calendarTarget,h.claim.proposal.segments,{},h.deps);assert.equal(check.conflicts.length,1);assert.equal(check.conflicts[0].segmentIndex,1)
})
test('foreign event arriving after writes prevents final confirmation',async()=>{
 const h=harness();h.callbacks.recordEvent=async(e:unknown)=>{h.records.push(e);if(h.records.length===2)h.events.set('later',{id:'later',status:'confirmed',start:{date:'2026-10-23'},end:{date:'2026-10-24'}})}
 await assert.rejects(ensureLiveCompanyEvents(h.claim,h.callbacks,h.deps),review);assert.equal(h.writes.length,2)
})
test('own event becoming transparent or cancelled between independent GET and list requires review',async()=>{
 for(const change of [{transparency:'transparent'},{status:'cancelled'}]){
  const h=harness(),p=h.addOwn(0),original=h.deps.request
  h.deps.request=async(url,init)=>{if(new URL(url).pathname.endsWith('/events'))return Response.json({accessRole:'owner',items:[{...h.events.get(p.payload.id),...change}]});return original(url,init)}
  await assert.rejects(checkLiveCompanyCalendar(h.claim.proposal.calendarTarget,h.claim.proposal.segments,{ignoreBookingId:h.claim.booking!.id,owned:h.owned()},h.deps),review)
 }
})
test('legacy confirmed period without booking UUID is preserved as occupancy',async()=>{
 const h=harness();h.deps.occupancy=async()=>({segments:[{bookingId:null,startAt:'2026-10-19T13:00:00.000Z',endAt:'2026-10-20T13:00:00.000Z'}]})
 const proof=await checkLiveCompanyCalendar(h.claim.proposal.calendarTarget,h.claim.proposal.segments,{},h.deps);assert.equal(proof.conflicts[0].source,'database')
})
test('lease fencing, target mismatch, incomplete pages and stale deleted evidence fail closed',async()=>{
 const lease=harness();lease.callbacks.assertLease=async()=>{throw Error('Lease lost')};await assert.rejects(ensureLiveCompanyEvents(lease.claim,lease.callbacks,lease.deps));assert.equal(lease.writes.length,0)
 const changed=harness();changed.deps.target=async()=>({...changed.claim.proposal.calendarTarget,calendarId:'wrong'});await assert.rejects(ensureLiveCompanyEvents(changed.claim,changed.callbacks,changed.deps));assert.equal(changed.writes.length,0)
 const malformed=harness();malformed.deps.request=async()=>Response.json({accessRole:'reader',items:[]});await assert.rejects(checkLiveCompanyCalendar(malformed.claim.proposal.calendarTarget,malformed.claim.proposal.segments,{},malformed.deps))
 const paging=harness();paging.deps.request=async()=>Response.json({accessRole:'owner',items:[],nextPageToken:'repeated'});await assert.rejects(checkLiveCompanyCalendar(paging.claim.proposal.calendarTarget,paging.claim.proposal.segments,{},paging.deps))
})
test('reconciliation includes later third-party conflicts and stable IDs bind booking, proposal and segment',async()=>{
 const h=harness();for(let i=0;i<2;i++){const p=h.addOwn(i);h.claim.booking!.events.push({segmentIndex:i,eventId:p.payload.id,payloadHash:p.payloadHash,etag:'"prior"',verifiedAt:new Date(companyTestNow).toISOString()})}
 h.claim.booking!.status='confirmed';h.events.set('later',{id:'later',status:'confirmed',start:{date:'2026-10-20'},end:{date:'2026-10-21'}})
 const state={requestId:h.claim.requestId,revision:1,submission:h.claim.submission,proposal:h.claim.proposal,proposals:[h.claim.proposal],acceptance:h.claim.acceptance,booking:h.claim.booking,acknowledgment:{version:'test',text:'test'}} as LiveCompanyBookingState
 assert.equal((await reconcileLiveCompanyEvents(state,h.deps)).ok,false)
 assert.notEqual(liveCompanyEventId(h.claim.booking!.id,h.claim.proposal.hash,0),liveCompanyEventId(h.claim.booking!.id,h.claim.proposal.hash,1))
})
