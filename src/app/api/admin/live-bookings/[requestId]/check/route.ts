import { adminLiveCompanyCheckPost } from '@/modules/bookings/server'
export const runtime = 'nodejs'
export const maxDuration = 300
export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) { return adminLiveCompanyCheckPost(request, (await context.params).requestId) }
