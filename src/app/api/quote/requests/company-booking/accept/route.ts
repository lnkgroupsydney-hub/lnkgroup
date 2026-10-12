import { customerLiveCompanyAcceptPost } from '@/modules/bookings/server'
export const runtime = 'nodejs'
export const maxDuration = 300
export async function POST(request: Request) { return customerLiveCompanyAcceptPost(request) }
