import { CurrentWorkClient } from '../../enquiries/management-client.ts'
import { workId, workObject, type WorkMutation } from '../../enquiries/management.ts'
import { COMPANY_REVISION_ACK, calculateCompanyRevisionPricing, validateCompanyRevisionComparison, type CompanyRevisionPayload, type CompanyRevisionState } from '../domain/company-revision.ts'
export function parseCompanyRevisionState(value:unknown):CompanyRevisionState {
 const raw=workObject(value);workId(raw.requestId);if(!Number.isSafeInteger(raw.revision)||Number(raw.revision)<0)throw new Error('Invalid company revision state.')
 const ack=workObject(raw.acknowledgment);if(ack.version!==COMPANY_REVISION_ACK.version||ack.text!==COMPANY_REVISION_ACK.text)throw new Error('Invalid revision acknowledgment.')
 if(raw.revisions!==undefined&&!Array.isArray(raw.revisions))throw new Error('Invalid company revision history.')
 for(const value of [raw.current,raw.effectiveAccepted,...(raw.revisions as unknown[]??[])]){if(value===null)continue;const row=workObject(value);workId(row.id);if(row.requestId!==raw.requestId||!['draft','published','accepted','superseded','withdrawn'].includes(String(row.status))||!Number.isSafeInteger(row.revision)||Number(row.revision)<1||!Number.isSafeInteger(row.versionNo)||Number(row.versionNo)<1)throw new Error('Invalid company revision.');const pricing=calculateCompanyRevisionPricing(row.payload as CompanyRevisionPayload);if(pricing.total!==row.totalCents||workObject(row.pricing).total!==pricing.total||workObject(row.pricing).tax!==0)throw new Error('Invalid company revision amount.');validateCompanyRevisionComparison(row.comparison,pricing.total)}
 return raw as CompanyRevisionState
}
export function companyRevisionActions(client:CurrentWorkClient<CompanyRevisionState>,requestId:string){const base=`/api/admin/quote-requests/${workId(requestId)}/company-revisions`;return {
 detail:()=>client.read(base),history:()=>client.read(`${base}/history`),save:(input:Omit<WorkMutation,'idempotencyKey'>&{payload:CompanyRevisionPayload})=>client.mutate(base,'PUT',input),publish:(input:Omit<WorkMutation,'idempotencyKey'>&{revisionId:string})=>client.mutate(`${base}/publish`,'POST',input),withdraw:(input:Omit<WorkMutation,'idempotencyKey'>&{revisionId:string})=>client.mutate(`${base}/withdraw`,'POST',input),
 check:()=>{const pending=client.pendingRequest();if(!pending)throw new Error('No pending request.');return client.check(`${base}/commands/${workId(pending.body.idempotencyKey)}`)},retry:()=>client.retry(),
}}
export { CurrentWorkClient }
