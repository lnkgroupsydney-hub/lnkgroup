import {randomUUID} from 'node:crypto'
import {staffMailSender,type CompanyMailSender} from '../../shared/email/company-sender.ts'
import type {LiveCompanyWorkerClaim} from './domain/live-contracts.ts'
import {createCompanyBookingMail,validCompanyBookingMail} from './infrastructure/live-receipt.ts'
import {ensureLiveCompanyEvents} from './live-calendar.ts'

export interface CompanyBookingDeliveryPorts {
 command:<T>(name:string,args:Record<string,unknown>)=>Promise<T>
 request:typeof fetch;now:()=>number
 config:{enabled:boolean;apiKey:string;sender:CompanyMailSender|null}
 calendar:typeof ensureLiveCompanyEvents
 createMail?:typeof createCompanyBookingMail
}
export interface CompanyBookingDeliveryResult {disabled:boolean;claimed:number;accepted:number;confirmed:number;retrying:number;reviewRequired:number;failed:number;storageErrors:number;configurationMissing:boolean}
const RETRY_WINDOW=23*3600000,TIMEOUT=15000
async function command<T>(name:string,args:Record<string,unknown>):Promise<T>{const {liveCompanyBookingStore}=await import('./infrastructure/live-store.ts');return liveCompanyBookingStore.command<T>(name,args)}
function config():CompanyBookingDeliveryPorts['config']{
 let sender:CompanyMailSender|null=null;try{if(process.env.COMPANY_EMAIL_FROM)sender=staffMailSender({companyFrom:process.env.COMPANY_EMAIL_FROM,companyReplyTo:process.env.COMPANY_EMAIL_REPLY_TO})}catch{/* Configuration errors remain a retryable saved job. */}
 return {enabled:process.env.QUOTE_LIVE_ENABLED==='true',apiKey:process.env.RESEND_API_KEY??'',sender}
}
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x)
function validClaim(value:unknown,leaseToken:string):value is LiveCompanyWorkerClaim {
 if(!object(value)||value.leaseToken!==leaseToken||typeof value.id!=='string'||!/^[a-f0-9-]{36}$/i.test(value.id)||!['proposal_notice','acceptance_receipt','confirmation'].includes(String(value.kind))||typeof value.leaseExpiresAt!=='string'||!Number.isFinite(Date.parse(value.leaseExpiresAt))||typeof value.emailIdempotencyKey!=='string'||value.emailIdempotencyKey.length>200||!object(value.proposal)||!object(value.submission))return false
 return /^[a-f0-9]{64}$/.test(String(value.proposal.hash))&&typeof value.submission.id==='string'
}
function safeAttempt(start:string|null,now:number){if(start===null)return true;const ms=Date.parse(start);return Number.isFinite(ms)&&ms<=now+60000&&now-ms<RETRY_WINDOW}
async function provider(response:Response):Promise<Record<string,unknown>|null>{
 const reader=response.body?.getReader();if(!reader)return null
 const chunks:Uint8Array[]=[];let length=0
 try{while(true){const next=await reader.read();if(next.done)break;length+=next.value.byteLength;if(length>16384){await reader.cancel();return null}chunks.push(next.value)}const value:unknown=JSON.parse(Buffer.concat(chunks,length).toString());return object(value)?value:null}catch{return null}finally{reader.releaseLock()}
}
export async function processCompanyBookingOutbox(requestId?:string,injected?:CompanyBookingDeliveryPorts):Promise<CompanyBookingDeliveryResult>{
 if(typeof window!=='undefined')throw new Error('Company booking delivery is server-only')
 const deps=injected??{command,request:fetch,now:Date.now,config:config(),calendar:ensureLiveCompanyEvents}
 const result:CompanyBookingDeliveryResult={disabled:!deps.config.enabled,claimed:0,accepted:0,confirmed:0,retrying:0,reviewRequired:0,failed:0,storageErrors:0,configurationMissing:false}
 if(result.disabled)return result
 if(requestId!==undefined&&!/^[a-f0-9-]{36}$/i.test(requestId))throw new Error('Invalid company booking request')
 const leaseToken=randomUUID();let claim:LiveCompanyWorkerClaim|null
 try{claim=await deps.command('worker_claim',{...(requestId?{requestId}:{}),leaseToken})}catch{result.storageErrors++;result.failed++;return result}
 if(claim===null)return result
 if(!validClaim(claim,leaseToken)){result.storageErrors++;result.failed++;return result}
 result.claimed++
 const lease={id:claim.id,leaseToken},identity={requestId:claim.requestId,proposalId:claim.proposal.id,proposalHash:claim.proposal.hash,kind:claim.kind}
 const same=(row:unknown):row is LiveCompanyWorkerClaim=>validClaim(row,leaseToken)&&row.id===lease.id&&row.requestId===identity.requestId&&row.proposal.id===identity.proposalId&&row.proposal.hash===identity.proposalHash&&row.kind===identity.kind
 const fail=async(stage:'email'|'calendar',outcome:'retrying'|'manual_review'|'failed',error:string)=>{try{await deps.command('worker_error',{...lease,stage,outcome,error});if(outcome==='retrying')result.retrying++;else if(outcome==='manual_review')result.reviewRequired++;else result.failed++}catch{result.storageErrors++;result.failed++}}
 // Confirmation mail may only be produced after every Google period and final occupancy readback succeeds.
 if(claim.kind==='confirmation'&&claim.booking?.status!=='confirmed'){
  if(claim.booking?.status!=='confirming'){await fail('calendar','manual_review','booking_review_required');return result}
  if(Date.parse(claim.leaseExpiresAt)<=deps.now()+110000){await fail('calendar','retrying','confirmation_lease_expiring');return result}
  try{
   const calendarCheck=await deps.calendar(claim,{assertLease:async()=>{await deps.command('assert_lease',lease)},recordEvent:async event=>{await deps.command('record_event',{...lease,...event})}})
   const stored=await deps.command<LiveCompanyWorkerClaim>('finish_calendar',{...lease,calendarCheck:{...calendarCheck,proposalHash:claim.proposal.hash}})
   if(!same(stored)||stored.booking?.status!=='confirmed'||!stored.booking.confirmedAt||stored.booking.events.length!==stored.proposal.segments.length)throw new Error('Confirmation proof was not stored')
   claim=stored;result.confirmed++
  }catch(error){if(error instanceof Error&&'code'in error&&error.code==='company_calendar_review_required')await fail('calendar','manual_review','company_calendar_review_required');else await fail('calendar','retrying','confirmation_unverified');return result}
 }
 if(claim.emailStatus==='provider_accepted')return result
 if(!safeAttempt(claim.emailFirstAttemptAt,deps.now())){await fail('email','manual_review','email_retry_window_expired');return result}
 if(!deps.config.sender||!deps.config.apiKey){result.configurationMissing=true;await fail('email','retrying','email_configuration_missing');return result}
 try{
  const frozen=claim.frozenMail??await(deps.createMail??createCompanyBookingMail)(claim,deps.config.sender)
  if(!validCompanyBookingMail(frozen,claim)){await fail('email','manual_review','company_receipt_invalid');return result}
  if(!claim.frozenMail){const stored=await deps.command<LiveCompanyWorkerClaim>('freeze_mail',{...lease,...frozen});if(!same(stored)||!validCompanyBookingMail(stored.frozenMail,stored))throw new Error('Frozen mail was not stored');claim=stored}
  claim=await deps.command<LiveCompanyWorkerClaim>('email_attempt',lease)
  if(!same(claim)||!claim.emailFirstAttemptAt||!claim.frozenMail||!validCompanyBookingMail(claim.frozenMail,claim))throw new Error('Email attempt was not stored')
  if(claim.kind==='confirmation'&&(claim.booking?.status!=='confirmed'||!claim.booking.confirmedAt||claim.booking.proposalHash!==claim.proposal.hash))throw new Error('Company confirmation changed before email sending')
 }catch{result.storageErrors++;result.failed++;return result}
 if(claim.emailStatus!=='sending'||!safeAttempt(claim.emailFirstAttemptAt,deps.now())){await fail('email','manual_review','email_attempt_not_safe');return result}
 if(Date.parse(claim.leaseExpiresAt)<=deps.now()+TIMEOUT+5000){await fail('email','retrying','email_lease_expiring');return result}
 let response:Response
 try{response=await deps.request('https://api.resend.com/emails',{method:'POST',cache:'no-store',signal:AbortSignal.timeout(TIMEOUT),headers:{Authorization:`Bearer ${deps.config.apiKey}`,'Content-Type':'application/json','Idempotency-Key':claim.emailIdempotencyKey},body:JSON.stringify(claim.frozenMail!.payload)})}catch{await fail('email','retrying','email_outcome_unknown');return result}
 const json=await provider(response)
 if(!response.ok){if(response.status===429||response.status>=500||response.status===409&&json?.name==='concurrent_idempotent_requests')await fail('email','retrying','email_transient');else if(response.status===409)await fail('email','manual_review','email_payload_conflict');else await fail('email','failed',response.status===401||response.status===403?'email_configuration':'email_rejected');return result}
 if(typeof json?.id!=='string'||!/^[a-zA-Z0-9_-]{1,160}$/.test(json.id)){await fail('email','retrying','email_outcome_unknown');return result}
 try{await deps.command('mail_result',{...lease,providerMessageId:json.id});result.accepted++}catch{result.storageErrors++;result.failed++}
 return result
}
export async function processCompanyBookingOutboxBatch(injected?:{processOne:()=>Promise<CompanyBookingDeliveryResult>;now:()=>number}):Promise<CompanyBookingDeliveryResult>{
 const total:CompanyBookingDeliveryResult={disabled:false,claimed:0,accepted:0,confirmed:0,retrying:0,reviewRequired:0,failed:0,storageErrors:0,configurationMissing:false},run=injected?.processOne??(()=>processCompanyBookingOutbox()),now=injected?.now??Date.now,started=now()
 for(let i=0;i<5&&now()-started<120000;i++){const r=await run();for(const key of ['claimed','accepted','confirmed','retrying','reviewRequired','failed','storageErrors'] as const)total[key]+=r[key];total.disabled||=r.disabled;total.configurationMissing||=r.configurationMissing;if(!r.claimed||r.storageErrors||r.disabled)break}
 return total
}
