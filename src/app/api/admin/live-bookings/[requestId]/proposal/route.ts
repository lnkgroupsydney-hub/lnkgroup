import { adminLiveCompanyProposalPut } from '@/modules/bookings/server'
export const runtime = 'nodejs'
export const maxDuration = 300
export async function PUT(request: Request, context: { params: Promise<{ requestId: string }> }) { return adminLiveCompanyProposalPut(request, (await context.params).requestId) }
