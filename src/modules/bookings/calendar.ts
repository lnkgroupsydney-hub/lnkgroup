import {createHash,randomUUID} from 'node:crypto'
import {AppError,googleRequest,getConnection,operationsCommand} from '../operations/calendar-access.ts'
import {verifyBookingCalendar,type BookingWorkSegment} from './calendar-availability.ts'
import {quoteStorageClient} from '../enquiries/demo-session.ts'

type Link={event_id:string;booking_id:string;proposal_id:string;segment_id:string;kind:'work'|'summary';calendar_id:string;etag:string;start_at:string|null;end_at:string|null;start_date:string|null;end_date_exclusive:string|null;synced_revision:number}
export type BookingCalendarPending={booking_id:string;revision:number;proposal_id:string;calendar_id:string;reference:string;segments:BookingWorkSegment[];links:Link[]}
type Pending=BookingCalendarPending
type Ready={booking_id:string;revision:number;calendar_id:string;segments:BookingWorkSegment[];own_event_ids:string[]}
export type BookingCalendarChange={id:string;booking_id:string;proposal_id:string;segment_id:string;event_id:string;provider_etag:string;booking_revision:number;kind:'move'|'delete'|'invalid';proposed_start_at:string|null;proposed_end_at:string|null;status:'pending'|'superseded';created_at:string}
type Event={id?:string;etag?:string;status?:string;transparency?:string;start?:{date?:string;dateTime?:string};end?:{date?:string;dateTime?:string};recurrence?:string[];recurringEventId?:string;extendedProperties?:{private?:Record<string,string>}}
type EventPlan={id:string;kind:'work'|'summary';segmentId:string;startAt:string|null;endAt:string|null;startDate:string|null;endDateExclusive:string|null;payload:Record<string,unknown>}
const base='https://www.googleapis.com/calendar/v3'
const eventPath=(calendar:string,id?:string)=>`${base}/calendars/${encodeURIComponent(calendar)}/events${id?`/${encodeURIComponent(id)}`:''}`
const stableId=(booking:string,proposal:string,segment:string)=>`a${createHash('sha256').update(`${booking}:${proposal}:${segment}`).digest('hex').slice(0,40)}`
const ownerLink=()=>{
 try{
  const origin=new URL(process.env.APP_BASE_URL||'')
  return ['http:','https:'].includes(origin.protocol)?` Owner review: ${new URL('/admin',origin)}`:''
 }catch{return ''}
}
const day=(value:string)=>{
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value))
 return ['year','month','day'].map(type=>parts.find(part=>part.type===type)!.value).join('-')
}
const nextDay=(value:string)=>new Date(Date.parse(`${value}T00:00:00Z`)+86400000).toISOString().slice(0,10)
const sameTime=(a:string|undefined,b:string|null)=>!!a&&!!b&&Date.parse(a)===Date.parse(b)
// Google omits the default opaque value from some event responses.
const matchesTransparency=(value:Event['transparency'],kind:Link['kind'])=>(value===undefined?'opaque':value)===(kind==='work'?'opaque':'transparent')
async function bookingCommand<T>(command:string,args:Record<string,unknown>={}):Promise<T>{
 const {data,error}=await quoteStorageClient().rpc('lk_booking_calendar',{command,args})
 if(error)throw new AppError(error.code==='LK409'?409:error.code==='LK400'?400:503,error.code==='LK409'?'Booking Calendar changed; retry or review':'Booking Calendar storage unavailable')
 return data as T
}
async function request(url:string,init:RequestInit={},holder?:string){
 if(holder&&!await operationsCommand<boolean>('sync_renew',{holder}))throw new AppError(409,'Calendar sync lease expired')
 return googleRequest('calendar',url,init,holder)
}
export async function readBookingEvent(calendar:string,id:string,holder:string,providerRequest= request):Promise<Event|null>{
 const response=await providerRequest(eventPath(calendar,id),{},holder)
 if(response.status===404||response.status===410)return null
 if(!response.ok)throw new AppError(502,'Calendar event could not be read')
 const event=await response.json() as Event
 if(event.id!==id)throw new AppError(502,'Calendar returned an incomplete event')
 if(event.status==='cancelled')return null
 if(!event.etag)throw new AppError(502,'Calendar returned an incomplete event')
 return event
}
export type BookingCalendarPorts={
 command:<T>(command:string,args?:Record<string,unknown>)=>Promise<T>
 request:(url:string,init?:RequestInit,holder?:string)=>Promise<Response>
 getEvent:(calendar:string,id:string,holder:string)=>Promise<Event|null>
 verify:(input:Parameters<typeof verifyBookingCalendar>[0],holder:string)=>Promise<{checkedAt:string;calendarId:string}>
}
const livePorts:BookingCalendarPorts={command:bookingCommand,request,getEvent:readBookingEvent,
 verify:(input,holder)=>verifyBookingCalendar(input,{connection:getConnection,request:async url=>request(url,{},holder),now:()=>new Date()})}
