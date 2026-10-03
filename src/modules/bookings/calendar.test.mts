import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {AppError} from '../operations/domain/validation.ts'
import {syncBookingItem,inspectBookingCalendarEvent,readBookingEvent,type BookingCalendarPending,type BookingCalendarPorts} from './calendar.ts'

const bookingId='11111111-1111-4111-8111-111111111111'
const proposalId='22222222-2222-4222-8222-222222222222'
const oldProposalId='33333333-3333-4333-8333-333333333333'
function fixture(options:{old?:boolean;oldMoved?:boolean;authorizeRetire?:boolean;busyOn?:number;lostInsert?:boolean;lostInsertMoved?:boolean;tombstoneAfterDelete?:boolean}={}){
 const item:BookingCalendarPending={booking_id:bookingId,proposal_id:proposalId,revision:7,calendar_id:'test-calendar',reference:'DEMO-123',
  segments:[{id:'one',startAt:'2099-01-05T09:00:00+11:00',endAt:'2099-01-05T17:00:00+11:00'},{id:'two',startAt:'2099-01-06T09:00:00+11:00',endAt:'2099-01-06T17:00:00+11:00'}],links:[]}
 const provider=new Map<string,Record<string,unknown>>()
 const calls:{command:string;args:Record<string,unknown>}[]=[]
 const writes:{method:string;headers:Headers;body:Record<string,unknown>|null}[]=[]
 let verifyCount=0
 let retireIntent=false
 if(options.old){
  item.links.push({event_id:'old-event',booking_id:bookingId,proposal_id:oldProposalId,segment_id:'old',kind:'work',calendar_id:item.calendar_id,etag:'etag-old',
   start_at:'2099-01-04T09:00:00+11:00',end_at:'2099-01-04T17:00:00+11:00',start_date:null,end_date_exclusive:null,synced_revision:4})
  provider.set('old-event',{id:'old-event',etag:options.oldMoved?'etag-moved':'etag-old',status:'confirmed',transparency:'opaque',
   start:{dateTime:options.oldMoved?'2099-01-04T10:00:00+11:00':'2099-01-04T09:00:00+11:00'},end:{dateTime:'2099-01-04T17:00:00+11:00'},
   extendedProperties:{private:{bookingId,proposalId:oldProposalId,segmentId:'old'}}})
 }
 const ports:BookingCalendarPorts={
  getEvent:async(_calendar,id)=>{
   const event=provider.get(id)
   return event?.status==='cancelled'?null:event as never ?? null
  },
  verify:async()=>{verifyCount++;if(options.busyOn===verifyCount)throw new AppError(409,'A work segment is no longer available');return {checkedAt:new Date().toISOString(),calendarId:item.calendar_id}},
  command:async<T>(command:string,args:Record<string,unknown>={})=>{
   calls.push({command,args})
   if(command==='retire_intent')retireIntent=true
   if(command==='retire_authorization')return (options.authorizeRetire || (args.etag==='deleted'&&retireIntent)) as T
   return true as T
  },
  request:async(_url,init)=>{
   const method=init?.method||'GET'
   const headers=new Headers(init?.headers)
   const body=init?.body?JSON.parse(String(init.body)) as Record<string,unknown>:null
   writes.push({method,headers,body})
   if(method==='POST'){
    provider.set(String(body!.id),{...body,etag:'etag-new'})
    return new Response(JSON.stringify(body),{status:200})
   }
   if(method==='DELETE'){
    if(options.tombstoneAfterDelete)provider.set('old-event',{id:'old-event',etag:'etag-cancelled',status:'cancelled'})
    else provider.delete('old-event')
    return new Response(null,{status:204})
   }
   throw new Error('Unexpected provider request')
  },
 }
 if(options.lostInsert){
  const eventId='a'+createHash('sha256').update(`${bookingId}:${proposalId}:one`).digest('hex').slice(0,40)
  provider.set(eventId,{id:eventId,etag:'etag-lost',status:'confirmed',transparency:'opaque',recurrence:[],
   start:{dateTime:options.lostInsertMoved?'2099-01-05T10:00:00+11:00':item.segments[0].startAt},end:{dateTime:item.segments[0].endAt},
   extendedProperties:{private:{bookingId,proposalId,segmentId:'one',revision:'7'}}})
 }
 return {item,ports,calls,writes,provider,get verifyCount(){return verifyCount}}
}

