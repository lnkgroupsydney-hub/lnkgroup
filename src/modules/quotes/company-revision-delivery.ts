import { randomUUID } from 'node:crypto'
import { companyRevisionMailValid, type FrozenCompanyRevisionMail, type CompanyRevisionMailKind } from './infrastructure/company-revision-receipt.ts'
import { staffMailSender } from '../../shared/email/company-sender.ts'
export interface CompanyRevisionDeliveryClaim { id:string;requestId:string;revisionId:string;kind:CompanyRevisionMailKind;leaseToken:string|null;leaseExpiresAt:string|null;emailFirstAttemptAt:string|null;emailIdempotencyKey:string;emailStatus:string;frozenMail:FrozenCompanyRevisionMail;revisionSnapshotHash:string;acceptanceSignedContentHash:string|null }
export interface CompanyRevisionDeliveryDependencies { command:<T>(name:string,args:Record<string,unknown>)=>Promise<T>;request:typeof fetch;now:()=>number;config:{enabled:boolean;apiKey:string} }
export interface CompanyRevisionDeliveryResult {disabled:boolean;claimed:number;accepted:number;retrying:number;reviewRequired:number;failed:number;storageErrors:number;configurationMissing:boolean}
export const COMPANY_REVISION_EMAIL_RETRY_WINDOW_MS=23*60*60*1000
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,HASH=/^[a-f0-9]{64}$/,TIMEOUT=15000
type ActiveCompanyRevisionDeliveryClaim = CompanyRevisionDeliveryClaim & { leaseToken: string; leaseExpiresAt: string }
function validClaim(c:CompanyRevisionDeliveryClaim|null,token:string):c is ActiveCompanyRevisionDeliveryClaim{return !!c&&UUID.test(c.id)&&UUID.test(c.requestId)&&UUID.test(c.revisionId)&&c.leaseToken===token&&Number.isFinite(Date.parse(String(c.leaseExpiresAt)))&&['revision_notice','revision_acceptance_receipt'].includes(c.kind)&&HASH.test(c.revisionSnapshotHash)&&(c.kind==='revision_notice'?c.acceptanceSignedContentHash===null:HASH.test(String(c.acceptanceSignedContentHash)))&&c.emailIdempotencyKey===`company-revision:${c.revisionId}:${c.kind}:v1`&&companyRevisionMailValid(c.frozenMail)}
function withinWindow(first:string|null,now:number){if(first===null)return true;const timestamp=Date.parse(first);return Number.isFinite(timestamp)&&timestamp<=now+60000&&now-timestamp<COMPANY_REVISION_EMAIL_RETRY_WINDOW_MS}
async function responseJson(response:Response):Promise<Record<string,unknown>|null>{const reader=response.body?.getReader();if(!reader)return null;let size=0;const chunks:Uint8Array[]=[];try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>16384){await reader.cancel();return null}chunks.push(next.value)}const value:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null}catch{return null}finally{reader.releaseLock()}}
async function command<T>(name:string,args:Record<string,unknown>){const{companyRevisionStore}=await import('./infrastructure/company-revision-store.ts');return companyRevisionStore.command<T>(name,{...args,companyId:'lk-group'})}
/** One bounded, fenced outbox attempt; retries use the already frozen bytes and provider key. */
export async function processCompanyRevisionOutbox(requestId?:string,injected?:CompanyRevisionDeliveryDependencies):Promise<CompanyRevisionDeliveryResult>{
 if(typeof window!=='undefined')throw Error('Revision delivery is server-only')
 const deps=injected??{command,request:fetch,now:Date.now,config:{enabled:process.env.QUOTE_LIVE_ENABLED==='true',apiKey:process.env.RESEND_API_KEY??''}},result:CompanyRevisionDeliveryResult={disabled:!deps.config.enabled,claimed:0,accepted:0,retrying:0,reviewRequired:0,failed:0,storageErrors:0,configurationMissing:false}
 if(!deps.config.enabled)return result;if(requestId!==undefined&&!UUID.test(requestId))throw Error('Invalid revision request identifier')
 const token=randomUUID();let claim:CompanyRevisionDeliveryClaim|null
 try{claim=await deps.command('worker_claim',{leaseToken:token,...(requestId?{requestId}:{})})}catch{result.storageErrors++;result.failed++;return result}
 if(claim===null)return result
 if(!validClaim(claim,token)){result.storageErrors++;result.failed++;return result}result.claimed++
 const lease={id:claim.id,leaseToken:token},original={id:claim.id,requestId:claim.requestId,revisionId:claim.revisionId,kind:claim.kind,key:claim.emailIdempotencyKey,hash:claim.revisionSnapshotHash,acceptance:claim.acceptanceSignedContentHash,mail:JSON.stringify(claim.frozenMail),expiresAt:claim.leaseExpiresAt}
 const same=(c:CompanyRevisionDeliveryClaim|null,finished=false):c is CompanyRevisionDeliveryClaim=>!!c&&(validClaim(c,token)||finished&&c.leaseToken===null&&c.leaseExpiresAt===null&&validClaim({...c,leaseToken:token,leaseExpiresAt:original.expiresAt},token))&&c.id===original.id&&c.requestId===original.requestId&&c.revisionId===original.revisionId&&c.kind===original.kind&&c.emailIdempotencyKey===original.key&&c.revisionSnapshotHash===original.hash&&c.acceptanceSignedContentHash===original.acceptance&&JSON.stringify(c.frozenMail)===original.mail
 const fail=async(outcome:'retrying'|'manual_review'|'failed',errorCode:string)=>{try{const row=await deps.command<CompanyRevisionDeliveryClaim>('worker_error',{...lease,outcome,errorCode});if(!same(row,true)||row.emailStatus!==outcome)throw Error('Failure not stored');if(outcome==='retrying')result.retrying++;else if(outcome==='manual_review')result.reviewRequired++;else result.failed++}catch{result.storageErrors++;result.failed++}}
 if(claim.emailStatus==='provider_accepted')return result
 if(!withinWindow(claim.emailFirstAttemptAt,deps.now())){await fail('manual_review','email_retry_window_expired');return result}
 if(!deps.config.apiKey){result.configurationMissing=true;await fail('retrying','email_configuration_missing');return result}
 // Re-validate the frozen sender at dispatch; configuration never supplies a replacement payload.
 try{staffMailSender({companyFrom:String(claim.frozenMail.payload.from),companyReplyTo:String(claim.frozenMail.payload.reply_to)})}catch{await fail('manual_review','revision_mail_invalid');return result}
 if(Date.parse(String(claim.leaseExpiresAt))<=deps.now()+TIMEOUT+5000){await fail('retrying','delivery_lease_expiring');return result}
 try{const attempted=await deps.command<CompanyRevisionDeliveryClaim>('worker_email_attempt',lease);if(!same(attempted)||!attempted.emailFirstAttemptAt)throw Error('Attempt not stored');claim=attempted}catch{result.storageErrors++;result.failed++;return result}
 if(claim.emailStatus==='provider_accepted')return result
 if(!withinWindow(claim.emailFirstAttemptAt,deps.now())){await fail('manual_review','email_retry_window_expired');return result}
 if(claim.emailStatus!=='sending'||Date.parse(String(claim.leaseExpiresAt))<=deps.now()+TIMEOUT+5000){await fail('retrying','delivery_lease_expiring');return result}
 let response:Response;try{response=await deps.request('https://api.resend.com/emails',{method:'POST',cache:'no-store',signal:AbortSignal.timeout(TIMEOUT),headers:{Authorization:`Bearer ${deps.config.apiKey}`,'Content-Type':'application/json','Idempotency-Key':claim.emailIdempotencyKey},body:JSON.stringify(claim.frozenMail.payload)})}catch{await fail('retrying','email_outcome_unknown');return result}
 const provider=await responseJson(response)
 if(!response.ok){if(response.status===429||response.status>=500||response.status===409&&provider?.name==='concurrent_idempotent_requests')await fail('retrying','email_transient');else if(response.status===409)await fail('manual_review','email_payload_conflict');else await fail('failed',response.status===401||response.status===403?'email_configuration':'email_rejected');return result}
 if(!provider||typeof provider.id!=='string'||!/^[a-zA-Z0-9_-]{1,160}$/.test(provider.id)){await fail('retrying','email_outcome_unknown');return result}
 try{const accepted=await deps.command<CompanyRevisionDeliveryClaim>('worker_email_accepted',{...lease,providerMessageId:provider.id});if(!same(accepted,true)||accepted.emailStatus!=='provider_accepted')throw Error('Acceptance not stored');result.accepted++}catch{result.storageErrors++;result.failed++}
 return result
}
