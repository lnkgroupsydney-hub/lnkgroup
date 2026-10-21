import { simpleBookingManagementApi } from '../../../../../../../modules/bookings/simple-management-server'
export const runtime = 'nodejs'
export const maxDuration = 300
export async function GET(req: Request, context: { params: Promise<{ requestId: string; key: string }> }) { const params = await context.params; return simpleBookingManagementApi.receipt(req, params.requestId, params.key) }
