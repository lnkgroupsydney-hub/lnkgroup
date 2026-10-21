import { createHash } from 'node:crypto'
import { googleRequest, sydneyLocalToInstant } from '../operations/calendar-access.ts'
import { resolveLiveCalendarTarget, type LiveCalendarTarget } from '../quotes/calendar-access.ts'
import { QuoteRequestError } from '../quotes/domain/contracts.ts'
import type { LiveCompanyBooking, LiveCompanyBookingState, LiveCompanyCalendarCheck, LiveCompanyEvent, LiveCompanyProposal, LiveCompanySegment, LiveCompanyWorkerClaim } from './domain/live-contracts.ts'

const GOOGLE = 'https://www.googleapis.com/calendar/v3'
const KIND = 'lk-company-work-period-v1'
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const unavailable = () => new QuoteRequestError(503, 'Company Calendar could not be fully checked. Saved work periods remain protected; retry shortly.')
const review = (message: string) => Object.assign(new QuoteRequestError(409, message), { code: 'company_calendar_review_required' })
type Owned = { booking: LiveCompanyBooking; proposal: LiveCompanyProposal; reference: string }
type CalendarEvent = {
  id?: string; etag?: string; status?: string; summary?: string; visibility?: string; transparency?: string
  start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string }
  attendees?: unknown[]; recurrence?: unknown[]; recurringEventId?: string
  extendedProperties?: { private?: Record<string, string> }
}
export interface CompanyCalendarPorts {
  target: () => Promise<LiveCalendarTarget>
  request: (url: string, init?: RequestInit) => Promise<Response>
  occupancy: (target: LiveCalendarTarget, ignoreBookingId?: string) => Promise<{ segments: { bookingId: string | null; startAt: string; endAt: string }[] }>
  now: () => Date
}
const ports: CompanyCalendarPorts = {
  target: resolveLiveCalendarTarget,
  request: (url, init) => googleRequest('calendar', url, init),
  occupancy: async (target, ignoreBookingId) => {
    const { liveCompanyBookingStore } = await import('./infrastructure/live-store.ts')
    return liveCompanyBookingStore.command('occupancy', { ...target, ...(ignoreBookingId ? { ignoreBookingId } : {}) })
  },
  now: () => new Date(),
}
function sameTarget(a: LiveCalendarTarget, b: LiveCalendarTarget) { return a.accountSub === b.accountSub && a.calendarId === b.calendarId }
function instant(value: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw unavailable()
  return Date.parse(value)
}
function interval(event: CalendarEvent): { start: number; end: number } {
  const start = event.start, end = event.end
  let a: number, b: number
  try {
    if (typeof start?.date === 'string' && typeof end?.date === 'string' && !start.dateTime && !end.dateTime) {
      a = instant(sydneyLocalToInstant(`${start.date}T00:00`)); b = instant(sydneyLocalToInstant(`${end.date}T00:00`))
    } else if (typeof start?.dateTime === 'string' && typeof end?.dateTime === 'string' && !start.date && !end.date) {
      a = instant(start.dateTime); b = instant(end.dateTime)
    } else throw unavailable()
  } catch { throw unavailable() }
  if (b <= a) throw unavailable()
  return { start: a, end: b }
}
function checkedSegments(segments: LiveCompanySegment[]) {
  if (!Array.isArray(segments) || !segments.length || segments.length > 20) throw new QuoteRequestError(400, 'Enter all work periods before checking availability.')
  const values = segments.map(s => ({ start: instant(s.startAt), end: instant(s.endAt) }))
  if (values.some(s => s.end <= s.start)) throw unavailable()
  return values
}
export const liveCompanyEventId = (bookingId: string, proposalHash: string, segmentIndex: number) => `b${createHash('sha256').update(`lk-company-confirmed-v1:${bookingId}:${proposalHash}:${segmentIndex}`).digest('hex')}`
export function liveCompanyEventPlan(owned: Owned, segmentIndex: number) {
  const s = owned.proposal.segments[segmentIndex]
  if (!s || !/^[A-Z0-9-]{1,80}$/.test(owned.reference) || owned.booking.proposalId !== owned.proposal.id || owned.booking.proposalHash !== owned.proposal.hash) throw review('Saved company booking version is inconsistent.')
  const core = {
    id: liveCompanyEventId(owned.booking.id, owned.proposal.hash, segmentIndex),
    summary: `${s.purpose === 'take_off' ? 'Cabinet take-off' : s.purpose === 'install' ? 'Cabinet installation' : 'Cabinet painting work'} · ${owned.reference}`,
    description: owned.booking.confirmationBasis === 'signed_request' ? 'Company-confirmed appointment following the signed customer booking request. Review the original provisional photo estimate and site inspection notice in the private EMS. Contractual terms and work authorisation are managed separately.' : 'Company-approved work period. Review customer scope, price and consent in the private EMS. Contractual terms and work authorisation are managed separately.',
    status: 'confirmed', visibility: 'private', transparency: 'opaque',
    start: s.kind === 'all_day' ? { date: s.startDate } : { dateTime: s.startAt, timeZone: 'Australia/Sydney' },
    end: s.kind === 'all_day' ? { date: s.endDate } : { dateTime: s.endAt, timeZone: 'Australia/Sydney' },
    reminders: { useDefault: false },
    extendedProperties: { private: { kind: KIND, bookingId: owned.booking.id, proposalId: owned.proposal.id, proposalHash: owned.proposal.hash, confirmationVersion: String(owned.booking.version), segmentIndex: String(segmentIndex), ...(s.purpose ? { purpose: s.purpose } : {}) } },
  }
  const payloadHash = hash(core)
  return { payload: { ...core, extendedProperties: { private: { ...core.extendedProperties.private, payloadHash } } }, payloadHash }
}
function matches(event: CalendarEvent, owned: Owned, index: number): boolean {
  const plan = liveCompanyEventPlan(owned, index), p = plan.payload, owner = event.extendedProperties?.private
  let dates = false
  if (owned.proposal.segments[index].kind === 'all_day') dates = event.start?.date === p.start.date && event.end?.date === p.end.date && !event.start?.dateTime && !event.end?.dateTime
  else { try { dates = !!event.start?.dateTime && !!event.end?.dateTime && !event.start.date && !event.end.date && instant(event.start.dateTime) === instant(owned.proposal.segments[index].startAt) && instant(event.end.dateTime) === instant(owned.proposal.segments[index].endAt) } catch { dates = false } }
  // Google omits its default "opaque" value on readback, including an explicitly opaque insert.
  return dates && event.id === p.id && typeof event.etag === 'string' && !!event.etag && event.status === 'confirmed' && event.summary === p.summary && event.visibility === 'private' && [undefined,'opaque'].includes(event.transparency) && !event.attendees?.length && !event.recurrence?.length && !event.recurringEventId && Object.entries(p.extendedProperties.private).every(([key,value]) => owner?.[key] === value)
}
/** Complete private occupancy check. Public date availability never exposes provider event IDs. */
export async function checkLiveCompanyCalendar(target: LiveCalendarTarget, segments: LiveCompanySegment[], options: { ignoreBookingId?: string; owned?: Owned } = {}, deps: CompanyCalendarPorts = ports): Promise<LiveCompanyCalendarCheck> {
  const periods = checkedSegments(segments)
  if (!sameTarget(target, await deps.target())) throw unavailable()
  if (options.owned && (!sameTarget(target, options.owned.proposal.calendarTarget) || options.ignoreBookingId !== options.owned.booking.id)) throw review('Booking ownership changed during Calendar verification.')
  const verifiedOwnIds = new Set<string>()
  if (options.owned) {
    for (let index=0;index<options.owned.proposal.segments.length;index++) {
      const id=liveCompanyEventId(options.owned.booking.id,options.owned.proposal.hash,index)
      const evidence=options.owned.booking.events.find(e=>e.segmentIndex===index)
      if(evidence && evidence.eventId!==id) throw review('Saved Calendar event ownership is inconsistent.')
      const response = await deps.request(`${GOOGLE}/calendars/${encodeURIComponent(target.calendarId)}/events/${id}`)
      if(response.status===404 && !evidence?.etag && !evidence?.verifiedAt) continue
      if (response.status === 404 || response.status === 410) throw review('A saved company work period was removed from Google Calendar. Company review is required.')
      if (!response.ok) throw unavailable()
      const event = await response.json() as CalendarEvent
      if (!matches(event, options.owned, index)) throw review('A company work period changed in Google Calendar. Company review is required.')
      verifiedOwnIds.add(id)
    }
  }
  const conflicts: LiveCompanyCalendarCheck['conflicts'] = []
  const local = await deps.occupancy(target, options.ignoreBookingId)
  if (!Array.isArray(local?.segments)) throw unavailable()
  for (const row of local.segments) {
    const start = instant(row.startAt), end = instant(row.endAt)
    if (end <= start || row.bookingId !== null && typeof row.bookingId !== 'string') throw unavailable()
    for (let i=0;i<periods.length;i++) if (start < periods[i].end && periods[i].start < end) conflicts.push({ segmentIndex:i,source:'database',startAt:row.startAt,endAt:row.endAt,message:'Another company booking already occupies this work period.' })
  }
  const tokens = new Set<string>(); let page: string | undefined
  do {
    const query = new URLSearchParams({ singleEvents:'true',showDeleted:'false',timeMin:new Date(Math.min(...periods.map(s=>s.start))).toISOString(),timeMax:new Date(Math.max(...periods.map(s=>s.end))).toISOString(),timeZone:'Australia/Sydney',maxResults:'2500',fields:'accessRole,nextPageToken,items(id,etag,status,summary,visibility,transparency,start,end,recurrence,recurringEventId,attendees,extendedProperties)' })
    if (page) query.set('pageToken',page)
    const response = await deps.request(`${GOOGLE}/calendars/${encodeURIComponent(target.calendarId)}/events?${query}`)
    if (!response.ok) throw unavailable()
    const raw: unknown = await response.json()
    if (!raw || typeof raw!=='object' || Array.isArray(raw)) throw unavailable()
    const data = raw as {accessRole?:unknown;items?:unknown;nextPageToken?:unknown}
    if (data.accessRole!=='owner' || (data.items!==undefined && !Array.isArray(data.items))) throw unavailable()
    for (const entry of (data.items ?? []) as unknown[]) {
      if (!entry || typeof entry!=='object' || Array.isArray(entry)) throw unavailable()
      const event = entry as CalendarEvent
      if (typeof event.id==='string' && verifiedOwnIds.has(event.id)) {
        const index = options.owned!.proposal.segments.findIndex((_,i)=>liveCompanyEventId(options.owned!.booking.id,options.owned!.proposal.hash,i)===event.id)
        if (!matches(event,options.owned!,index)) throw review('A company work period changed while checking conflicts.')
        continue
      }
      if (event.status==='cancelled') continue
      if (!['confirmed','tentative'].includes(String(event.status)) || ![undefined,'opaque','transparent'].includes(event.transparency)) throw unavailable()
      if (event.transparency==='transparent') continue
      if (typeof event.id!=='string' || !event.id) throw unavailable()
      const busy = interval(event)
      for(let i=0;i<periods.length;i++) if(busy.start<periods[i].end && periods[i].start<busy.end) conflicts.push({segmentIndex:i,source:'google',startAt:new Date(busy.start).toISOString(),endAt:new Date(busy.end).toISOString(),message:'An existing Google Calendar event occupies this work period.'})
    }
    if(data.nextPageToken!==undefined && (typeof data.nextPageToken!=='string' || !data.nextPageToken)) throw unavailable()
    page = data.nextPageToken as string | undefined
    if(page){ if(tokens.has(page) || tokens.size>=100) throw unavailable(); tokens.add(page) }
  } while(page)
  if(!sameTarget(target,await deps.target())) throw unavailable()
  const checkedAt=deps.now().toISOString(),expiresAt=new Date(Date.parse(checkedAt)+120000).toISOString()
  return {...target,checkedAt,expiresAt,revision:hash({target,segments,conflicts}),conflicts}
}

