import { customerLiveCompanyDocumentGet } from '@/modules/bookings/server'
export const runtime = 'nodejs'
export async function GET(request: Request, context: { params: Promise<{ kind: string }> }) { return customerLiveCompanyDocumentGet(request, undefined, (await context.params).kind) }
