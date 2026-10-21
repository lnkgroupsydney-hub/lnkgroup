import { workApiBoundary, workApiDefaults, type WorkApiDependencies } from '../../enquiries/management-server.ts'
import { staffQuoteSaveInput } from '../application/staff-drafts.ts'
export function createStaffQuoteDraftApi(deps: WorkApiDependencies) { const run = workApiBoundary(deps); return {
 list: (req: Request) => run(req, 'quote_list'),
 detail: (req: Request, id: string) => run(req, 'quote_detail', { id }),
 save: (req: Request, id: string) => run(req, 'quote_save', { id }, staffQuoteSaveInput),
 receipt: (req: Request, id: string, key: string) => run(req, 'quote_receipt', { id, key }),
} }
export const staffQuoteDraftApi = createStaffQuoteDraftApi(workApiDefaults)