test('creates opaque work segments and only a transparent multi-day overview, then rechecks busy',async()=>{
 const f=fixture({busyOn:2})
 assert.equal(await syncBookingItem(f.item,'lease',f.ports),'review')
 assert.equal(f.verifyCount,2)
 const created=f.writes.filter(w=>w.method==='POST').map(w=>w.body!)
 assert.equal(created.length,3)
 assert.equal(created.filter(e=>e.transparency==='opaque').length,2)
 const overview=created.find(e=>e.transparency==='transparent')!
 assert.deepEqual(overview.start,{date:'2099-01-05'})
 assert.deepEqual(overview.end,{date:'2099-01-07'})
 for(const event of created){
  assert.equal('attendees' in event,false)
  assert.equal(JSON.stringify(event).includes('customer@example.com'),false)
 }
 assert.equal(f.calls.some(c=>c.command==='busy_conflict'),true)
 assert.equal(f.calls.some(c=>c.command==='calendar_success'),false)
})

test('a fresh busy result prevents all provider writes',async()=>{
 const f=fixture({busyOn:1})
 assert.equal(await syncBookingItem(f.item,'lease',f.ports),'review')
 assert.equal(f.writes.length,0)
 assert.equal(f.calls.some(c=>c.command==='calendar_success'),false)
})
test('Google readback may omit default opaque work transparency without creating a false move review',async()=>{
 const f=fixture()
 const getEvent=f.ports.getEvent
 f.ports.getEvent=async(...args)=>{
  const event=await getEvent(...args)
  if(event?.transparency==='opaque')delete event.transparency
  return event
 }
 assert.equal(await syncBookingItem(f.item,'lease',f.ports),'synced')
 assert.equal(f.writes.filter(write=>write.method==='POST').length,3)
 assert.equal(f.calls.filter(call=>call.command==='link_put').length,3)
 assert.equal(f.calls.some(call=>call.command==='external_change'),false)
 assert.equal(f.calls.at(-1)?.command,'calendar_success')
 assert.equal([...f.provider.values()].find(event=>event.transparency==='transparent')?.transparency,'transparent')
})
test('readback still rejects transparent or malformed work blocks and an opaque-by-default summary',async()=>{
 for(const change of [{kind:'work',value:'transparent'},{kind:'work',value:''},{kind:'work',value:null},{kind:'summary',value:undefined}]){
  const f=fixture()
  const getEvent=f.ports.getEvent
  f.ports.getEvent=async(...args)=>{
   const event=await getEvent(...args)
   if(event&&(event.transparency==='transparent')===(change.kind==='summary')){
    if(change.value===undefined)delete event.transparency
    else Object.assign(event,{transparency:change.value})
   }
   return event
  }
  assert.equal(await syncBookingItem(f.item,'lease',f.ports),'review')
  assert.equal(f.calls.some(call=>call.command==='external_change'),true)
  assert.equal(f.calls.some(call=>call.command==='calendar_success'),false)
 }
})
test('rebooking detects new busy work before retiring any previously confirmed opaque event',async()=>{
 const f=fixture({old:true,busyOn:2})
 assert.equal(await syncBookingItem(f.item,'lease',f.ports),'review')
 assert.equal(f.writes.some(w=>w.method==='DELETE'),false)
 assert.equal(f.calls.some(c=>c.command==='calendar_success'),false)
})