function plans(item:Pending):EventPlan[]{
 const result:EventPlan[]=item.segments.map(segment=>{
  const id=stableId(item.booking_id,item.proposal_id,segment.id)
  return {id,kind:'work' as const,segmentId:segment.id,startAt:segment.startAt,endAt:segment.endAt,startDate:null,endDateExclusive:null,
   payload:{id,summary:`[DEMO] Work block · ${item.reference}`,description:`Demonstration work segment. Reference ${item.reference}. No customer details or attendees.${ownerLink()}`,status:'confirmed',visibility:'private',transparency:'opaque',recurrence:[],
    start:{dateTime:segment.startAt,timeZone:'Australia/Sydney'},end:{dateTime:segment.endAt,timeZone:'Australia/Sydney'},
    extendedProperties:{private:{bookingId:item.booking_id,proposalId:item.proposal_id,segmentId:segment.id,revision:String(item.revision)}}}}
 })
 const startDay=day(item.segments[0].startAt)
 const lastDay=day(new Date(Date.parse(item.segments.at(-1)!.endAt)-1).toISOString())
 if(startDay!==lastDay){
  const start=startDay,end=nextDay(lastDay)
  const id=stableId(item.booking_id,item.proposal_id,'summary')
  result.push({id,kind:'summary',segmentId:'summary',startAt:null,endAt:null,startDate:start,endDateExclusive:end,
   payload:{id,summary:`[DEMO] Work span · ${item.reference}`,description:`Transparent demonstration overview. Only work blocks reserve time. Reference ${item.reference}.${ownerLink()}`,status:'confirmed',visibility:'private',transparency:'transparent',recurrence:[],
    start:{date:start},end:{date:end},extendedProperties:{private:{bookingId:item.booking_id,proposalId:item.proposal_id,segmentId:'summary',revision:String(item.revision)}}}})
 }
 return result
}
function matches(event:Event,plan:EventPlan,item:Pending):boolean{
 const privateData=event.extendedProperties?.private
 return event.id===plan.id&&event.status==='confirmed'&&!event.recurrence?.length&&!event.recurringEventId&&
  matchesTransparency(event.transparency,plan.kind)&&privateData?.bookingId===item.booking_id&&
  privateData.proposalId===item.proposal_id&&privateData.segmentId===plan.segmentId&&privateData.revision===String(item.revision)&&
  (plan.kind==='work'?sameTime(event.start?.dateTime,plan.startAt)&&sameTime(event.end?.dateTime,plan.endAt):
   event.start?.date===plan.startDate&&event.end?.date===plan.endDateExclusive)
}
function owned(event:Event,plan:EventPlan,item:Pending):boolean{
 const data=event.extendedProperties?.private
 return event.id===plan.id&&data?.bookingId===item.booking_id&&data?.proposalId===item.proposal_id&&data?.segmentId===plan.segmentId
}
async function recordChange(item:Pending,link:Link,event:Event|null,holder:string,ports:BookingCalendarPorts):Promise<void>{
 const timed=event?.start?.dateTime&&event?.end?.dateTime&&Number.isFinite(Date.parse(event.start.dateTime))&&Number.isFinite(Date.parse(event.end.dateTime))
 const kind=!event||event.status==='cancelled'?'delete':event.recurrence?.length||event.recurringEventId||link.kind==='summary'||!timed?'invalid':'move'
 await ports.command('external_change',{holder,booking_id:item.booking_id,proposal_id:link.proposal_id,calendar_id:item.calendar_id,segment_id:link.segment_id,event_id:link.event_id,
  change_id:randomUUID(),etag:kind==='delete'?'deleted':event?.etag||'deleted',kind,start_at:kind==='move'?event?.start?.dateTime:null,end_at:kind==='move'?event?.end?.dateTime:null})
}
async function saveLink(item:Pending,plan:EventPlan,event:Event,holder:string,ports:BookingCalendarPorts):Promise<boolean>{
 if(!event.etag)return false
 return ports.command<boolean>('link_put',{holder,booking_id:item.booking_id,proposal_id:item.proposal_id,calendar_id:item.calendar_id,
  revision:item.revision,event_id:plan.id,segment_id:plan.segmentId,kind:plan.kind,etag:event.etag,start_at:plan.startAt,end_at:plan.endAt,start_date:plan.startDate,end_date_exclusive:plan.endDateExclusive})
}
async function checkBusy(booking:{booking_id:string;revision:number;calendar_id:string;segments:BookingWorkSegment[]},ownIds:string[],holder:string,ports:BookingCalendarPorts):Promise<boolean>{
 try{await ports.verify({segments:booking.segments,calendarId:booking.calendar_id,bookingId:booking.booking_id,excludedManagedEventIds:ownIds},holder);return false}
 catch(error){
  if(!(error instanceof AppError)||error.status!==409)throw error
  await ports.command('busy_conflict',{holder,booking_id:booking.booking_id,calendar_id:booking.calendar_id,revision:booking.revision,change_id:randomUUID()})
  return true
 }
}
export async function syncBookingItem(item:Pending,holder:string,ports:BookingCalendarPorts=livePorts):Promise<'synced'|'review'|'retry'>{
 const desired=plans(item)
 const byId=new Map(item.links.map(link=>[link.event_id,link]))
 try{
  // Recover an insert whose response was lost before checking busy intervals.
  for(const plan of desired){
   const existing=await ports.getEvent(item.calendar_id,plan.id,holder)
   const known=byId.get(plan.id)
   if(known&&(!existing||existing.etag!==known.etag&&!matches(existing,plan,item))){
    await recordChange(item,known,existing,holder,ports);return 'review'
   }
   if(existing){
    if(!matches(existing,plan,item)){
     if(known)await recordChange(item,known,existing,holder,ports)
     else if(owned(existing,plan,item)){
      if(!await saveLink(item,plan,existing,holder,ports))return 'retry'
      await recordChange(item,{event_id:plan.id,etag:existing.etag!,booking_id:item.booking_id,proposal_id:item.proposal_id,segment_id:plan.segmentId,kind:plan.kind,calendar_id:item.calendar_id,start_at:plan.startAt,end_at:plan.endAt,start_date:plan.startDate,end_date_exclusive:plan.endDateExclusive,synced_revision:item.revision},existing,holder,ports)
     }else await ports.command('calendar_failure',{holder,booking_id:item.booking_id,proposal_id:item.proposal_id,calendar_id:item.calendar_id,revision:item.revision,review:true})
     return 'review'
    }
    if(!known){if(!await saveLink(item,plan,existing,holder,ports))return 'retry';byId.set(plan.id,{event_id:plan.id,etag:existing.etag!,booking_id:item.booking_id,proposal_id:item.proposal_id,segment_id:plan.segmentId,kind:plan.kind,calendar_id:item.calendar_id,start_at:plan.startAt,end_at:plan.endAt,start_date:plan.startDate,end_date_exclusive:plan.endDateExclusive,synced_revision:item.revision})}
   }
  }
  const ownIds=[...new Set([...item.links.map(link=>link.event_id),...byId.keys()])]
  if(await checkBusy(item,ownIds,holder,ports))return 'review'
  for(const plan of desired){
   const old=byId.get(plan.id)
   let current=await ports.getEvent(item.calendar_id,plan.id,holder)
   if(current&&!matches(current,plan,item)){
    if(old)await recordChange(item,old,current,holder,ports)
    else await ports.command('calendar_failure',{holder,booking_id:item.booking_id,proposal_id:item.proposal_id,calendar_id:item.calendar_id,revision:item.revision,review:true})
    return 'review'
   }
   if(current&&old?.etag!==current.etag){
    if(!await ports.command<boolean>('etag_update',{holder,booking_id:item.booking_id,calendar_id:item.calendar_id,event_id:plan.id,etag:current.etag,expected_etag:old?.etag}))return 'retry'
   }
   if(!current){
    const response=await ports.request(`${eventPath(item.calendar_id)}?sendUpdates=none`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(plan.payload)},holder)
    if(response.status===409){
     current=await ports.getEvent(item.calendar_id,plan.id,holder)
     if(!current||!matches(current,plan,item)){
      if(current&&owned(current,plan,item)){
       if(!await saveLink(item,plan,current,holder,ports))return 'retry'
       await recordChange(item,{event_id:plan.id,etag:current.etag!,booking_id:item.booking_id,proposal_id:item.proposal_id,segment_id:plan.segmentId,kind:plan.kind,calendar_id:item.calendar_id,start_at:plan.startAt,end_at:plan.endAt,start_date:plan.startDate,end_date_exclusive:plan.endDateExclusive,synced_revision:item.revision},current,holder,ports)
      }else await ports.command('calendar_failure',{holder,booking_id:item.booking_id,proposal_id:item.proposal_id,calendar_id:item.calendar_id,revision:item.revision,review:true})
      return 'review'
     }
    }
    else if(!response.ok)throw new AppError(502,'Calendar event could not be created')
    current=await ports.getEvent(item.calendar_id,plan.id,holder)
   }
   if(!current||!matches(current,plan,item)){
    if(old)await recordChange(item,old,current,holder,ports)
    else if(current&&owned(current,plan,item)){
     if(!await saveLink(item,plan,current,holder,ports))return 'retry'
     await recordChange(item,{event_id:plan.id,etag:current.etag!,booking_id:item.booking_id,proposal_id:item.proposal_id,segment_id:plan.segmentId,kind:plan.kind,calendar_id:item.calendar_id,start_at:plan.startAt,end_at:plan.endAt,start_date:plan.startDate,end_date_exclusive:plan.endDateExclusive,synced_revision:item.revision},current,holder,ports)
    }else await ports.command('calendar_failure',{holder,booking_id:item.booking_id,proposal_id:item.proposal_id,calendar_id:item.calendar_id,revision:item.revision,review:true})
    return 'review'
   }
   if((!old||old.etag!==current.etag||old.synced_revision!==item.revision)&&!await saveLink(item,plan,current,holder,ports))return 'retry'
   byId.set(plan.id,{event_id:plan.id,etag:current.etag!,booking_id:item.booking_id,proposal_id:item.proposal_id,segment_id:plan.segmentId,kind:plan.kind,calendar_id:item.calendar_id,start_at:plan.startAt,end_at:plan.endAt,start_date:plan.startDate,end_date_exclusive:plan.endDateExclusive,synced_revision:item.revision})
  }
  // Preserve old confirmed events until every new work block is materialized.
  if(await checkBusy(item,[...new Set([...item.links.map(link=>link.event_id),...desired.map(plan=>plan.id)])],holder,ports))return 'review'
  if(!await ports.command<boolean>('calendar_ready',{holder,booking_id:item.booking_id,proposal_id:item.proposal_id,calendar_id:item.calendar_id,revision:item.revision}))return 'retry'
  for(const old of item.links.filter(link=>link.proposal_id!==item.proposal_id)){
   const current=await ports.getEvent(item.calendar_id,old.event_id,holder)
   if(!current||current.etag!==old.etag){
    const allowed=await ports.command<boolean>('retire_authorization',{holder,booking_id:item.booking_id,proposal_id:item.proposal_id,calendar_id:item.calendar_id,revision:item.revision,event_id:old.event_id,etag:current?.etag||'deleted'})
    if(!allowed){await recordChange(item,old,current,holder,ports);return 'review'}
   }
   if(current){
    if(!await ports.command<boolean>('retire_intent',{holder,booking_id:item.booking_id,proposal_id:item.proposal_id,calendar_id:item.calendar_id,revision:item.revision,event_id:old.event_id,link_etag:old.etag,etag:current.etag}))return 'retry'
    const response=await ports.request(`${eventPath(item.calendar_id,old.event_id)}?sendUpdates=none`,{method:'DELETE',headers:{'If-Match':current.etag!}},holder)
    if(!response.ok&&response.status!==404&&response.status!==410){if(response.status===412){await recordChange(item,old,await ports.getEvent(item.calendar_id,old.event_id,holder),holder,ports);return 'review'}throw new AppError(502,'Old Calendar event could not be removed')}
   }
   if(!await ports.command<boolean>('link_delete',{holder,booking_id:item.booking_id,proposal_id:item.proposal_id,calendar_id:item.calendar_id,revision:item.revision,event_id:old.event_id,etag:old.etag}))return 'retry'
  }
  for(const plan of desired){
   const current=await ports.getEvent(item.calendar_id,plan.id,holder)
   const link=byId.get(plan.id)!
   if(!current||!matches(current,plan,item)){await recordChange(item,link,current,holder,ports);return 'review'}
   if(current.etag!==link.etag&&!await ports.command<boolean>('etag_update',{holder,booking_id:item.booking_id,calendar_id:item.calendar_id,event_id:plan.id,etag:current.etag,expected_etag:link.etag}))return 'retry'
  }
  if(await checkBusy(item,desired.map(plan=>plan.id),holder,ports))return 'review'
  return await ports.command<boolean>('calendar_success',{holder,booking_id:item.booking_id,proposal_id:item.proposal_id,calendar_id:item.calendar_id,revision:item.revision})?'synced':'retry'
 }catch(error){
  await ports.command('calendar_failure',{holder,booking_id:item.booking_id,proposal_id:item.proposal_id,calendar_id:item.calendar_id,revision:item.revision,review:error instanceof AppError&&error.status===409})
  return error instanceof AppError&&error.status===409?'review':'retry'
 }
}
/** Called under the same lease as Gmail and legacy Calendar cursor synchronization. */
export async function pushBookingPending(calendarId:string,holder:string){
 const rows=await bookingCommand<Pending[]>('calendar_pending',{calendar_id:calendarId,holder})
 const result={synced:0,reviewed:0,retrying:0}
 for(const item of rows){
  if(!await operationsCommand<boolean>('sync_renew',{holder}))throw new AppError(409,'Calendar sync lease expired')
  const state=await syncBookingItem(item,holder)
  if(state==='synced')result.synced++;else if(state==='review')result.reviewed++;else result.retrying++
 }
 return result
}
/** Best-effort immediate attempt after durable confirmation; the poller retries later. */
export async function syncBookingCalendar(){
 const holder=randomUUID()
 if(!await operationsCommand<boolean>('sync_acquire',{holder}))return {synced:0,reviewed:0,retrying:0,skipped:'Sync already in progress'}
 try{
  const connection=await getConnection()
  if(!connection?.selected_calendar_id)return {synced:0,reviewed:0,retrying:0,skipped:'No Calendar selected'}
  return pushBookingPending(connection.selected_calendar_id,holder)
 }finally{await operationsCommand('sync_release',{holder})}
}
export async function readBookingChanges(bookingId:string):Promise<BookingCalendarChange[]>{
 return bookingCommand<BookingCalendarChange[]>('review_list',{booking_id:bookingId})
}
export async function inspectBookingCalendarEvent(calendarId:string,holder:string,link:Link,event:Event|null,port:Pick<BookingCalendarPorts,'command'>={command:bookingCommand}):Promise<boolean>{
 const proposed=event?.start?.dateTime&&event?.end?.dateTime&&Number.isFinite(Date.parse(event.start.dateTime))&&Number.isFinite(Date.parse(event.end.dateTime))
 const owner=event?.extendedProperties?.private?.bookingId===link.booking_id&&event?.extendedProperties?.private?.proposalId===link.proposal_id&&
  event?.extendedProperties?.private?.segmentId===link.segment_id&&event?.extendedProperties?.private?.revision===String(link.synced_revision)
 const same=event?.status==='confirmed'&&!event?.recurrence?.length&&!event?.recurringEventId&&matchesTransparency(event.transparency,link.kind)&&
  owner&&
  (link.kind==='work'?sameTime(event?.start?.dateTime,link.start_at)&&sameTime(event?.end?.dateTime,link.end_at):event?.start?.date===link.start_date&&event?.end?.date===link.end_date_exclusive)
 if(same&&event?.etag){
  if(event.etag===link.etag)return false
  return !await port.command<boolean>('etag_update',{holder,booking_id:link.booking_id,calendar_id:calendarId,event_id:link.event_id,etag:event.etag,expected_etag:link.etag})
 }
 await port.command('external_change',{holder,booking_id:link.booking_id,proposal_id:link.proposal_id,calendar_id:calendarId,segment_id:link.segment_id,event_id:link.event_id,
  change_id:randomUUID(),etag:!event||event.status==='cancelled'?'deleted':event?.etag||'deleted',kind:!event||event.status==='cancelled'?'delete':event.recurrence?.length||event.recurringEventId||link.kind==='summary'||!proposed||!owner?'invalid':'move',
  start_at:proposed?event?.start?.dateTime:null,end_at:proposed?event?.end?.dateTime:null})
 return true
}
export async function bookingLinks(calendarId:string):Promise<Link[]>{return bookingCommand<Link[]>('calendar_links',{calendar_id:calendarId})}
/** Reconcile new external busy events even when no managed event was edited. */
export async function reconcileBookingBusy(calendarId:string,holder:string){
 const ready=await bookingCommand<Ready[]>('reconcile_ready',{calendar_id:calendarId})
 let reviewed=0
 for(const item of ready){
  if(!await operationsCommand<boolean>('sync_renew',{holder}))throw new AppError(409,'Calendar sync lease expired')
  if(await checkBusy(item,item.own_event_ids,holder,livePorts))reviewed++
 }
 return {reviewed}
}
