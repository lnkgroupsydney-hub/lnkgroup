import { WorkError, workExact, workField, workId, workMutation, workObject, workText, type WorkMutation } from '../../enquiries/management.ts'
import { validateStaffQuotePayload, type StaffQuoteDraftPayload } from './staff-draft.ts'
import { QUOTE_PRICING_VERSION, type EstimateLineItem } from './pricing.ts'
import { validateBookingSignature, type LiveBookingSignature } from './booking-flow.ts'

export const COMPANY_REVISION_ACK_VERSION = 'company-quote-revision-ack-v1'
export const COMPANY_REVISION_ACK = { version: COMPANY_REVISION_ACK_VERSION, text: 'I accept this revised quote for my booking request and confirm the changes shown here. This is not a contract, work authorisation or payment obligation. Final contractual terms require separate acceptance.' } as const
// Technical typo guards only; these are not business prices or approved extra-item rates.
export const MAX_EXTRA_ITEM_CENTS_TECHNICAL = 10000000
export const MAX_EXTRA_ITEMS_TECHNICAL = 30
export type CompanyRevisionQuantities = { doorCount: number; drawerCount: number; moderateRepair: boolean }
export type CompanyRevisionExtra = { id: string; description: string; amountCents: number; reason: string }
export type CompanyRevisionPayload = { contact: StaffQuoteDraftPayload['contact']; quantities: CompanyRevisionQuantities; extraItems: CompanyRevisionExtra[]; customerNote: string }
export type CompanyRevisionPricing = { pricingVersion: typeof QUOTE_PRICING_VERSION; currency: 'AUD'; amountUnit: 'cents'; minimumSubtotal: 145000; gstRateBps: 0; lineItems: EstimateLineItem[]; subtotal: number; tax: 0; total: number }
export type CompanyRevisionComparison = { original: { quantities: CompanyRevisionQuantities; lineItems: EstimateLineItem[]; subtotalCents: number; taxCents: number; totalCents: number; pricingVersion: string | null }; company: { quantities: CompanyRevisionQuantities; lineItems: EstimateLineItem[]; totalCents: number }; deltaCents: number; changes: { field: string; before: unknown; after: unknown }[] }
export type CompanyRevision = { id: string; requestId: string; versionNo: number; revision: number; status: 'draft'|'published'|'accepted'|'superseded'|'withdrawn'; payload: CompanyRevisionPayload; pricing: CompanyRevisionPricing; totalCents: number; comparison: CompanyRevisionComparison; snapshot: Record<string,unknown>|null; snapshotHash: string|null; baseSubmissionId: string; baseSnapshotHash: string; baseSignedContentHash: string; basedOnRevisionId: string|null; publishedAt: string|null; acceptedAt: string|null; withdrawnAt: string|null; acceptance: Record<string,unknown>|null; emailStatus: string|null; receiptReady: boolean }
export type CompanyRevisionState = { requestId: string; revision: number; current: CompanyRevision|null; effectiveAccepted: CompanyRevision|null; acknowledgment: typeof COMPANY_REVISION_ACK; eligible?: boolean; eligibilityCode?: string|null; initialPayload?: CompanyRevisionPayload; sourceIssues?: {field:string;code:string;message:string}[]; revisions?: CompanyRevision[]; audit?: unknown[]; canWrite?: boolean }
export type CompanyRevisionReceipt = { idempotencyKey:string; entityType:'company_revision'; entityId:string; action:string; revision:number; committedAt:string; childId?:string }
export type CompanyRevisionResult = { detail: CompanyRevisionState; receipt: CompanyRevisionReceipt }
export type CustomerCompanyRevisionResult = { state: CompanyRevisionState; receipt: CompanyRevisionReceipt }
export type CompanyRevisionSaveInput = WorkMutation & { payload: CompanyRevisionPayload }
export type CompanyRevisionMutationInput = WorkMutation & { revisionId: string }
export type CompanyRevisionAcceptInput = { revisionId:string;expectedRevision:number;reviewProof:string;acknowledgmentVersion:typeof COMPANY_REVISION_ACK_VERSION;acknowledged:true;signature:LiveBookingSignature;idempotencyKey:string }
export function companyRevisionHash(value:unknown):string { if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw new WorkError(422,'validation','A valid snapshot hash is required.');return value }
function plain(value:unknown,max:number,required=true,singleLine=false){const text=workText(value,max,required);if(singleLine&&/[\u0000-\u001f\u007f]/.test(text))throw new WorkError(422,'validation','Enter single-line plain text.');if(/<(!--|\/?[a-z][^>]*(>|$))/i.test(text))throw new WorkError(422,'validation','Enter plain text without HTML.');return text}
export function validateCompanyRevisionPayload(value:unknown,source?:unknown):CompanyRevisionPayload {
 const raw=workObject(value);workExact(raw,['contact','quantities','extraItems','customerNote'])
 const contact=validateStaffQuotePayload({contact:raw.contact,service:null,internalNotes:''},source===undefined?undefined:{...workObject(source),service:null}).contact
 const quantities=workObject(raw.quantities);workExact(quantities,['doorCount','drawerCount','moderateRepair'])
 for(const field of ['doorCount','drawerCount'])workField(`payload.quantities.${field}`,()=>{if(!Number.isSafeInteger(quantities[field])||Number(quantities[field])<0||Number(quantities[field])>500)throw new WorkError(422,'validation','Enter a whole-number quantity from 0 to 500.')})
 if(Number(quantities.doorCount)+Number(quantities.drawerCount)===0)throw new WorkError(422,'validation','At least one cabinet front is required.','not_applied',undefined,{'payload.quantities.doorCount':'At least one cabinet front is required.'})
 if(typeof quantities.moderateRepair!=='boolean')throw new WorkError(422,'validation','Choose whether moderate repair is included.','not_applied',undefined,{'payload.quantities.moderateRepair':'Choose whether moderate repair is included.'})
 if(!Array.isArray(raw.extraItems)||raw.extraItems.length>MAX_EXTRA_ITEMS_TECHNICAL)throw new WorkError(422,'validation','Enter at most 30 extra items.','not_applied',undefined,{'payload.extraItems':'Enter at most 30 extra items.'})
 const ids=new Set<string>();const extraItems=raw.extraItems.map((value,index)=>workField(`payload.extraItems.${index}`,()=>{const item=workObject(value);workExact(item,['id','description','amountCents','reason']);const id=workId(item.id);if(ids.has(id))throw new WorkError(422,'validation','Extra item identifiers must be unique.');ids.add(id);if(!Number.isSafeInteger(item.amountCents)||Number(item.amountCents)<1||Number(item.amountCents)>MAX_EXTRA_ITEM_CENTS_TECHNICAL)throw new WorkError(422,'validation','Enter a positive whole-number extra amount within the technical input limit.');return {id,description:workField(`payload.extraItems.${index}.description`,()=>plain(item.description,500,true,true)),amountCents:Number(item.amountCents),reason:workField(`payload.extraItems.${index}.reason`,()=>plain(item.reason,500,true,true))}}))
 return {contact,quantities:quantities as CompanyRevisionQuantities,extraItems,customerNote:workField('payload.customerNote',()=>plain(raw.customerNote,3000,false))}
}
export function calculateCompanyRevisionPricing(payload:CompanyRevisionPayload):CompanyRevisionPricing {
 const lineItems:EstimateLineItem[]=[];const add=(code:string,label:string,quantity:number,unitAmount:number)=>{if(quantity&&unitAmount)lineItems.push({code,label,quantity,unitAmount,amount:quantity*unitAmount})};const q=payload.quantities
 add('doors','Cabinet door preparation and painting',q.doorCount,15000);add('drawers','Drawer front preparation and painting',q.drawerCount,10000);add('minimum_adjustment','Minimum painting charge adjustment',1,Math.max(0,145000-q.doorCount*15000-q.drawerCount*10000));if(q.moderateRepair)add('moderate_repairs','Moderate coating repairs (once per project)',1,25000);for(const extra of payload.extraItems)add(`extra:${extra.id}`,extra.description,1,extra.amountCents)
 const total=lineItems.reduce((sum,item)=>sum+item.amount,0);return {pricingVersion:QUOTE_PRICING_VERSION,currency:'AUD',amountUnit:'cents',minimumSubtotal:145000,gstRateBps:0,lineItems,subtotal:total,tax:0,total}
}
/** Reads monetary evidence as signed, without deriving a tax rate or inventing a missing basis. */
export function readCompanyRevisionOriginalPricing(value: unknown): Omit<CompanyRevisionComparison['original'], 'quantities'> {
 const p=workObject(value),invalid=()=>{throw new WorkError(422,'validation','Original signed quote pricing is inconsistent or incomplete.')}
 const cents=(value:unknown):number|undefined=>{if(value===undefined||value===null)return undefined;if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)return invalid();return value}
 const total=cents(p.total),storedSubtotal=cents(p.subtotal),storedTax=cents(p.tax),gst=cents(p.gst)
 if(total===undefined||storedTax!==undefined&&gst!==undefined&&storedTax!==gst)return invalid()
 const explicitTax=storedTax??gst
 if(storedSubtotal===undefined&&explicitTax===undefined)return invalid()
 const subtotal=storedSubtotal??total-explicitTax!,tax=explicitTax??total-subtotal
 if(!Number.isSafeInteger(subtotal)||subtotal<0||!Number.isSafeInteger(tax)||tax<0||subtotal+tax!==total)return invalid()
 if(p.pricingVersion!==undefined&&p.pricingVersion!==null&&typeof p.pricingVersion!=='string')return invalid()
 if(p.lineItems!==undefined&&p.lineItems!==null&&!Array.isArray(p.lineItems))return invalid()
 return {lineItems:(p.lineItems??[]) as EstimateLineItem[],subtotalCents:subtotal,taxCents:tax,totalCents:total,pricingVersion:p.pricingVersion as string|null|undefined??null}
}
export function validateCompanyRevisionComparison(value: unknown, companyTotal: number): CompanyRevisionComparison {
 const c=workObject(value),original=workObject(c.original),company=workObject(c.company)
 const quantities=workObject(original.quantities)
 if(!Number.isSafeInteger(quantities.doorCount)||Number(quantities.doorCount)<0||!Number.isSafeInteger(quantities.drawerCount)||Number(quantities.drawerCount)<0||typeof quantities.moderateRepair!=='boolean')throw new WorkError(422,'validation','Invalid original signed quantities.')
 readCompanyRevisionOriginalPricing({lineItems:original.lineItems,subtotal:original.subtotalCents,tax:original.taxCents,total:original.totalCents,pricingVersion:original.pricingVersion})
 if(!Number.isSafeInteger(original.subtotalCents)||!Number.isSafeInteger(original.taxCents)||original.pricingVersion!==null&&typeof original.pricingVersion!=='string'||!Array.isArray(original.lineItems)||company.totalCents!==companyTotal||c.deltaCents!==companyTotal-Number(original.totalCents)||!Array.isArray(c.changes))throw new WorkError(422,'validation','Invalid company revision comparison.')
 for(const value of original.lineItems as unknown[]){const item=workObject(value);if(typeof item.code!=='string'||typeof item.label!=='string'||!['quantity','unitAmount','amount'].every(key=>Number.isSafeInteger(item[key])&&Number(item[key])>=0))throw new WorkError(422,'validation','Invalid original signed line item.')}
 return c as CompanyRevisionComparison
}
export function compareCompanyRevision(snapshot:Record<string,unknown>,payload:CompanyRevisionPayload):CompanyRevisionComparison {
 const originalPricing=readCompanyRevisionOriginalPricing(snapshot.pricing),originalPayload=workObject(snapshot.payload),items=originalPricing.lineItems,service=workObject(originalPayload.service),contact=workObject(originalPayload.contact)
 const quantities={doorCount:items.find(i=>i.code==='doors')?.quantity??Number(service.doorCount??0),drawerCount:items.find(i=>i.code==='drawers')?.quantity??Number(service.drawerCount??0),moderateRepair:items.some(i=>i.code==='moderate_repairs')},pricing=calculateCompanyRevisionPricing(payload),changes:CompanyRevisionComparison['changes']=[]
 for(const key of ['doorCount','drawerCount','moderateRepair'] as const)if(quantities[key]!==payload.quantities[key])changes.push({field:`quantities.${key}`,before:quantities[key],after:payload.quantities[key]})
 for(const key of ['name','email','phone','siteAddress','suburb','postcode','details'] as const)if(contact[key]!==payload.contact[key])changes.push({field:`contact.${key}`,before:contact[key],after:payload.contact[key]})
 if(payload.extraItems.length)changes.push({field:'extraItems',before:[],after:payload.extraItems});if(payload.customerNote)changes.push({field:'customerNote',before:'',after:payload.customerNote})
 return {original:{quantities,...originalPricing},company:{quantities:payload.quantities,lineItems:pricing.lineItems,totalCents:pricing.total},deltaCents:pricing.total-originalPricing.totalCents,changes}
}
export function companyRevisionSaveInput(raw:Record<string,unknown>,source?:unknown):CompanyRevisionSaveInput{workExact(raw,['expectedRevision','idempotencyKey','reason','payload']);return {...workMutation(raw),payload:validateCompanyRevisionPayload(raw.payload,source)}}
export function companyRevisionMutationInput(raw:Record<string,unknown>):CompanyRevisionMutationInput{workExact(raw,['revisionId','expectedRevision','idempotencyKey','reason']);return {...workMutation(raw),revisionId:workField('revisionId',()=>workId(raw.revisionId))}}
export function companyRevisionAcceptInput(raw:Record<string,unknown>):CompanyRevisionAcceptInput{workExact(raw,['revisionId','expectedRevision','reviewProof','acknowledgmentVersion','acknowledged','signature','idempotencyKey']);const mutation=workMutation({...raw,reason:'Customer explicitly accepted the revised quote.'});if(raw.acknowledgmentVersion!==COMPANY_REVISION_ACK_VERSION||raw.acknowledged!==true)throw new WorkError(422,'acknowledgment_required','Read and explicitly accept the revised quote acknowledgment.');if(typeof raw.reviewProof!=='string'||raw.reviewProof.length>3000)throw new WorkError(422,'review_required','Review the current revised quote before accepting.');return {revisionId:workId(raw.revisionId),expectedRevision:mutation.expectedRevision,reviewProof:raw.reviewProof,acknowledgmentVersion:COMPANY_REVISION_ACK_VERSION,acknowledged:true,signature:validateBookingSignature(raw.signature),idempotencyKey:mutation.idempotencyKey}}
