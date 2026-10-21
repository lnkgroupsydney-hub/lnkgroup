import { simpleBookingManagementApi } from '../../../../../../modules/bookings/simple-management-server'
export const runtime = 'nodejs'
export const maxDuration = 300
export async function GET(req: Request, context: { params: Promise<{ requestId: string }> }) { const params = await context.params; return simpleBookingManagementApi.detail(req, params.requestId) }
export async function PUT(req: Request, context: { params: Promise<{ requestId: string }> }) { const params = await context.params; return simpleBookingManagementApi.save(req, params.requestId) }
