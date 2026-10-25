import { staffQuoteDraftApi } from '../../../../../../../../modules/quotes/staff-drafts-server'
export const runtime = 'nodejs'
export async function GET(req: Request, context: { params: Promise<{ id: string; key: string }> }) { const params = await context.params; return staffQuoteDraftApi.receipt(req, params.id, params.key) }
