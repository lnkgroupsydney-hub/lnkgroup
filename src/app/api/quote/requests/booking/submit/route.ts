import { liveBookingSubmitPost } from '@/modules/quotes/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export function POST(request: Request) { return liveBookingSubmitPost(request); }
