import {createHash,randomUUID} from 'node:crypto'
import {demoEnabled,demoRecipient,validateDemoSignature,quoteSession,quoteStorageClient,requireQuoteOrigin,quoteJson,QuoteHttpError} from '../../enquiries/demo-session.ts'
import {requireSession,sydneyLocalToInstant,AppError} from '../../operations/access.ts'
import {createDemoPdfDocuments,validFrozenDemoPayload,type DemoPdfDocument} from '../../enquiries/documents.ts'
import {verifyBookingCalendar} from '../calendar-availability.ts'
import {confirmBooking} from '../application/confirm.ts'
import {BookingError,isRecord,notes,requestKey,revision,uuid,validateSegments} from '../domain/validation.ts'
import type {BookingDetail,BookingProposalSnapshot,BookingSummary} from '../domain/contracts.ts'
import {bookingCommand,bookingCalendarId,verifiedOwnBookingEventIds,frozenDocumentPayload} from './store.ts'
type Schedule=(task:()=>Promise<void>)=>void
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
async function safe(action:()=>Promise<Response>){try{return await action()}catch(error){if(error instanceof BookingError||error instanceof QuoteHttpError||error instanceof AppError)return quoteJson({error:error.message},error.status);return quoteJson({error:'This booking step is temporarily unavailable. Your saved evidence is unchanged.'},503)}}
function gate(req:Request,write=false){if(!demoEnabled())throw new BookingError(404,'The company booking demo is not enabled.');demoRecipient();if(write)requireQuoteOrigin(req)}
async function admin(req:Request,write=false){gate(req,write);const session=await requireSession(req);return session.token_hash}
function customer(req:Request,write=false){gate(req,write);const owner=quoteSession(req);if(!owner)throw new BookingError(401,'Your private author session expired. Reopen the original demo browser.');return owner.hash}
async function input(req:Request){
 if(!req.headers.get('content-type')?.startsWith('application/json'))throw new BookingError(415,'JSON required.')
 const reader=req.body?.getReader();if(!reader)throw new BookingError(400,'Request details required.')
 const parts:Uint8Array[]=[];let size=0
 while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>256000){await reader.cancel();throw new BookingError(413,'The request is too large.')}parts.push(next.value)}
 let value:unknown;try{value=JSON.parse(Buffer.concat(parts).toString('utf8'))}catch{throw new BookingError(400,'Invalid request.')}
 if(!isRecord(value))throw new BookingError(400,'Invalid request.');return value
}
async function limit(owner:string,purpose:string){const {error}=await quoteStorageClient().rpc('lk_operations_command',{command:'rate_limit',args:{bucket:`booking:${purpose}:${owner}`,max:60,window:3600000}});if(error)throw new BookingError(error.code==='LK429'?429:503,'Please retry this booking step later.')}
async function detail(id:string){const result=await bookingCommand<BookingDetail|null>('admin_detail',{id});if(!result)throw new BookingError(404,'Submission unavailable.');return result}
export const adminBookingsGet=(req:Request)=>safe(async()=>{await admin(req);return quoteJson({bookings:await bookingCommand<BookingSummary[]>('admin_list')})})
export const adminBookingGet=(req:Request,id:string)=>safe(async()=>{await admin(req);return quoteJson({detail:await detail(uuid(id))})})
export const customerBookingGet=(req:Request)=>safe(async()=>{const owner=customer(req);return quoteJson({detail:await bookingCommand<BookingDetail|null>('customer_detail',{owner_hash:owner})})})
export const proposalPost=(req:Request,id:string)=>safe(async()=>{
 const actor=await admin(req,true);await limit(actor,'proposal');id=uuid(id)
 const body=await input(req),expected=revision(body.expectedRevision),key=requestKey(body.idempotencyKey),proposalNotes=notes(body.notes??'')
 if(!Array.isArray(body.segments))throw new BookingError(400,'Enter actual work segments.')
 const segments=validateSegments(body.segments.map(segment=>{
  if(!isRecord(segment))throw new BookingError(400,'Enter actual work segments.')
  return 'startLocal'in segment||'endLocal'in segment?{startAt:sydneyLocalToInstant(segment.startLocal),endAt:sydneyLocalToInstant(segment.endLocal)}:segment
 }))
 const original=await detail(id),proposalId=randomUUID(),proposalRevision=Math.max(0,...original.proposals.map(p=>p.revision))+1
 const snapshot:BookingProposalSnapshot={mode:'demo',version:'booking-demo-v1',submissionId:id,reference:original.submission.reference,submission:original.submission.snapshot,proposalId,proposalRevision,resource:'demo-single-resource',segments,notes:proposalNotes}
 const saved=await bookingCommand<BookingDetail>('proposal_create',{id,proposal_id:proposalId,expected_revision:expected,key,request_hash:hash({expected,segments,notes:proposalNotes}),snapshot,snapshot_hash:hash(snapshot),actor_hash:actor})
 return quoteJson({detail:saved},201)
})
export const consentPost=(req:Request,schedule:Schedule)=>safe(async()=>{
 const owner=customer(req,true);await limit(owner,'consent');const body=await input(req)
 const proposalId=uuid(body.proposalId),key=requestKey(body.idempotencyKey),signature=validateDemoSignature(body.signature)
 if(typeof body.snapshotHash!=='string'||!/^[a-f0-9]{64}$/.test(body.snapshotHash))throw new BookingError(400,'Reload the current work proposal before signing.')
 const saved=await bookingCommand<BookingDetail>('consent',{owner_hash:owner,proposal_id:proposalId,snapshot_hash:body.snapshotHash,key,signature,request_hash:hash({proposalId,snapshotHash:body.snapshotHash,signature})})
 schedule(async()=>{try{const {runBookingDelivery}=await import('../delivery.ts');await runBookingDelivery({id:proposalId,limit:1})}catch{/* Durable proposal queue owns retry. */}})
 return quoteJson({detail:saved},202)
})
export const confirmPost=(req:Request,id:string,schedule:Schedule)=>safe(async()=>{
 const actor=await admin(req,true);await limit(actor,'confirm');const body=await input(req),proposalId=uuid(body.proposalId),key=requestKey(body.idempotencyKey)
 const saved=await confirmBooking({id:uuid(id),proposalId,expectedRevision:revision(body.expectedRevision),key,requestHash:hash({proposalId})},{read:id=>bookingCommand('admin_detail',{id}),calendarId:bookingCalendarId,ownEventIds:verifiedOwnBookingEventIds,verify:verifyBookingCalendar,commit:args=>bookingCommand('confirm',args)})
 schedule(async()=>{try{const {syncBookingCalendar}=await import('../calendar.ts');await syncBookingCalendar()}catch{/* Confirmed occupancy is retained until durable sync recovers. */}})
 return quoteJson({detail:saved},202)
})
export const bookingDocumentGet=(req:Request,options:{admin:boolean;id?:string;kind:string;proposalId?:string|null})=>safe(async()=>{
 let result:BookingDetail|null,ownerHash:string|undefined
 if(options.admin){await admin(req);result=await detail(uuid(options.id))}
 else{ownerHash=customer(req);result=await bookingCommand('customer_detail',{owner_hash:ownerHash})}
 if(!result)throw new BookingError(404,'Document unavailable.')
 if(options.kind!=='quote'&&options.kind!=='agreement')throw new BookingError(404,'Document unavailable.')
 const proposal=options.proposalId?result.proposals.find(p=>p.id===uuid(options.proposalId)):null
 if(options.proposalId&&(!proposal?.signature||!proposal.consentedAt))throw new BookingError(404,'The signed proposal document is not available yet.')
 const source=proposal?{id:proposal.id,reference:result.submission.reference,submitted_at:proposal.consentedAt!,snapshot_hash:proposal.snapshotHash,snapshot:proposal.snapshot.submission,signature:proposal.signature!}:{id:result.submission.id,reference:result.submission.reference,submitted_at:result.submission.submittedAt,snapshot_hash:result.submission.snapshotHash,snapshot:result.submission.snapshot,signature:result.submission.signature}
 const stored=await frozenDocumentPayload({submissionId:result.submission.id,proposalId:proposal?.id,snapshotHash:source.snapshot_hash,ownerHash})
 const suffix=proposal?`-schedule-${proposal.revision}`:''
 const filenames={quote:`${source.reference}${suffix}-demo-quote.pdf`,agreement:`${source.reference}${suffix}-signed-demo-terms.pdf`}
 let document:DemoPdfDocument|undefined
 if(stored!==null){
  if(!validFrozenDemoPayload(stored))throw new BookingError(503,'The frozen email documents could not be verified.')
  if(stored.attachments.some(item=>item.filename.endsWith('.pdf'))){
   if(stored.attachments.length!==2||!Object.values(filenames).every(filename=>stored.attachments.filter(item=>item.filename===filename).length===1))throw new BookingError(503,'The saved PDF version does not match this signed request.')
   const attachment=stored.attachments.find(item=>item.filename===filenames[options.kind as 'quote'|'agreement'])!
   const bytes=Buffer.from(attachment.content,'base64')
   if(bytes.toString('base64')!==attachment.content||bytes.subarray(0,5).toString('ascii')!=='%PDF-')throw new BookingError(503,'The frozen PDF could not be verified.')
   document={filename:attachment.filename,contentType:'application/pdf',bytes,sha256:createHash('sha256').update(bytes).digest('hex')}
  }else if(!stored.attachments.every(item=>item.filename.endsWith('.html')))throw new BookingError(503,'The saved documents could not be verified.')
 }
 if(!document){const docs=await createDemoPdfDocuments(source,proposal?{proposalId:proposal.id,revision:proposal.revision,segments:proposal.segments,notes:proposal.notes}:undefined);document=docs[options.kind]}
 return new Response(new Uint8Array(document.bytes),{headers:{'content-type':document.contentType,'content-disposition':`attachment; filename="${document.filename}"`,'cache-control':'private, no-store','vary':'Cookie','x-content-type-options':'nosniff'}})
})
export const bookingChangesGet=(req:Request,id:string)=>safe(async()=>{
 await admin(req);id=uuid(id);await detail(id)
 const {data,error}=await quoteStorageClient().rpc('lk_booking_calendar',{command:'review_list',args:{booking_id:id}})
 if(error)throw new BookingError(503,'Calendar change reviews are temporarily unavailable.')
 return quoteJson({changes:data})
})