test('a previously observed external move retires only with new consent evidence and latest ETag',async()=>{
 const denied=fixture({old:true,oldMoved:true,authorizeRetire:false})
 assert.equal(await syncBookingItem(denied.item,'lease',denied.ports),'review')
 assert.equal(denied.writes.some(w=>w.method==='DELETE'),false)
 assert.equal(denied.calls.some(c=>c.command==='external_change'),true)
 const allowed=fixture({old:true,oldMoved:true,authorizeRetire:true})
 assert.equal(await syncBookingItem(allowed.item,'lease',allowed.ports),'synced')
 const deletion=allowed.writes.find(w=>w.method==='DELETE')!
 assert.equal(deletion.headers.get('If-Match'),'etag-moved')
 assert.ok(allowed.calls.findIndex(c=>c.command==='calendar_ready')<allowed.calls.findIndex(c=>c.command==='retire_intent'))
 assert.ok(allowed.calls.findIndex(c=>c.command==='calendar_ready')<allowed.calls.findIndex(c=>c.command==='link_delete'))
 assert.equal(allowed.calls.some(c=>c.command==='calendar_success'),true)
})
test('a lost link-delete completion retries from a durable retire intent after provider GET returns missing',async()=>{
 const f=fixture({old:true})
 const original=f.ports.command
 let failLinkDelete=true
 f.ports.command=async<T>(command:string,args:Record<string,unknown>={})=>{
  if(command==='link_delete'&&failLinkDelete){failLinkDelete=false;return false as T}
  return original<T>(command,args)
 }
 assert.equal(await syncBookingItem(f.item,'lease',f.ports),'retry')
 assert.equal(f.writes.filter(w=>w.method==='DELETE').length,1)
 assert.equal(f.calls.some(c=>c.command==='calendar_ready'),true)
 assert.equal(f.calls.some(c=>c.command==='retire_intent'),true)
 assert.equal(await syncBookingItem(f.item,'lease',f.ports),'synced')
 assert.equal(f.writes.filter(w=>w.method==='DELETE').length,1)
 assert.equal(f.calls.some(c=>c.command==='retire_authorization'&&c.args.etag==='deleted'),true)
})
test('a cancelled Google tombstone is treated as deleted during fenced retirement recovery',async()=>{
 assert.equal(await readBookingEvent('test-calendar','old-event','lease',async()=>Response.json({id:'old-event',etag:'etag-cancelled',status:'cancelled'})),null)
 const f=fixture({old:true,tombstoneAfterDelete:true})
 const original=f.ports.command
 let failed=true
 f.ports.command=async<T>(command:string,args:Record<string,unknown>={})=>{
  if(command==='link_delete'&&failed){failed=false;return false as T}
  return original<T>(command,args)
 }
 assert.equal(await syncBookingItem(f.item,'lease',f.ports),'retry')
 assert.equal(await syncBookingItem(f.item,'lease',f.ports),'synced')
 assert.equal(f.writes.filter(w=>w.method==='DELETE').length,1)
 assert.equal(f.calls.some(c=>c.command==='retire_authorization'&&c.args.etag==='deleted'),true)
})
test('conditional old-event deletion stops for provider ETag 412 and preserves review',async()=>{
 const f=fixture({old:true})
 const original=f.ports.request
 f.ports.request=async(url,init,holder)=>{
  if(init?.method==='DELETE'){
   f.provider.set('old-event',{id:'old-event',etag:'etag-external',status:'confirmed',transparency:'opaque',
    start:{dateTime:'2099-01-04T10:00:00+11:00'},end:{dateTime:'2099-01-04T17:00:00+11:00'},
    extendedProperties:{private:{bookingId,proposalId:oldProposalId,segmentId:'old',revision:'4'}}})
   return new Response(null,{status:412})
  }
  return original(url,init,holder)
 }
 assert.equal(await syncBookingItem(f.item,'lease',f.ports),'review')
 assert.equal(f.calls.some(c=>c.command==='calendar_ready'),true)
 assert.equal(f.calls.some(c=>c.command==='external_change'&&c.args.etag==='etag-external'),true)
 assert.equal(f.calls.some(c=>c.command==='link_delete'),false)
 assert.equal(f.calls.some(c=>c.command==='calendar_success'),false)
})