export async function ensureLiveCompanyEvents(claim: LiveCompanyWorkerClaim, callbacks: { assertLease:()=>Promise<void>;recordEvent:(event:LiveCompanyEvent)=>Promise<void> }, deps: CompanyCalendarPorts = ports): Promise<LiveCompanyCalendarCheck> {
  if(claim.kind!=='confirmation' || !claim.booking || claim.booking.status!=='confirming') throw review('Only a current company confirmation can create work periods.')
  // Leave time for fenced DB completion/error storage within a bounded server invocation.
  const base=deps,deadline=Math.min(Date.parse(claim.leaseExpiresAt)-25000,deps.now().getTime()+180000)
  const guard=()=>{if(!Number.isFinite(deadline)||base.now().getTime()>=deadline)throw unavailable()}
  deps={...base,target:async()=>{guard();const target=await base.target();guard();return target},request:async(url,init)=>{guard();const response=await base.request(url,init);guard();return response},occupancy:async(target,ignore)=>{guard();const value=await base.occupancy(target,ignore);guard();return value}}
  const owned: Owned={booking:{...claim.booking,events:[...claim.booking.events]},proposal:claim.proposal,reference:claim.submission.reference},target=claim.proposal.calendarTarget
  const before=await checkLiveCompanyCalendar(target,claim.proposal.segments,{ignoreBookingId:claim.booking.id,owned},deps)
  if(before.conflicts.length) throw review('A work period conflicts with another booking. Company review is required.')
  for(let i=0;i<claim.proposal.segments.length;i++) {
    const plan=liveCompanyEventPlan(owned,i),path=`${GOOGLE}/calendars/${encodeURIComponent(target.calendarId)}/events`,item=`${path}/${plan.payload.id}`
    const read=async():Promise<CalendarEvent|null>=>{
      const response=await deps.request(item)
      if(response.status===404) return null
      if(response.status===410) throw review('A company work period was deleted; it will not be recreated automatically.')
      if(!response.ok) throw unavailable()
      const event=await response.json() as CalendarEvent
      if(!event || event.status==='cancelled') throw review('A company work period was cancelled externally.')
      return event
    }
    let event=await read()
    if(!event) {
      if(owned.booking.events.some(e=>e.segmentIndex===i && (e.etag || e.verifiedAt))) throw review('A previously saved work period is missing; company review is required.')
      if(instant(claim.proposal.segments[i].startAt)<=deps.now().getTime()) throw review('A proposed work period has started or passed. Company review is required.')
      if(Date.parse(claim.leaseExpiresAt)<=deps.now().getTime()+35000) throw unavailable()
      await callbacks.assertLease()
      if(!sameTarget(target,await deps.target())) throw unavailable()
      const response=await deps.request(`${path}?sendUpdates=none`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(plan.payload)})
      if(!response.ok && response.status!==409) throw unavailable()
      event=await read()
    }
    if(!event || !matches(event,owned,i)) throw review('Stored Google work period does not match the approved company proposal.')
    await callbacks.assertLease()
    const saved={segmentIndex:i,eventId:plan.payload.id,payloadHash:plan.payloadHash,etag:event.etag!,verifiedAt:deps.now().toISOString()}
    await callbacks.recordEvent(saved)
    owned.booking.events=owned.booking.events.filter(e=>e.segmentIndex!==i).concat(saved)
  }
  const after=await checkLiveCompanyCalendar(target,claim.proposal.segments,{ignoreBookingId:claim.booking.id,owned},deps)
  if(after.conflicts.length) throw review('Another Calendar event was added during confirmation. Company review is required.')
  await callbacks.assertLease()
  return after
}
export async function reconcileLiveCompanyEvents(state: LiveCompanyBookingState, deps: CompanyCalendarPorts = ports): Promise<{ok:boolean;error:string|null}> {
  if(!state.booking || !state.proposal || state.booking.events.length!==state.proposal.segments.length) return {ok:false,error:'Saved confirmation evidence is incomplete.'}
  try {
    const result=await checkLiveCompanyCalendar(state.proposal.calendarTarget,state.proposal.segments,{ignoreBookingId:state.booking.id,owned:{booking:state.booking,proposal:state.proposal,reference:state.submission.reference}},deps)
    return result.conflicts.length?{ok:false,error:'Another Calendar event now overlaps the confirmed work periods.'}:{ok:true,error:null}
  }catch(error){
    if(error instanceof Error && 'code' in error && error.code==='company_calendar_review_required') return {ok:false,error:error.message}
    throw error
  }
}

