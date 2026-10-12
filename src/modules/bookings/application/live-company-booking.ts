import type { QuoteRequestStore } from '../../quotes/application/requests.ts'
import { verifiedBookingOwnerArgs } from '../../quotes/application/booking-flow.ts'
import type { QuoteRequestActor, QuoteRequestOwner } from '../../quotes/domain/contracts.ts'
export function liveCompanyBookingFlow(store:QuoteRequestStore){return {
 customer:<T>(owner:QuoteRequestOwner,command:string,input:Record<string,unknown>={})=>store.command<T>(command,{...input,...verifiedBookingOwnerArgs(owner)}),
 staff:<T>(actor:QuoteRequestActor,command:string,input:Record<string,unknown>={})=>store.command<T>(command,{...input,companyId:actor.companyId,actorUserId:actor.userId,actorSessionId:actor.sessionId}),
}}
