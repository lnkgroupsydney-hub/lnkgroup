import { workApiBoundary, workApiDefaults, type WorkApiDependencies } from '../../enquiries/management-server.ts'
import { currentWorkCommand, workObject, workId, workExact, workMutation, workField, workText } from '../../enquiries/management.ts'
import { staffQuoteSourceIssues, type StaffQuoteDraftDetail } from '../domain/staff-draft.ts'
import { staffQuoteSaveInput } from '../application/staff-drafts.ts'
export function createStaffQuoteDraftApi(deps: WorkApiDependencies) { const run = workApiBoundary(deps); return {
 list: (req: Request) => run(req, 'quote_list'),
 detail: (req: Request, id: string) => run(req, 'quote_detail', { id }, undefined, 200, result => { const detail = result as StaffQuoteDraftDetail; return { ...detail, sourceIssues: staffQuoteSourceIssues(detail.source.payload) } }),
 save: (req: Request, id: string) => run(req, 'quote_save', { id }, async (raw, actor) => {
   // Validate structure first, then read the trusted source after authorization.
   workId(id); workExact(raw, ['expectedRevision','idempotencyKey','reason','payload']); workMutation(raw);
   const payload = workObject(raw.payload); workField('payload.internalNotes', () => workText(payload.internalNotes, 3000, false));
   const detail = await currentWorkCommand<StaffQuoteDraftDetail>(deps.store, actor, 'quote_detail', { id });
   return staffQuoteSaveInput(raw, detail.source.payload);
 }),
 receipt: (req: Request, id: string, key: string) => run(req, 'quote_receipt', { id, key }),
} }
export const staffQuoteDraftApi = createStaffQuoteDraftApi(workApiDefaults)
