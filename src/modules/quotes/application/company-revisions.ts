import type { WorkActor, WorkStore } from '../../enquiries/management.ts'
import type { QuoteRequestOwner } from '../domain/contracts.ts'
import { verifiedBookingOwnerArgs } from './booking-flow.ts'
export function companyRevisions(store:WorkStore){return {
 staff:<T>(actor:WorkActor,command:string,input:Record<string,unknown>={})=>store.command<T>(command,{...input,companyId:actor.companyId,actorUserId:actor.userId,actorSessionId:actor.sessionId}),
 customer:<T>(owner:QuoteRequestOwner,command:string,input:Record<string,unknown>={})=>store.command<T>(command,{...input,...verifiedBookingOwnerArgs(owner)}),
}}
