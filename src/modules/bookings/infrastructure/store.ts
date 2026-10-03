import {quoteStorageClient} from '../../enquiries/demo-session.ts'
import {BookingError} from '../domain/validation.ts'
export async function bookingCommand<T>(command:string,args:Record<string,unknown>={}):Promise<T>{
  const {data,error}=await quoteStorageClient().rpc('lk_booking_command',{command,args})
  if(error){const statuses:Record<string,number>={LK400:400,LK403:403,LK404:404,LK409:409,LK429:429};const messages:Record<string,string>={LK400:'Check the proposed work segments and acknowledgement.',LK403:'This request is not available to your session.',LK404:'This request is not available.',LK409:'The request changed, needs consent or email delivery, or overlaps an occupied work segment. Reload and review before trying again.',LK429:'Too many requests. Please retry later.'};throw new BookingError(statuses[error.code]??503,messages[error.code]??'Booking storage is temporarily unavailable.')}
  return data as T
}
export const bookingOccupancy=(startAt:string,endAt:string)=>bookingCommand<{startAt:string;endAt:string}[]>('occupancy',{start_at:startAt,end_at:endAt})
export async function verifiedOwnBookingEventIds(bookingId:string,calendarId:string):Promise<string[]>{
  const {data,error}=await quoteStorageClient().rpc('lk_booking_calendar',{command:'own_links',args:{booking_id:bookingId,calendar_id:calendarId}})
  if(error)throw new BookingError(503,'Calendar links could not be verified.')
  return data as string[]
}
export async function bookingCalendarId(id:string):Promise<string>{
  const {data,error}=await quoteStorageClient().from('lk_bookings').select('calendar_id').eq('id',id).single()
  if(error||!data?.calendar_id)throw new BookingError(409,'Create and acknowledge a current work proposal first.')
  return data.calendar_id
}

/** Only call after authenticating the administrator or the original author session. */
export async function frozenDocumentPayload(input:{submissionId:string;proposalId?:string;snapshotHash:string;ownerHash?:string}):Promise<unknown>{
 let query=input.proposalId
  ? quoteStorageClient().from('lk_booking_proposals').select('snapshot_hash,email_payload').eq('id',input.proposalId).eq('booking_id',input.submissionId)
  : quoteStorageClient().from('lk_quote_submissions').select('snapshot_hash,email_payload').eq('id',input.submissionId)
 if(!input.proposalId&&input.ownerHash)query=query.eq('owner_hash',input.ownerHash)
 const {data,error}=await query.single()
 if(error||!data||data.snapshot_hash!==input.snapshotHash)throw new BookingError(503,'The saved document evidence could not be verified.')
 return data.email_payload
}
