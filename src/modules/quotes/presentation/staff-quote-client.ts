import { parseLiveRequest } from './request-client.ts'
import type { StaffQuoteDraftListPage } from '../domain/staff-draft.ts'
import { CurrentWorkClient } from '../../enquiries/management-client.ts'
import { workId, workObject, type WorkMutation } from '../../enquiries/management.ts'
import { validateStaffQuotePayload, type StaffQuoteDraftDetail, type StaffQuoteDraftPayload } from '../domain/staff-draft.ts'
export function parseStaffQuoteDraft(value:unknown):StaffQuoteDraftDetail { const raw=workObject(value),source=workObject(raw.source);workId(raw.requestId);if(source.id!==raw.requestId||!Number.isSafeInteger(source.revision)||!['draft','review_requested'].includes(String(source.status))||!Array.isArray(raw.audit)||typeof raw.canWrite!=='boolean')throw new Error('Invalid staff quote work copy.');if(raw.draft!==null){const draft=workObject(raw.draft);if(draft.requestId!==raw.requestId||draft.status!=='draft'||!Number.isSafeInteger(draft.revision)||Number(draft.revision)<1)throw new Error('Invalid staff draft revision.');validateStaffQuotePayload(draft.payload)}return raw as StaffQuoteDraftDetail }
export function staffQuoteActions(client:CurrentWorkClient<StaffQuoteDraftDetail>,requestId:string) { const base=`/api/admin/quote-requests/${workId(requestId)}/staff-draft`;return {
 detail:()=>client.read(base),save:(input:Omit<WorkMutation,'idempotencyKey'>&{payload:StaffQuoteDraftPayload})=>client.mutate(base,'PUT',input),
 check:()=>{const pending=client.pendingRequest();if(!pending)throw new Error('No pending request.');return client.check(`${base}/commands/${workId(pending.body.idempotencyKey)}`)},retry:()=>client.retry(),
} }
export { CurrentWorkClient }

export function parseStaffQuoteList(value: unknown): StaffQuoteDraftListPage { const raw=workObject(value);if(!Array.isArray(raw.requests)||!Number.isSafeInteger(raw.total)||Number(raw.total)<0||!Number.isSafeInteger(raw.page)||Number(raw.page)<1||!Number.isSafeInteger(raw.pageSize)||Number(raw.pageSize)<1)throw new Error('Invalid quote list.');return {...raw,requests:raw.requests.map(value=>{const row=workObject(value);if(row.staffDraftRevision!==null&&(!Number.isSafeInteger(row.staffDraftRevision)||Number(row.staffDraftRevision)<1))throw new Error('Invalid staff draft list revision.');return {...parseLiveRequest(row),staffDraftRevision:row.staffDraftRevision as number|null}})} as StaffQuoteDraftListPage }
