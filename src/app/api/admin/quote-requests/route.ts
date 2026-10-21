import { staffQuoteDraftApi } from '../../../../modules/quotes/staff-drafts-server'
export const runtime = 'nodejs'
export async function GET(req: Request) { return staffQuoteDraftApi.list(req) }
