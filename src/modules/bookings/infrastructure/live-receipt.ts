import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import {PDFDocument,rgb,type PDFPage} from 'pdf-lib'
import {staffMailSender,type CompanyMailSender} from '../../../shared/email/company-sender.ts'
import {BOOKING_SIMPLE_ACK_VERSION,parseBookingSignature} from '../../quotes/domain/booking-flow.ts'
import {quotePricingDisplay,NO_GST_NOTICE} from '../../quotes/index.ts'
import {validateReceiptSource} from '../../quotes/infrastructure/booking-receipt.ts'
import {COMPANY_REVISION_ACK,calculateCompanyRevisionPricing} from '../../quotes/domain/company-revision.ts'
import {sydneyLocalToInstant} from '../../operations/calendar-access.ts'
import {COMPANY_BOOKING_ACK_TEXT,COMPANY_BOOKING_ACK_VERSION,type LiveCompanyWorkerClaim} from '../domain/live-contracts.ts'

export interface FrozenCompanyMail {pdfBase64:string;pdfHash:string;payload:Record<string,unknown>}
const HASH=/^[a-f0-9]{64}$/
const money=(cents:number)=>`AUD ${(cents/100).toFixed(2)}`
const escape=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
let fontBytes:Promise<Uint8Array>|undefined
const fontData=()=>fontBytes??=readFile(join(process.cwd(),'src/shared/assets/pdf-fonts/LKDemoSans-Regular.ttf')).catch(error=>{fontBytes=undefined;throw error})
const titles={proposal_notice:'Company price and work schedule proposal',acceptance_receipt:'Company proposal acknowledgment',confirmation:'Booking confirmed'} as const
const dateTime=(date:string)=>new Intl.DateTimeFormat('en-AU',{dateStyle:'medium',timeStyle:'short',timeZone:'Australia/Sydney'}).format(new Date(date))
const nextDate=(date:string,days:number)=>new Date(Date.parse(`${date}T00:00:00Z`)+days*86400000).toISOString().slice(0,10)
export function companyWorkPeriodsText(claim:LiveCompanyWorkerClaim):string {
 return claim.proposal.segments.map((s,i)=>`${i+1}. ${s.purpose==='take_off'?'Take-off: ':s.purpose==='install'?'Installation: ':''}${s.kind==='all_day'?`${s.startDate} to ${nextDate(s.endDate,-1)} inclusive (all day)`:`${dateTime(s.startAt)} to ${dateTime(s.endAt)} (Sydney)`}`).join('\n')
}
function validate(claim:LiveCompanyWorkerClaim){
 const p=claim.proposal,s=claim.submission.snapshot
 const revised=p.confirmationBasis==='accepted_revision'||claim.booking?.confirmationBasis==='accepted_revision'
 const simple=revised||claim.booking?.confirmationBasis==='signed_request'||p.confirmationBasis==='signed_request'
 if(simple)validateReceiptSource(claim.submission)
 const expectedGst=revised?0:simple?s.pricing.tax:Math.round(p.amountExGst/10)
 if(!Object.hasOwn(titles,claim.kind)||!HASH.test(p.hash)||!/^[-A-Z0-9]{1,80}$/.test(claim.submission.reference)||p.status!=='published'||!Number.isSafeInteger(p.amountExGst)||p.amountExGst<=0||p.gst!==expectedGst||p.total!==p.amountExGst+p.gst||p.currency!=='AUD'||!p.segments.length||p.segments.length>20||!s.verifiedEmail||s.verifiedEmail!==s.payload.contact.email||!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(s.verifiedEmail)||typeof p.scope!=='string'||typeof p.adjustmentReason!=='string') throw new Error('Saved company proposal is invalid')
 for(const segment of p.segments){if(!Number.isFinite(Date.parse(segment.startAt))||Date.parse(segment.endAt)<=Date.parse(segment.startAt))throw new Error('Saved work period is invalid')}
 if(revised){
  const b=claim.booking
  if(claim.kind!=='confirmation'||p.confirmationBasis!=='accepted_revision'||b?.confirmationBasis!=='accepted_revision'||b.signedSubmissionId!==claim.submission.id||claim.acceptance!==null||s.version!==BOOKING_SIMPLE_ACK_VERSION||!p.contact||!p.quantities||!p.extraItems||!p.pricing||p.pricing.tax!==0||p.pricing.total!==p.total||typeof p.customerNote!=='string'||p.companyRevisionAcknowledgment?.version!==COMPANY_REVISION_ACK.version||p.companyRevisionAcknowledgment.text!==COMPANY_REVISION_ACK.text||!p.companyRevisionId||!p.companyRevisionAcceptanceId||!HASH.test(String(p.companyRevisionSnapshotHash))||!HASH.test(String(p.companyRevisionSignedContentHash))||b.companyRevisionId!==p.companyRevisionId||b.companyRevisionAcceptanceId!==p.companyRevisionAcceptanceId||b.companyRevisionSnapshotHash!==p.companyRevisionSnapshotHash||b.companyRevisionSignedContentHash!==p.companyRevisionSignedContentHash||p.total!==calculateCompanyRevisionPricing({contact:p.contact,quantities:p.quantities,extraItems:p.extraItems,customerNote:p.customerNote}).total||p.segments.length!==2||p.segments[0].purpose!=='take_off'||p.segments[1].purpose!=='install'||p.segments.some(period=>period.kind!=='timed')||p.segments[0].startLocal!==`${claim.submission.preferredDate}T${claim.submission.preferredTime}`||Date.parse(p.segments[0].startAt)!==Date.parse(sydneyLocalToInstant(p.segments[0].startLocal))||Date.parse(p.segments[1].startAt)<Date.parse(p.segments[0].endAt))throw Error('Saved accepted-revision booking is invalid')
  parseBookingSignature(p.companyRevisionSignature)
 }else if(simple){
  if(claim.kind!=='confirmation'||p.confirmationBasis!=='signed_request'||claim.booking?.confirmationBasis!=='signed_request'||claim.booking.signedSubmissionId!==claim.submission.id||claim.acceptance!==null||s.version!==BOOKING_SIMPLE_ACK_VERSION||typeof p.companyNote!=='string'||!p.companyNote.trim()||p.companyNote.length>3000||p.amountExGst!==s.pricing.subtotal||p.gst!==s.pricing.tax||p.total!==s.pricing.total||p.segments.length!==2||p.segments[0].purpose!=='take_off'||p.segments[1].purpose!=='install'||p.segments.some(period=>period.kind!=='timed')||p.segments[0].startLocal!==`${claim.submission.preferredDate}T${claim.submission.preferredTime}`||Date.parse(p.segments[0].startAt)!==Date.parse(sydneyLocalToInstant(p.segments[0].startLocal))||Date.parse(p.segments[1].startAt)<Date.parse(p.segments[0].endAt))throw new Error('Saved signed-request booking is invalid')
 }else if(claim.kind!=='proposal_notice'){
  const a=claim.acceptance
  if(!a||a.proposalId!==p.id||a.proposalHash!==p.hash||a.acknowledgmentVersion!==COMPANY_BOOKING_ACK_VERSION||a.acknowledgmentText!==COMPANY_BOOKING_ACK_TEXT)throw new Error('Saved proposal acknowledgment is invalid')
  parseBookingSignature(a.signature)
 }
 if(claim.kind==='confirmation'&&(!claim.booking||claim.booking.status!=='confirmed'||!claim.booking.confirmedAt||claim.booking.proposalId!==p.id||claim.booking.proposalHash!==p.hash||claim.booking.events.length!==p.segments.length||claim.booking.events.some(e=>!e.etag||!e.verifiedAt||!HASH.test(e.payloadHash))))throw new Error('Calendar confirmation has not been independently verified')
}
export async function createCompanyBookingMail(claim:LiveCompanyWorkerClaim,sender:CompanyMailSender):Promise<FrozenCompanyMail>{
 if(typeof window!=='undefined')throw new Error('Company booking receipts are server-only')
 validate(claim)
 const company=staffMailSender({companyFrom:sender.from,companyReplyTo:sender.replyTo}),title=titles[claim.kind],p=claim.proposal,revised=p.confirmationBasis==='accepted_revision',simple=revised||p.confirmationBasis==='signed_request'
 const createdAt=claim.kind==='confirmation'?claim.booking!.confirmedAt!:claim.kind==='acceptance_receipt'?claim.acceptance!.acceptedAt:p.publishedAt!
 if(!Number.isFinite(Date.parse(createdAt)))throw new Error('Saved receipt timestamp is invalid')
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit)
 const font=await pdf.embedFont(await fontData(),{subset:true}),supported=new Set(font.getCharacterSet())
 const safe=(value:unknown)=>Array.from(String(value??'Not specified').replace(/\r\n?/g,'\n')).map(c=>c==='\n'||supported.has(c.codePointAt(0)!)?c:`[U+${c.codePointAt(0)!.toString(16).toUpperCase()}]`).join('')
 pdf.setCreationDate(new Date(createdAt));pdf.setModificationDate(new Date(createdAt));pdf.setTitle(`${title} - ${claim.submission.reference}`);pdf.setCreator('L&K Group company booking v1');pdf.setProducer('L&K Group')
 const margin=46,width=595.28,height=841.89,contentWidth=width-margin*2,ink=rgb(.09,.15,.12),muted=rgb(.32,.37,.34)
 let page:PDFPage,y=0
 const addPage=()=>{page=pdf.addPage([width,height]);y=height-50;page.drawText('L&K GROUP / COMPANY PRICE AND WORK SCHEDULE',{x:margin,y,font,size:9,color:muted});y-=28}
 const need=(space:number)=>{if(y-space<65)addPage()}
 const line=(value:string,size:number)=>{need(size+6);page.drawText(value,{x:margin,y,font,size,color:ink});y-=size+6}
 const paragraph=(value:unknown,size=10)=>{for(const part of safe(value).split('\n')){let text='';for(const c of part){if(text&&font.widthOfTextAtSize(text+c,size)>contentWidth){const space=text.lastIndexOf(' ');if(space>text.length/2){line(text.slice(0,space),size);text=text.slice(space+1)}else{line(text,size);text=''}}text+=c}line(text||' ',size)}}
 const field=(label:string,value:unknown)=>{need(38);paragraph(label.toUpperCase(),8);paragraph(value);y-=5}
 addPage();paragraph(title,20);y-=12
 const notice=claim.kind==='confirmation'?'Company booking and work periods are confirmed. Contractual terms and work authorisation remain separate. No payment is requested by this receipt.':claim.kind==='proposal_notice'?'Company proposal for customer review. Work periods are not held until company confirmation.':'Customer acknowledgment received. Company confirmation is still required; work periods are not yet held.'
 paragraph(notice,11);y-=12
 field('Request reference',claim.submission.reference);field('Company proposal version',`${p.version} / ${p.id}`);field('Recorded at (Sydney)',dateTime(createdAt))
 field('Customer',revised?p.contact!.name:claim.submission.snapshot.payload.contact.name);field('Verified recipient',claim.submission.snapshot.verifiedEmail)
 const noGst=revised||simple&&!quotePricingDisplay(claim.submission.snapshot.pricing.pricingVersion).includesGst
 if(noGst){field(revised?'Accepted revised quote total (AUD)':'Photo-based provisional estimate total (AUD)',money(p.total));field('GST',NO_GST_NOTICE)}
 else field(simple?'Photo-based provisional supply price / GST / total':'Final company supply price / GST / total',`${money(p.amountExGst)} / ${money(p.gst)} / ${money(p.total)} incl GST`)
 field('Original photo estimate total',money(claim.submission.snapshot.pricing.total!));field('Company work scope',p.scope);field('Company adjustment / site review reason',p.adjustmentReason)
 field('All company work periods',companyWorkPeriodsText(claim));paragraph('Dates between separate periods are not automatically reserved. Work periods shown above are the company-entered schedule, not an automatically calculated working-hours policy.',9);y-=8
 if(simple)field('Company booking and site inspection notice',p.companyNote)
 field('Proposal SHA-256',p.hash);field('Original signed request snapshot SHA-256',claim.submission.snapshotHash)
 if(revised){
  field('Accepted quantities',`${p.quantities!.doorCount} doors / ${p.quantities!.drawerCount} drawers / moderate repair: ${p.quantities!.moderateRepair?'yes':'no'}`)
  for(const item of p.pricing!.lineItems)field('Accepted work item',`${item.label}: ${item.quantity} x ${money(item.unitAmount)} = ${money(item.amount)}`)
  for(const item of p.extraItems!)field('Additional work reason',`${item.description}: ${item.reason}`)
  field('Customer revision note',p.customerNote||'None')
  field('Accepted company revision',p.companyRevisionId);field('Revision acceptance',p.companyRevisionAcceptanceId);field('Revision snapshot SHA-256',p.companyRevisionSnapshotHash);field('Revision signed content SHA-256',p.companyRevisionSignedContentHash)
  field('Original signed content SHA-256',claim.submission.signedContentHash);field('Accepted contact/site',`${p.contact!.name} / ${p.contact!.siteAddress}, ${p.contact!.suburb} ${p.contact!.postcode}`)
  paragraph(COMPANY_REVISION_ACK.text);field('Acknowledgment version',COMPANY_REVISION_ACK.version)
  const signature=p.companyRevisionSignature!;field('New signed name / method',`${signature.name} / ${signature.method??'drawn'}`)
  if(signature.strokes.length){need(145);const boxY=y-110;page!.drawRectangle({x:margin,y:boxY,width:contentWidth,height:100,borderWidth:.6,borderColor:muted});for(const stroke of signature.strokes)for(let i=1;i<stroke.length;i++){const a=stroke[i-1],b=stroke[i];page!.drawLine({start:{x:margin+8+a.x*(contentWidth-16),y:boxY+8+(1-a.y)*84},end:{x:margin+8+b.x*(contentWidth-16),y:boxY+8+(1-b.y)*84},thickness:1.3,color:ink})}y=boxY-20}
  paragraph('This confirmation uses the explicitly accepted company revision. The original request signature remains separate evidence.',9)
 }else if(simple){
  paragraph('Original customer booking request',14);y-=6
  paragraph(claim.submission.snapshot.acknowledgment.text);y-=8
  field('Acknowledgment version',claim.submission.snapshot.acknowledgment.version)
  field('Requested take-off (Sydney)',`${claim.submission.preferredDate} ${claim.submission.preferredTime}`)
  field('Request signed at (Sydney)',dateTime(claim.submission.submittedAt))
  field('Originally signed name / method',`${claim.submission.signature.name} / ${claim.submission.signature.method??'drawn'}`)
  field('Original signed content SHA-256',claim.submission.signedContentHash)
  if(claim.submission.signature.strokes.length){need(145);const boxY=y-110;page!.drawRectangle({x:margin,y:boxY,width:contentWidth,height:100,borderWidth:.6,borderColor:muted});for(const stroke of claim.submission.signature.strokes)for(let i=1;i<stroke.length;i++){const a=stroke[i-1],b=stroke[i];page!.drawLine({start:{x:margin+8+a.x*(contentWidth-16),y:boxY+8+(1-a.y)*84},end:{x:margin+8+b.x*(contentWidth-16),y:boxY+8+(1-b.y)*84},thickness:1.3,color:ink})}y=boxY-20}
  paragraph('The customer signed the original booking request and agreed that the company would assign installation. This is a company appointment confirmation; no second customer price or schedule acceptance is recorded.',9)
 }else if(claim.acceptance){
  need(200);paragraph('Customer price and schedule acknowledgment',14);y-=6
  paragraph(COMPANY_BOOKING_ACK_TEXT);y-=8
  field('Acknowledgment version',COMPANY_BOOKING_ACK_VERSION);field('Accepted at (Sydney)',dateTime(claim.acceptance.acceptedAt));field('Signed name / method',`${claim.acceptance.signature.name} / ${claim.acceptance.signature.method??'drawn'}`)
  if(claim.acceptance.signature.strokes.length){need(145);const boxY=y-110;page!.drawRectangle({x:margin,y:boxY,width:contentWidth,height:100,borderWidth:.6,borderColor:muted});for(const stroke of claim.acceptance.signature.strokes)for(let i=1;i<stroke.length;i++){const a=stroke[i-1],b=stroke[i];page!.drawLine({start:{x:margin+8+a.x*(contentWidth-16),y:boxY+8+(1-a.y)*84},end:{x:margin+8+b.x*(contentWidth-16),y:boxY+8+(1-b.y)*84},thickness:1.3,color:ink})}y=boxY-20}
 }
 if(claim.booking?.status==='confirmed'){field('Confirmed booking',`${claim.booking.id} / version ${claim.booking.version}`);field('Confirmed at (Sydney)',dateTime(claim.booking.confirmedAt!));field('Calendar evidence',`${claim.booking.events.length} independently verified private busy work periods. Provider event IDs and private access URLs are retained in the EMS.`)}
 paragraph(revised?'This document confirms the take-off and installation appointments using the accepted revised quote. It is not an invoice, work authorisation or payment request. Original submission evidence remains unchanged.':simple?'This document confirms the take-off and installation appointments and records the original photo-based provisional estimate. More extensive damage can increase the price after an on-site inspection; additional work and cost will be discussed before proceeding. It does not issue an invoice, request payment or replace separately approved contractual terms. Photo files and private access URLs are not attached.':'This document records the company proposal and schedule acknowledgment. It does not issue an invoice, request payment or replace separately approved contractual terms. Photo files and private access URLs are not attached.',9)
 paragraph('Unsupported font characters appear as [U+code point]. Original saved data remains unchanged.',8)
 pdf.getPages().forEach((page,i)=>page.drawText(`${claim.submission.reference} | COMPANY SCHEDULE | ${i+1} / ${pdf.getPageCount()}`,{x:margin,y:31,font,size:8,color:muted}))
 const bytes=await pdf.save({useObjectStreams:false}),pdfBase64=Buffer.from(bytes).toString('base64'),pdfHash=createHash('sha256').update(bytes).digest('hex')
 const text=revised?`L&K Group - ${title}\n\nReference: ${claim.submission.reference}\nAccepted revised quote: ${money(p.total)}. ${NO_GST_NOTICE}\nRevision: ${p.companyRevisionId}\nAcceptance: ${p.companyRevisionAcceptanceId}\nAccepted quantities: ${p.quantities!.doorCount} doors / ${p.quantities!.drawerCount} drawers; moderate repair: ${p.quantities!.moderateRepair?'yes':'no'}\nAccepted items:\n${p.pricing!.lineItems.map(item=>`${item.label}: ${money(item.amount)}`).join('\n')}\n\nYour confirmed appointments:\n${companyWorkPeriodsText(claim)}\n\n${notice}\n\n${COMPANY_REVISION_ACK.text}\n\nYour new revision signature and original request evidence remain separately saved. The booking confirmation PDF is attached. Reply to this email if you need assistance.`:simple?`L&K Group - ${title}\n\nReference: ${claim.submission.reference}\nPhoto-based provisional estimate: ${noGst ? `${money(p.total)}. ${NO_GST_NOTICE}` : `${money(p.total)} incl GST (${money(p.amountExGst)} + GST ${money(p.gst)})`}\n\nYour confirmed appointments:\n${companyWorkPeriodsText(claim)}\n\nCompany notice:\n${p.companyNote}\n\n${notice}\n\nNo further online approval is needed. Your original request signature remains saved. Final quantities, repairs and price require on-site inspection; additional work and cost will be discussed before proceeding.\n\nView your saved booking at https://www.lnkgroupsydney.com.au/quote/start?service=cabinet-painting if needed. The booking confirmation PDF is attached. Reply to this email if you need assistance.`:`L&K Group - ${title}\n\nReference: ${claim.submission.reference}\nProposal version: ${p.version}\nFinal company amount: ${money(p.total)} incl GST (${money(p.amountExGst)} + GST ${money(p.gst)})\n\nWork periods:\n${companyWorkPeriodsText(claim)}\n\n${notice}\n\nOpen your saved quote at https://www.lnkgroupsydney.com.au/quote/start?service=cabinet-painting and verify your email to review the saved proposal.\n\nThe private company proposal/acknowledgment PDF is attached. Reply to this email if you need assistance.`
 const payload={from:company.from,reply_to:company.replyTo!,to:[claim.submission.snapshot.verifiedEmail],subject:`L&K Group ${title.toLowerCase()} - ${claim.submission.reference}`,text,html:`<!doctype html><html lang="en"><head><title>${escape(title)}</title></head><body><h1>L&amp;K Group ${escape(title)}</h1>${text.split('\n\n').map(part=>`<p>${escape(part).replace(/\n/g,'<br>')}</p>`).join('')}<p><a href="https://www.lnkgroupsydney.com.au/quote/start?service=cabinet-painting">Open saved quote</a></p></body></html>`,attachments:[{filename:`${claim.submission.reference}-company-${claim.kind}-v${p.version}.pdf`,content:pdfBase64}]}
 const frozen={pdfBase64,pdfHash,payload};if(!validCompanyBookingMail(frozen,claim))throw new Error('Company receipt is too large or invalid');return frozen
}
export function validCompanyBookingMail(value:unknown,claim:LiveCompanyWorkerClaim):value is FrozenCompanyMail {
 if(!value||typeof value!=='object'||Array.isArray(value))return false
 const row=value as Partial<FrozenCompanyMail>,p=row.payload
 if(typeof row.pdfBase64!=='string'||!row.pdfBase64||!/^[A-Za-z0-9+/]+={0,2}$/.test(row.pdfBase64)||!HASH.test(String(row.pdfHash))||!p||typeof p!=='object'||Array.isArray(p))return false
 const bytes=Buffer.from(row.pdfBase64,'base64')
 if(bytes.toString('base64')!==row.pdfBase64||bytes.length>750000||bytes.subarray(0,5).toString()!=='%PDF-'||createHash('sha256').update(bytes).digest('hex')!==row.pdfHash)return false
 try{staffMailSender({companyFrom:String(p.from),companyReplyTo:String(p.reply_to)})}catch{return false}
 if(Object.keys(p).length!==7||!['from','reply_to','to','subject','text','html','attachments'].every(key=>Object.hasOwn(p,key))||!Array.isArray(p.to)||p.to.length!==1||p.to[0]!==claim.submission.snapshot.verifiedEmail||p.subject!==`L&K Group ${titles[claim.kind].toLowerCase()} - ${claim.submission.reference}`||typeof p.text!=='string'||typeof p.html!=='string'||p.text.length>30000||p.html.length>40000||!Array.isArray(p.attachments)||p.attachments.length!==1)return false
 const a=p.attachments[0] as Record<string,unknown>
 return !!a&&Object.keys(a).length===2&&a.filename===`${claim.submission.reference}-company-${claim.kind}-v${claim.proposal.version}.pdf`&&a.content===row.pdfBase64&&Buffer.byteLength(JSON.stringify(p),'utf8')<=1000000
}
