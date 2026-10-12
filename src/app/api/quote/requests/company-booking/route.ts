import { customerLiveCompanyBookingGet } from '@/modules/bookings/server'
export const runtime = 'nodejs'
export async function GET(request: Request) { return customerLiveCompanyBookingGet(request) }
