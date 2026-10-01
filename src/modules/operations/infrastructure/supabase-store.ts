import {createHash,randomUUID} from 'node:crypto'
import type {EnquiryInput,Enquiry,ChangeRequest} from '../domain/contracts.ts'
import {operationsCommand as command} from './supabase-client.ts'
import {rowToEnquiry,type GmailImportedCandidate} from './store.ts'
export type CloudEnquiryRow=Omit<Parameters<typeof rowToEnquiry>[0],'payload_json'> & {payload_json:EnquiryInput;event_generation:number}
export function enquiryFromRow(row:CloudEnquiryRow):Enquiry { return rowToEnquiry({...row,payload_json:JSON.stringify(row.payload_json)}) }
export async function getEnquiry(id:string):Promise<Enquiry|null> { const row=await command<CloudEnquiryRow|null>('enquiry_get',{id}); return row?enquiryFromRow(row):null }
export async function createEnquiry(input:EnquiryInput):Promise<Enquiry> {
 const {idempotencyKey,...payload}=input
 const hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex')
 const existing=await command<CloudEnquiryRow|null>('enquiry_find_key',{key:idempotencyKey})
 if(!existing) {
  await command('rate_limit',{bucket:`enquiry:${createHash('sha256').update(input.email).digest('hex').slice(0,24)}`,max:5,window:3600000})
  await command('rate_limit',{bucket:'enquiry:global',max:100,window:3600000})
 }
 const id=randomUUID()
 return enquiryFromRow(await command<CloudEnquiryRow>('enquiry_create',{id,reference:`KCP-${id.replaceAll('-','').slice(0,12).toUpperCase()}`,key:idempotencyKey,hash,payload}))
}
export async function importGmail(account:string,c:GmailImportedCandidate,holder:string):Promise<Enquiry> {
 const id=randomUUID()
 const entry={messageId:c.messageId,receivedAt:c.internalDate,senderName:c.senderName,senderEmail:c.senderEmail,subject:c.subject.slice(0,300),bodyText:c.bodyText.slice(0,12000),bodyStatus:c.bodyStatus,attachmentCount:c.attachmentCount}
 const payload={serviceId:'cabinet-painting',projectIntent:c.subject.slice(0,160)||'Email enquiry',targetSurfaces:[],suburb:'',postcode:'',doorCount:null,drawerCount:null,material:'',colourPreference:'',notes:c.bodyText.slice(0,3000),name:(c.senderName||'').slice(0,120),email:(c.senderEmail||'').slice(0,254),phone:'',siteAddress:'',preferredDate:null,gmail:{threadId:c.threadId,messages:[entry],historyTruncated:false}}
 return enquiryFromRow(await command<CloudEnquiryRow>('gmail_import',{account,message:c.messageId,thread:c.threadId,id,reference:`KCP-${id.replaceAll('-','').slice(0,12).toUpperCase()}`,entry,payload,received:c.internalDate,attachments:c.attachmentCount,holder}))
}
export async function dashboardData() {
 type ChangeRow={id:string;enquiry_id:string;reference:string;kind:ChangeRequest['kind'];proposed_start_at:string|null;proposed_end_at:string|null;proposed_preferred_date:string|null;status:ChangeRequest['status'];revision:number;created_at:string}
 const data=await command<{enquiries:CloudEnquiryRow[];changes:ChangeRow[];quarantine:{message_id:string;reason:string;last_seen_at:string}[]}>('dashboard')
 return {enquiries:data.enquiries.map(enquiryFromRow),changes:data.changes.map(r=>({id:r.id,enquiryId:r.enquiry_id,reference:r.reference,kind:r.kind,proposedStartAt:r.proposed_start_at,proposedEndAt:r.proposed_end_at,proposedPreferredDate:r.proposed_preferred_date,status:r.status,revision:r.revision,createdAt:r.created_at})),quarantine:data.quarantine.map(q=>({messageId:q.message_id,reason:q.reason,lastSeenAt:q.last_seen_at}))}
}
