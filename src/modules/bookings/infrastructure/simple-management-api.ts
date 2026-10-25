import { after } from 'next/server.js'
import { sydneyLocalToInstant } from '../../operations/access.ts'
import { workExact, workId, workMutation } from '../../enquiries/management.ts'
import { workApiBoundary, workApiDefaults, type WorkApiDependencies } from '../../enquiries/management-server.ts'
import { simpleDraftInput } from '../domain/simple-management.ts'
export function createSimpleBookingManagementApi(deps: WorkApiDependencies) { const run=workApiBoundary(deps);return {
 detail:(req:Request,id:string)=>run(req,'booking_detail',{id}), save:(req:Request,id:string)=>run(req,'booking_save',{id},raw=>simpleDraftInput(raw,sydneyLocalToInstant)),
 cancel:(req:Request,id:string)=>run(req,'booking_cancel',{id},raw=>{workExact(raw,['expectedRevision','idempotencyKey','reason']);return workMutation(raw)},202),
 cancellation:(req:Request,id:string)=>run(req,'booking_cancellation',{id}),
 retry:(req:Request,id:string)=>run(req,'booking_cancel_retry',{id},raw=>{workExact(raw,['idempotencyKey']);return {idempotencyKey:workId(raw.idempotencyKey)}},202),
 receipt:(req:Request,id:string,key:string)=>run(req,'booking_receipt',{id,key}),
} }
export const simpleBookingManagementApi=createSimpleBookingManagementApi({...workApiDefaults,enabled:()=>process.env.QUOTE_LIVE_ENABLED==='true',enqueue:requestId=>after(async()=>{const {processSimpleBookingCancellation}=await import('../simple-cancellation.ts');await processSimpleBookingCancellation(requestId)})})
