import { liveBookingAvailabilityGet } from '@/modules/quotes/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return liveBookingAvailabilityGet(request); }
