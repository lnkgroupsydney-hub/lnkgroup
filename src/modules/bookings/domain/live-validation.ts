import { QuoteRequestError } from '../../quotes/domain/contracts.ts'
import { bookingDate, bookingObject, bookingRevision, bookingUuid } from '../../quotes/domain/booking-flow.ts'
import type { LiveCompanyProposalInput, LiveCompanySegment } from './live-contracts.ts'
export { bookingObject as liveObject, bookingRevision as liveRevision, bookingUuid as liveUuid }
function text(value: unknown, label: string, max: number) { if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new QuoteRequestError(400, `Enter valid ${label}.`); return value.trim() }
const day = (value: string) => new Date(Date.parse(value) + 86400000).toISOString().slice(0,10)
const localDate = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date(value))
export function validateLiveProposal(value: Record<string, unknown>, localToInstant: (value: unknown) => string, now = Date.now()): LiveCompanyProposalInput {
 if (!Number.isSafeInteger(value.amountExGst) || (value.amountExGst as number)<1 || (value.amountExGst as number)>100000000) throw new QuoteRequestError(400,'Enter a valid final amount excluding GST in cents.')
 if (!Array.isArray(value.segments)||!value.segments.length||value.segments.length>20) throw new QuoteRequestError(400,'Enter 1 to 20 actual work periods.')
 const segments:LiveCompanySegment[]=value.segments.map(raw=>{ const r=bookingObject(raw);let startAt:string,endAt:string,startDate:string,endDate:string
  if(r.kind==='all_day'){if(Object.keys(r).some(k=>!['kind','startDate','endDate'].includes(k)))throw new QuoteRequestError(400,'Invalid all-day work period.');startDate=bookingDate(r.startDate);endDate=bookingDate(r.endDate);startAt=localToInstant(startDate+'T00:00');endAt=localToInstant(endDate+'T00:00')}
  else if(r.kind==='timed'){if(Object.keys(r).some(k=>!['kind','startLocal','endLocal'].includes(k)))throw new QuoteRequestError(400,'Invalid timed work period.');startAt=localToInstant(r.startLocal);endAt=localToInstant(r.endLocal);startDate=localDate(startAt);endDate=day(localDate(new Date(Date.parse(endAt)-1).toISOString()))}
  else throw new QuoteRequestError(400,'Choose all-day or Sydney timed work periods.')
  if(Date.parse(startAt)<=now||Date.parse(endAt)<=Date.parse(startAt)||Date.parse(endAt)-Date.parse(startAt)>90*86400000)throw new QuoteRequestError(400,'Work periods must be future periods with an end after the start, at most 90 days.')
  return {kind:r.kind,startAt,endAt,startDate,endDate,...(r.kind==='timed'?{startLocal:r.startLocal as string,endLocal:r.endLocal as string}:{})}
 })
 for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++)if(segments[i].startAt<segments[j].endAt&&segments[j].startAt<segments[i].endAt)throw new QuoteRequestError(400,'Work periods cannot overlap each other.')
 return {amountExGst:value.amountExGst as number,scope:text(value.scope,'work scope',5000),adjustmentReason:text(value.adjustmentReason,'adjustment reason',3000),segments}
}

export { validateBookingSignature } from '../../quotes/domain/booking-flow.ts'
