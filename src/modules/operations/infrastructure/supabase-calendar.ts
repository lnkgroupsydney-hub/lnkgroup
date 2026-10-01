import {createHash,randomUUID} from 'node:crypto'
import {AppError,validDate,validateProposedInstants} from '../domain/validation.ts'
import type {Enquiry} from '../domain/contracts.ts'
import {operationsCommand as command} from './supabase-client.ts'
import {accessToken,getConnection} from './supabase-auth.ts'
import {enquiryFromRow,getEnquiry,type CloudEnquiryRow} from './supabase-store.ts'
type Event={id:string;etag?:string;status?:string;start?:{date?:string;dateTime?:string};end?:{date?:string;dateTime?:string};recurrence?:string[];recurringEventId?:string;extendedProperties?:{private?:Record<string,string>}}
type Link={enquiry_id:string;event_id:string;etag:string|null;synced_revision:number}
type Change={id:string;enquiry_id:string;kind:'move'|'delete'|'invalid';proposed_start_at:string|null;proposed_end_at:string|null;proposed_preferred_date:string|null;provider_etag:string;enquiry_revision:number;status:string;revision:number}
const nextDate=(date:string)=>new Date(Date.parse(`${date}T00:00:00Z`)+86400000).toISOString().slice(0,10)
const eventId=(id:string)=>`a${createHash('sha256').update(id).digest('hex').slice(0,40)}`
const path=(calendar:string,id?:string)=>`/calendars/${encodeURIComponent(calendar)}/events${id?`/${encodeURIComponent(id)}`:''}`
async function request(url:string,init:RequestInit={}) {
 const {token}=await accessToken()
 return fetch(`https://www.googleapis.com/calendar/v3${url}`,{...init,headers:{Authorization:`Bearer ${token}`,...init.headers},cache:'no-store',signal:AbortSignal.timeout(15000)})
}
async function getEvent(calendar:string,id:string):Promise<Event|null> {
 const res=await request(path(calendar,id));if(res.status===404||res.status===410)return null
 if(!res.ok)throw new AppError(502,'Google Calendar request failed')
 return res.json() as Promise<Event>
}
export async function ownedCalendars() {
 const items:{id:string;summary:string;accessRole:string}[]=[];let page:string|undefined
 do{
  const q=new URLSearchParams({minAccessRole:'owner',maxResults:'250'});if(page)q.set('pageToken',page)
  const res=await request(`/users/me/calendarList?${q}`);if(!res.ok)throw new AppError(502,'Google Calendar list unavailable')
  const data=await res.json() as {items?:typeof items;nextPageToken?:string}
  items.push(...(data.items||[]).filter(x=>x.accessRole==='owner'));page=data.nextPageToken
 }while(page&&items.length<2000)
 return items.map(({id,summary,accessRole})=>({id,summary,accessRole}))
}
export async function selectCalendar(id:string) {
 if(!id||id.length>512||!(await ownedCalendars()).some(x=>x.id===id))throw new AppError(403,'Calendar is not owned by the approved account')
 await command('connection_select',{kind:'calendar',id})
}
export async function renew(holder:string) { if(!await command<boolean>('sync_renew',{holder}))throw new AppError(409,'Sync lease expired') }
function matches(e:Enquiry,v:Event) {
 return e.startAt&&e.endAt ? !!v.start?.dateTime&&!!v.end?.dateTime&&Date.parse(e.startAt)===Date.parse(v.start.dateTime)&&Date.parse(e.endAt)===Date.parse(v.end.dateTime) : v.start?.date===e.preferredDate&&v.end?.date===(e.preferredDate?nextDate(e.preferredDate):null)
}
async function conflict(e:Enquiry,v:Event|null,holder:string,expectedEvent:string|null,saveLink=false) {
 const preferred=v?.start?.date||null,start=v?.start?.dateTime||null,end=v?.end?.dateTime||null
 const kind=!v||v.status==='cancelled'?'delete':v.recurrence?.length||v.recurringEventId?'invalid':preferred||validateProposedInstants(start,end)?'move':'invalid'
 // Invalid timestamps cannot be stored as timestamptz; invalid changes remain review-only.
 return command<boolean>('calendar_conflict',{holder,id:e.id,revision:e.revision,expected_event:expectedEvent,change:randomUUID(),kind,start:validateProposedInstants(start,end)?start:null,end:validateProposedInstants(start,end)?end:null,preferred,etag:v?.etag||'deleted',event:saveLink?v?.id:null})
}
export async function pushPending(calendar:string,holder:string) {
 const rows=await command<CloudEnquiryRow[]>('calendar_pending');const result={synced:0,conflicts:0,failed:0}
 for(const snapshot of rows){
  await renew(holder)
  const row=await command<CloudEnquiryRow|null>('enquiry_get',{id:snapshot.id})
  if(!row||row.revision!==snapshot.revision||row.calendar_status==='conflict')continue
  const e=enquiryFromRow(row)
  const link=await command<Link|null>('calendar_link',{id:e.id})
  const base={id:link?.event_id||eventId(row.event_generation===0?e.id:`${e.id}:${row.event_generation}`),visibility:'private',transparency:'transparent',status:'confirmed',recurrence:[],summary:e.startAt?`KCP provisional · ${e.reference}`:`KCP enquiry · ${e.reference}`,description:`Reference ${e.reference}. ${e.startAt?'Provisional schedule; owner review required.':'Preferred date only; no booking confirmed.'}\n${process.env.APP_BASE_URL}/admin`,extendedProperties:{private:{enquiryId:e.id,revision:String(e.revision)}}}
  const payload=e.startAt&&e.endAt?{...base,start:{dateTime:e.startAt,timeZone:'Australia/Sydney'},end:{dateTime:e.endAt,timeZone:'Australia/Sydney'}}:{...base,start:{date:e.preferredDate},end:{date:nextDate(e.preferredDate!)}}
  try {
   const inserting=!link?.etag
   const res=await request(`${path(calendar,inserting?undefined:link.event_id)}?sendUpdates=none`,{method:inserting?'POST':'PATCH',headers:{'content-type':'application/json',...(!inserting?{'If-Match':link!.etag!}:{})},body:JSON.stringify(payload)})
   let event:Event
   if(inserting&&res.status===409){
    const current=await getEvent(calendar,payload.id)
    if(!current||current.extendedProperties?.private?.enquiryId!==e.id)throw new AppError(409,'Calendar event ID conflict')
    if(current.status!=='cancelled'&&!current.recurrence?.length&&!current.recurringEventId&&matches(e,current)&&current.extendedProperties.private.revision===String(e.revision))event=current
    else {if(await conflict(e,current,holder,link?.event_id??null,true))result.conflicts++;continue}
   }else if(!inserting&&[412,404,410].includes(res.status)){if(await conflict(e,await getEvent(calendar,payload.id),holder,link!.event_id))result.conflicts++;continue}
   else {if(!res.ok)throw new AppError(502,'Calendar sync failed');event=await res.json() as Event}
   if(!event.id||!event.etag)throw new AppError(502,'Google returned incomplete event')
   const saved=await command<boolean>('calendar_success',{holder,id:e.id,event:event.id,etag:event.etag,expected_event:link?.event_id??null,generation:row.event_generation,revision:e.revision,start:e.startAt,end:e.endAt,preferred:e.preferredDate})
   if(saved)result.synced++
  }catch{
   result.failed++;await command('calendar_failure',{holder,id:e.id,revision:e.revision})
  }
 }
 return result
}
export async function pullChanges(calendar:string,holder:string) {
 const conn=await getConnection();let token=conn?.calendar_sync_token||null,page:string|undefined,restarted=false,full=!token
 const seen=new Set<string>();const result={scanned:0,reviewed:0}
 const links=await command<Link[]>('calendar_links');const byEvent=new Map(links.map(l=>[l.event_id,l]))
 const inspect=async(link:Link,event:Event|null)=>{
  // A review decision can restore a deleted event while the Google request is in flight.
  const current=await command<Link|null>('calendar_link',{id:link.enquiry_id})
  if(!current||current.event_id!==link.event_id||(event?.etag&&current.etag===event.etag))return
  const e=await getEnquiry(link.enquiry_id);if(!e)return
  if(!event||event.status==='cancelled'||event.recurrence?.length||event.recurringEventId||!matches(e,event)){if(await conflict(e,event,holder,current.event_id))result.reviewed++}
  else if(event.etag)await command('calendar_etag',{holder,id:e.id,event:event.id,etag:event.etag})
 }
 while(true){
  await renew(holder);const q=new URLSearchParams({maxResults:'2500',showDeleted:'true'});if(token)q.set('syncToken',token);if(page)q.set('pageToken',page)
  const res=await request(`${path(calendar)}?${q}`)
  if(res.status===410&&token&&!restarted){token=null;page=undefined;restarted=true;full=true;seen.clear();await command('calendar_cursor',{holder,calendar,token:null});continue}
  if(!res.ok)throw new AppError(502,'Google Calendar request failed')
  const data=await res.json() as {items?:Event[];nextPageToken?:string;nextSyncToken?:string}
  for(const event of data.items||[]){
   result.scanned++;const link=byEvent.get(event.id);if(!link)continue;seen.add(event.id);if(link.etag===event.etag)continue
   await inspect(link,event)
  }
  page=data.nextPageToken
  if(!page){
   if(full)for(const link of links){if(seen.has(link.event_id)||!link.etag)continue;await renew(holder);await inspect(link,await getEvent(calendar,link.event_id))}
   if(!data.nextSyncToken)throw new AppError(502,'Google did not provide a sync cursor')
   await command('calendar_cursor',{holder,calendar,token:data.nextSyncToken});break
  }
 }
 return result
}
export async function decideChange(id:string,action:'approve'|'reject',revision:number) {
 const c=await command<Change|null>('change_get',{id})
 if(!c||c.status!=='pending')throw new AppError(404,'Change request not found')
 if(c.revision!==revision)throw new AppError(409,'Change request changed; reload')
 const e=await getEnquiry(c.enquiry_id),conn=await getConnection(),link=await command<Link|null>('calendar_link',{id:c.enquiry_id})
 if(!e||e.revision!==c.enquiry_revision||!conn?.selected_calendar_id||!link)throw new AppError(409,'Enquiry or calendar changed; reload')
 const current=await getEvent(conn.selected_calendar_id,link.event_id)
 const etag=current?.etag||'deleted';if(etag!==c.provider_etag)throw new AppError(409,'Google event changed; sync again')
 if(action==='approve'){
  if(c.kind==='invalid')throw new AppError(400,'Invalid Google change cannot be approved')
  if(c.kind==='move'){
   if(c.proposed_preferred_date){validDate(c.proposed_preferred_date);if(current?.end?.date!==nextDate(c.proposed_preferred_date))throw new AppError(400,'Invalid Google all-day end')}
   else if(!validateProposedInstants(c.proposed_start_at,c.proposed_end_at))throw new AppError(400,'Invalid Google time range')
  }
 }
 const row=await command<CloudEnquiryRow>('change_decide',{id,action,revision,calendar:conn.selected_calendar_id,event:link.event_id,etag,restored_event:eventId(`${e.id}:${id}`)})
 return {change:{id,status:action==='approve'?'approved':'rejected'},enquiry:enquiryFromRow(row)}
}
