import { staffQuoteDraftApi } from '../../../../../../modules/quotes/staff-drafts-server'
export const runtime = 'nodejs'
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) { const params = await context.params; return staffQuoteDraftApi.detail(req, params.id) }
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) { const params = await context.params; return staffQuoteDraftApi.save(req, params.id) }
