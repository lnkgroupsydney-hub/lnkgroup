import { adminLiveBookingGet } from '@/modules/quotes/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return adminLiveBookingGet(request, (await context.params).id); }