/** Only immutable manifest IDs are removed, with an independent absence read after DELETE. */
export async function removeSimpleBookingEvents(claim: import('./domain/simple-management.ts').CancellationClaim, callbacks: { assertLease(): Promise<void>; recordEvent(proof: import('./domain/simple-management.ts').AbsenceProof): Promise<void> }, deps: CompanyCalendarPorts = ports): Promise<import('./domain/simple-management.ts').AbsenceProof[]> {
  const { state, manifest } = claim
  if (!state.booking || !state.proposal || state.booking.status !== 'cancel_pending' || state.booking.confirmationBasis !== 'signed_request' || state.booking.id !== claim.bookingId || state.proposal.hash !== claim.proposalHash || state.booking.proposalHash !== claim.proposalHash || state.proposal.segments.length !== 2 || manifest.length !== 2 || state.submission.id !== state.booking.signedSubmissionId) throw review('Cancellation evidence does not match the signed booking.')
  const owned: Owned = { booking: state.booking, proposal: state.proposal, reference: state.submission.reference }, target = state.proposal.calendarTarget
  const deadline = Math.min(Date.parse(claim.leaseExpiresAt) - 20000, deps.now().getTime() + 175000)
  const guard = async () => { if (!Number.isFinite(deadline) || deps.now().getTime() >= deadline) throw unavailable(); await callbacks.assertLease(); if (!sameTarget(target, await deps.target())) throw Object.assign(review('The company Calendar target changed.'), { cancellationCode: 'calendar_target_changed' }) }
  const read = async (index: number): Promise<{ event: CalendarEvent | null; proof: import('./domain/simple-management.ts').AbsenceProof | null }> => {
    await guard()
    const id = manifest[index].eventId, response = await deps.request(`${GOOGLE}/calendars/${encodeURIComponent(target.calendarId)}/events/${id}`, { signal: AbortSignal.timeout(15000), cache: 'no-store' })
    const proof = (resultCode: import('./domain/simple-management.ts').AbsenceProof['resultCode']) => ({ segmentIndex: index, eventId: id, resultCode, verifiedAt: deps.now().toISOString() })
    if (response.status === 404 || response.status === 410) return { event: null, proof: proof(response.status === 404 ? 'absent_404' : 'absent_410') }
    if (!response.ok) throw unavailable()
    const event = await response.json() as CalendarEvent
    if (!event || event.id !== id) throw review('The expected Calendar event identity changed.')
    if (event.status === 'cancelled') return { event: null, proof: proof('cancelled_tombstone') }
    return { event, proof: null }
  }
  for (let index = 0; index < 2; index++) {
    const evidence = manifest[index], plan = liveCompanyEventPlan(owned, index)
    if (evidence.segmentIndex !== index || evidence.eventId !== plan.payload.id || evidence.payloadHash !== plan.payloadHash || !evidence.etag || !evidence.verifiedAt) throw review('Verified Calendar manifest is incomplete or changed.')
  }
  for (let index = 0; index < 2; index++) {
    let current = await read(index)
    if (current.event) {
      if (!matches(current.event, owned, index) || current.event.etag !== manifest[index].etag) throw review('The company work period was changed externally. Review it before cancellation.')
      await guard()
      let deletion: Response | undefined
      try {
        deletion = await deps.request(`${GOOGLE}/calendars/${encodeURIComponent(target.calendarId)}/events/${manifest[index].eventId}?sendUpdates=none`, { method: 'DELETE', headers: { 'If-Match': manifest[index].etag! }, signal: AbortSignal.timeout(15000), cache: 'no-store' })
      } catch { /* A lost response is resolved by the separate exact-ID GET below. */ }
      if (deletion?.status === 412) throw review('The company work period changed before deletion.')
      if (deletion && deletion.status >= 400 && deletion.status < 500 && ![404,410].includes(deletion.status)) throw unavailable()
      current = await read(index)
    }
    if (!current.proof) throw unavailable()
    await guard(); await callbacks.recordEvent(current.proof)
  }
  const final: import('./domain/simple-management.ts').AbsenceProof[] = []
  for (let index = 0; index < 2; index++) { const current = await read(index); if (!current.proof) throw review('An expected Calendar event reappeared before cancellation completed.'); final.push(current.proof) }
  await guard()
  return final
}
