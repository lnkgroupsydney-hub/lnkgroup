import { adminLiveCompanyRetryPost } from '@/modules/bookings/server'
export const runtime = 'nodejs'
export const maxDuration = 300
export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) { return adminLiveCompanyRetryPost(request, (await context.params).requestId) }
