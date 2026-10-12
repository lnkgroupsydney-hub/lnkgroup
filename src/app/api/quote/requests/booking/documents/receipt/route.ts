import { liveBookingReceiptGet } from '@/modules/quotes/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return liveBookingReceiptGet(request); }
