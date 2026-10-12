import { liveBookingDatePut } from '@/modules/quotes/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function PUT(request: Request) { return liveBookingDatePut(request); }
