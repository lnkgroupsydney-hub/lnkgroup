import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, writeFile, symlink } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { companyClaim, companyTestNow, companyTestSender } from '../src/modules/bookings/live-test-data.mts'
import type { LiveCompanyWorkerClaim } from '../src/modules/bookings/domain/live-contracts.ts'
import { COMPANY_BOOKING_SITE_DAMAGE_NOTE } from '../src/modules/bookings/domain/live-contracts.ts'
import { BOOKING_SIMPLE_ACK_VERSION, bookingAcknowledgment } from '../src/modules/quotes/domain/booking-flow.ts'
import { QUOTE_PRICING_VERSION, PREVIOUS_QUOTE_PRICING_VERSION } from '../src/modules/quotes/domain/pricing.ts'
import { createFrozenBookingReceipt, validFrozenBookingReceipt } from '../src/modules/quotes/infrastructure/booking-receipt.ts'
import { createCompanyBookingMail, validCompanyBookingMail } from '../src/modules/bookings/infrastructure/live-receipt.ts'

// Synthetic fixed sources only: never fetch, send mail, or modify saved business records.
const output=resolve('docs/verification/2026-10-14-no-gst-pricing/pdf')
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
function deterministic<T>(value:T):T {
 const ids=new Map<string,string>()
 return JSON.parse(JSON.stringify(value).replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g,id=>{
  if(!ids.has(id))ids.set(id,`00000000-0000-4000-8000-${String(ids.size+1).padStart(12,'0')}`)
  return ids.get(id)!
 })) as T
}
function source(noGst:boolean):LiveCompanyWorkerClaim {
 const c=deterministic(companyClaim('confirmation')),p=c.submission.snapshot.pricing
 c.acceptance=null;c.submission.preferredTime='09:00';c.submission.snapshot.preferredTime='09:00'
 c.submission.snapshot.version=BOOKING_SIMPLE_ACK_VERSION;c.submission.snapshot.acknowledgment=bookingAcknowledgment()
 c.submission.calendarStatus='not_required';c.submission.calendarEventId=null
 p.pricingVersion=noGst?QUOTE_PRICING_VERSION:PREVIOUS_QUOTE_PRICING_VERSION
 p.minimumSubtotal=noGst?145000:150000;p.gstRateBps=noGst?0:1000
 p.lineItems=[{code:'doors',label:'Estimated cabinet door preparation and painting',quantity:noGst?8:10,unitAmount:15000,amount:noGst?120000:150000},...(noGst?[{code:'minimum_adjustment',label:'Minimum painting charge adjustment',quantity:1,unitAmount:25000,amount:25000}]:[])]
 p.basis={type:'ai_estimated_quantities',extent:'whole_project',anchorPhotoId:c.submission.snapshot.photos[0].id,doors:noGst?8:10,drawers:0}
 p.subtotal=noGst?145000:150000;p.tax=noGst?0:15000;p.total=noGst?145000:165000
 p.reviewReasons=['Confirm exact quantities, condition and final scope on site.']
 p.notice=noGst?'Provisional photo-based estimate. No GST charged. The supplier is not registered for GST. Final scope and price require site confirmation.':'Provisional photo-based estimate. Final scope and price require site confirmation.'
 c.proposal.amountExGst=p.subtotal;c.proposal.gst=p.tax;c.proposal.total=p.total
 c.proposal.confirmationBasis='signed_request';c.proposal.companyNote=COMPANY_BOOKING_SITE_DAMAGE_NOTE
 c.proposal.segments=[{purpose:'take_off',kind:'timed',startDate:'2026-10-20',endDate:'2026-10-21',startLocal:'2026-10-20T09:00',endLocal:'2026-10-20T10:00',startAt:'2026-10-19T22:00:00.000Z',endAt:'2026-10-19T23:00:00.000Z'},{purpose:'install',kind:'timed',startDate:'2026-10-26',endDate:'2026-10-27',startLocal:'2026-10-26T09:00',endLocal:'2026-10-26T11:00',startAt:'2026-10-25T22:00:00.000Z',endAt:'2026-10-26T00:00:00.000Z'}]
 c.booking!.confirmationBasis='signed_request';c.booking!.signedSubmissionId=c.submission.id;c.booking!.status='confirmed';c.booking!.confirmedAt=new Date(companyTestNow).toISOString()
 c.booking!.events=c.proposal.segments.map((_,i)=>({segmentIndex:i,eventId:`synthetic-event-${i}`,payloadHash:'d'.repeat(64),etag:'"synthetic-verified"',verifiedAt:new Date(companyTestNow).toISOString()}))
 return c
}
const legacy=source(false),current=source(true)
await mkdir(output,{recursive:true})
const result:{synthetic:true;noNetworkCalls:true;baselineComparison:null|Record<string,boolean>;documents:Record<string,{sha256:string;bytes:number;pages?:number;moneyAndGstTextVerified?:boolean}>}={synthetic:true,noNetworkCalls:true,baselineComparison:null,documents:{}}
const generated=new Map<string,Awaited<ReturnType<typeof createFrozenBookingReceipt>>|Awaited<ReturnType<typeof createCompanyBookingMail>>>()
for(const [label,claim] of [['new',current],['legacy',legacy]] as const) {
 const request=await createFrozenBookingReceipt(structuredClone(claim.submission),companyTestSender)
 const confirmation=await createCompanyBookingMail(structuredClone(claim),companyTestSender)
 assert.ok(validFrozenBookingReceipt(request,claim.submission));assert.ok(validCompanyBookingMail(confirmation,claim))
 assert.deepEqual(await createFrozenBookingReceipt(structuredClone(claim.submission),companyTestSender),request)
 assert.deepEqual(await createCompanyBookingMail(structuredClone(claim),companyTestSender),confirmation)
 for(const [kind,mail] of [['request',request],['confirmation',confirmation]] as const) {
  const key=`${label}-${kind}`,bytes=Buffer.from(mail.pdfBase64,'base64')
  assert.equal(digest(bytes),mail.pdfHash);assert.equal(bytes.includes(Buffer.from('PRIVATE-OBJECT-PATH')),false)
  const text=String(mail.payload.text),html=String(mail.payload.html)
  if(label==='new'){assert.match(text,/AUD 1450\.00/);assert.match(text,/No GST charged\. The supplier is not registered for GST\./);assert.doesNotMatch(text,/incl GST|excluding GST|\+ GST/);assert.match(html,/No GST charged/)}
  else {if(kind==='confirmation'){assert.match(text,/AUD 1650\.00/);assert.match(text,/incl GST/)}assert.doesNotMatch(text,/No GST charged/)}
  await writeFile(join(output,`${key}.pdf`),bytes)
  await writeFile(join(output,`${key}-mail.json`),JSON.stringify(mail.payload,null,2)+'\n')
  generated.set(key,mail);result.documents[key]={sha256:mail.pdfHash,bytes:bytes.length}
 }
}
if(process.env.BASELINE_DIR) {
 const baseline=resolve(process.env.BASELINE_DIR)
 for(const [target,path] of [[resolve('node_modules'),join(baseline,'node_modules')],[resolve('src/shared'),join(baseline,'src/shared')],[resolve('src/modules/operations'),join(baseline,'src/modules/operations')]] as const)if(!existsSync(path))await symlink(target,path,'dir')
 const oldRequest=await import(pathToFileURL(join(baseline,'src/modules/quotes/infrastructure/booking-receipt.ts')).href)
 const oldConfirmation=await import(pathToFileURL(join(baseline,'src/modules/bookings/infrastructure/live-receipt.ts')).href)
 const request=await oldRequest.createFrozenBookingReceipt(structuredClone(legacy.submission),companyTestSender)
 const confirmation=await oldConfirmation.createCompanyBookingMail(structuredClone(legacy),companyTestSender)
 assert.deepEqual(request,generated.get('legacy-request'))
 assert.deepEqual(confirmation,generated.get('legacy-confirmation'))
 result.baselineComparison={legacyRequestPdfBytes:true,legacyRequestMailPayload:true,legacyConfirmationPdfBytes:true,legacyConfirmationMailPayload:true}
}
const python=process.env.PDF_PYTHON??join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3')
const extracted=JSON.parse(execFileSync(python,['-c',"import json,sys\nfrom pypdf import PdfReader\nresult={}\nfor path in sys.argv[1:]:\n r=PdfReader(path);result[path]={'pages':len(r.pages),'text':'\\n'.join(p.extract_text() or '' for p in r.pages)}\nprint(json.dumps(result))",...Array.from(generated.keys(),key=>join(output,`${key}.pdf`))],{encoding:'utf8'})) as Record<string,{pages:number;text:string}>
for(const [key,metadata] of Object.entries(result.documents)) {
 const pdf=extracted[join(output,`${key}.pdf`)]
 assert.ok(pdf.pages>=1)
 if(key.startsWith('new')){assert.match(pdf.text,/AUD 1450\.00/);assert.match(pdf.text,/No GST charged\. The supplier is not registered for GST\./);assert.doesNotMatch(pdf.text,/incl GST|excluding GST|\+ GST/)}
 else {assert.match(pdf.text,/AUD 1650\.00/);assert.match(pdf.text,/GST/);assert.doesNotMatch(pdf.text,/No GST charged/)}
 metadata.pages=pdf.pages;metadata.moneyAndGstTextVerified=true
 await writeFile(join(output,`${key}.txt`),pdf.text+'\n')
}
await writeFile(join(output,'result.json'),JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify(result,null,2))
