import type {BookingDetail,BookingSegment} from '../domain/contracts.ts'
import {BookingError} from '../domain/validation.ts'
export interface ConfirmationPorts {
  read(id:string):Promise<BookingDetail|null>
  calendarId(id:string):Promise<string>
  ownEventIds(id:string,calendarId:string):Promise<string[]>
  verify(input:{segments:BookingSegment[];calendarId:string;excludedManagedEventIds:string[];bookingId:string}):Promise<{checkedAt:string;calendarId:string}>
  commit(args:Record<string,unknown>):Promise<BookingDetail>
}
export async function confirmBooking(input:{id:string;proposalId:string;expectedRevision:number;key:string;requestHash:string},ports:ConfirmationPorts){
  const detail=await ports.read(input.id),proposal=detail?.proposals.find(p=>p.id===input.proposalId)
  if(!detail||!proposal)throw new BookingError(404,'This work proposal is unavailable.')
  const base={id:input.id,proposal_id:input.proposalId,expected_revision:input.expectedRevision,key:input.key,request_hash:input.requestHash}
  // The database checks the original command key/hash before returning this replay.
  if(proposal.confirmedAt)return ports.commit(base)
  if(detail.booking.revision!==input.expectedRevision||detail.booking.pendingProposalId!==proposal.id||!proposal.consentedAt||proposal.emailStatus!=='provider_accepted')throw new BookingError(409,'The current proposal needs customer acknowledgement and accepted company email before confirmation.')
  const calendarId=await ports.calendarId(input.id)
  const result=await ports.verify({segments:proposal.segments,calendarId,excludedManagedEventIds:await ports.ownEventIds(input.id,calendarId),bookingId:input.id})
  return ports.commit({...base,checked_at:result.checkedAt,calendar_id:result.calendarId})
}
