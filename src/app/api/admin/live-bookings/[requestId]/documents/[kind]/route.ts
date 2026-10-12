import { adminLiveCompanyDocumentGet } from '@/modules/bookings/server'
export const runtime = 'nodejs'
export async function GET(request: Request, context: { params: Promise<{ requestId: string; kind: string }> }) { const params = await context.params; return adminLiveCompanyDocumentGet(request, params.requestId, params.kind) }
