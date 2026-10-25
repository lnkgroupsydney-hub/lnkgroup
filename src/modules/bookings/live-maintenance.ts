import type {LiveCompanyBookingState} from './domain/live-contracts.ts'
import {reconcileLiveCompanyEvents} from './live-calendar.ts'
import {processCompanyBookingOutbox} from './live-delivery.ts'
import {processCompanyRevisionOutbox} from '../quotes/company-revision-delivery.ts'
import {processLiveBookingDelivery} from '../quotes/booking-delivery.ts'
export interface CompanyBookingReconcileResult {checked:number;reviewRequired:number;unavailable:number;storageErrors:number}
export async function reconcileLiveCompanyBookingBatch(injected?:{
 command:<T>(name:string,args:Record<string,unknown>)=>Promise<T>
 reconcile:typeof reconcileLiveCompanyEvents;now:()=>number;maxJobs?:number
}):Promise<CompanyBookingReconcileResult>{
 const deps=injected??{command:async<T>(name:string,args:Record<string,unknown>)=>{const{liveCompanyBookingStore}=await import('./infrastructure/live-store.ts');return liveCompanyBookingStore.command<T>(name,args)},reconcile:reconcileLiveCompanyEvents,now:Date.now,maxJobs:1}
 const result={checked:0,reviewRequired:0,unavailable:0,storageErrors:0},started=deps.now()
 let candidates:{states:LiveCompanyBookingState[]}
 try{candidates=await deps.command('reconcile_batch',{});if(!Array.isArray(candidates.states))throw Error('Incomplete booking batch')}catch{result.storageErrors++;return result}
 const requested=deps.maxJobs??1,maxJobs=Number.isInteger(requested)?Math.max(0,Math.min(requested,5)):1
 for(const state of candidates.states.slice(0,maxJobs)){
  if(deps.now()-started>=40000)break
  let proof:Awaited<ReturnType<typeof reconcileLiveCompanyEvents>>
  try{proof=await deps.reconcile(state)}catch{result.unavailable++;continue}
  try{if(!state.booking)throw Error('Missing booking evidence');await deps.command('reconcile_result',{bookingId:state.booking.id,ok:proof.ok,error:proof.error});result.checked++;if(!proof.ok)result.reviewRequired++}
  catch{result.storageErrors++}
 }
 return result
}
/** Daily backup has a bounded number of leases; immediate UI actions also run their own durable jobs. */
export async function processLiveBookingMaintenance(){
 const started=Date.now(),company=await processCompanyBookingOutbox()
 const {processSimpleBookingCancellation}=await import('./simple-cancellation.ts')
 const cancellation=Date.now()-started<65000?await processSimpleBookingCancellation():null
 const revision=Date.now()-started<65000?await processCompanyRevisionOutbox():null
 const request=Date.now()-started<65000?await processLiveBookingDelivery():null
 const reconciliation=Date.now()-started<120000?await reconcileLiveCompanyBookingBatch():null
 return {company,request,revision,reconciliation,cancellation,storageErrors:(revision?.storageErrors??0)+company.storageErrors+(cancellation?.storageErrors??0)+(request?.storageErrors??0)+(reconciliation?.storageErrors??0)}
}
