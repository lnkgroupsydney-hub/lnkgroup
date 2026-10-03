import type {BookingSegment} from './contracts.ts'
export class BookingError extends Error {status:number;constructor(status:number,message:string){super(message);this.status=status}}
export const isRecord=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)
export function revision(value:unknown):number {
  if(!Number.isSafeInteger(value)||(value as number)<0||(value as number)>2147483647)throw new BookingError(400,'Reload the current request before continuing.')
  return value as number
}
export function requestKey(value:unknown):string {
  if(typeof value!=='string'||! /^[a-zA-Z0-9_-]{16,100}$/.test(value))throw new BookingError(400,'A valid request key is required.')
  return value
}
export function uuid(value:unknown):string {
  if(typeof value!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value))throw new BookingError(400,'Invalid request identifier.')
  return value
}
export function notes(value:unknown):string {
  if(typeof value!=='string'||value.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw new BookingError(400,'Use plain text notes up to 2,000 characters.')
  return value.trim()
}
export function validateSegments(value:unknown,now=Date.now()):BookingSegment[] {
  if(!Array.isArray(value)||value.length<1||value.length>20)throw new BookingError(400,'Enter 1 to 20 actual work segments.')
  const segments=value.map((item,index)=>{
    if(!isRecord(item))throw new BookingError(400,'Enter a start and end for every work segment.')
    for(const key of ['startAt','endAt'])if(typeof item[key]!=='string'||! /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(item[key] as string))throw new BookingError(400,'Work times need an explicit timezone offset.')
    for(const key of ['startAt','endAt']){
      const text=item[key] as string,date=text.slice(0,10),[year,month,day]=date.split('-').map(Number),hour=Number(text.slice(11,13)),minute=Number(text.slice(14,16)),second=text[16]===':'?Number(text.slice(17,19)):0
      if(year<100||month<1||month>12||day<1||new Date(Date.UTC(year,month-1,day)).toISOString().slice(0,10)!==date||hour>23||minute>59||second>59)throw new BookingError(400,'Enter real calendar dates and valid clock times.')
    }
    const start=Date.parse(item.startAt as string),end=Date.parse(item.endAt as string)
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||start<=now)throw new BookingError(400,'Every work segment must start in the future and end after it starts.')
    return {id:`segment-${index+1}`,startAt:new Date(start).toISOString(),endAt:new Date(end).toISOString()}
  }).sort((a,b)=>Date.parse(a.startAt)-Date.parse(b.startAt))
  if(segments.some((item,index)=>index>0&&Date.parse(item.startAt)<Date.parse(segments[index-1].endAt)))throw new BookingError(400,'Work segments in the same proposal must not overlap.')
  return segments.map((item,index)=>({...item,id:`segment-${index+1}`}))
}
