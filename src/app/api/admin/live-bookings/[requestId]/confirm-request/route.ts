import { adminLiveCompanyConfirmRequestPost } from '@/modules/bookings/server'
export const runtime = 'nodejs'
export const maxDuration = 300
export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) { return adminLiveCompanyConfirmRequestPost(request, (await context.params).requestId) }