test('a previously created exact event is adopted after a lost response',async()=>{
 const f=fixture({lostInsert:true})
 assert.equal(await syncBookingItem(f.item,'lease',f.ports),'synced')
 assert.equal(f.writes.filter(w=>w.method==='POST').length,2)
 assert.equal(f.calls.filter(c=>c.command==='link_put').length,3)
})
test('a lost insert that was moved in Google becomes a review with a durable link, never an overwrite',async()=>{
 const f=fixture({lostInsert:true,lostInsertMoved:true})
 assert.equal(await syncBookingItem(f.item,'lease',f.ports),'review')
 assert.equal(f.calls.some(c=>c.command==='link_put'),true)
 assert.equal(f.calls.at(-1)?.command,'external_change')
 assert.equal(f.writes.length,0)
})
test('inbound move, recurrence and deletion stay review-only; an own echo only updates ETag',async()=>{
 const f=fixture({old:true})
 const link=f.item.links[0]
 const base={id:link.event_id,etag:'etag-new',status:'confirmed',transparency:'opaque',
  start:{dateTime:link.start_at!},end:{dateTime:link.end_at!},
  extendedProperties:{private:{bookingId,proposalId:oldProposalId,segmentId:'old',revision:'4'}}}
 const port={command:f.ports.command}
 assert.equal(await inspectBookingCalendarEvent(f.item.calendar_id,'lease',link,base,port),false)
 assert.equal(f.calls.at(-1)?.command,'etag_update')
 const moved={...base,start:{dateTime:'2099-01-04T10:00:00+11:00'}}
 assert.equal(await inspectBookingCalendarEvent(f.item.calendar_id,'lease',link,moved,port),true)
 assert.equal(f.calls.at(-1)?.command,'external_change')
 assert.equal(f.calls.at(-1)?.args.kind,'move')
 assert.equal(await inspectBookingCalendarEvent(f.item.calendar_id,'lease',link,{...base,recurrence:['RRULE:FREQ=DAILY']},port),true)
 assert.equal(f.calls.at(-1)?.args.kind,'invalid')
 assert.equal(await inspectBookingCalendarEvent(f.item.calendar_id,'lease',link,null,port),true)
 assert.equal(f.calls.at(-1)?.args.kind,'delete')
 assert.equal(f.calls.at(-1)?.args.etag,'deleted')
 assert.equal(await inspectBookingCalendarEvent(f.item.calendar_id,'lease',link,{id:link.event_id,etag:'tombstone-etag',status:'cancelled'},port),true)
 assert.equal(f.calls.at(-1)?.args.etag,'deleted')
 assert.equal(f.calls.some(c=>c.command==='calendar_success'),false)
})
test('inbound work echoes accept omitted opaque but still review changed or malformed transparency',async()=>{
 const f=fixture({old:true})
 const link=f.item.links[0]
 const event={id:link.event_id,etag:link.etag,status:'confirmed',
  start:{dateTime:link.start_at!},end:{dateTime:link.end_at!},
  extendedProperties:{private:{bookingId,proposalId:oldProposalId,segmentId:'old',revision:'4'}}}
 assert.equal(await inspectBookingCalendarEvent(f.item.calendar_id,'lease',link,event,{command:f.ports.command}),false)
 assert.equal(f.calls.length,0)
 assert.equal(await inspectBookingCalendarEvent(f.item.calendar_id,'lease',link,{...event,etag:'etag-new'},{command:f.ports.command}),false)
 assert.equal(f.calls.at(-1)?.command,'etag_update')
 for(const transparency of ['transparent','',null]){
  const changed=Object.assign({},event,{transparency})
  assert.equal(await inspectBookingCalendarEvent(f.item.calendar_id,'lease',link,changed as typeof event,{command:f.ports.command}),true)
  assert.equal(f.calls.at(-1)?.command,'external_change')
 }
})
test('inbound multi-day summaries require explicit transparent even when their dates are unchanged',async()=>{
 const f=fixture({old:true})
 const link={...f.item.links[0],kind:'summary' as const,segment_id:'summary',start_at:null,end_at:null,start_date:'2099-01-04',end_date_exclusive:'2099-01-07'}
 const event={id:link.event_id,etag:link.etag,status:'confirmed',
  start:{date:link.start_date},end:{date:link.end_date_exclusive},
  extendedProperties:{private:{bookingId,proposalId:oldProposalId,segmentId:'summary',revision:'4'}}}
 assert.equal(await inspectBookingCalendarEvent(f.item.calendar_id,'lease',link,{...event,transparency:'transparent'},{command:f.ports.command}),false)
 assert.equal(f.calls.length,0)
 assert.equal(await inspectBookingCalendarEvent(f.item.calendar_id,'lease',link,event,{command:f.ports.command}),true)
 assert.equal(f.calls.at(-1)?.command,'external_change')
 assert.equal(f.calls.at(-1)?.args.kind,'invalid')
})
