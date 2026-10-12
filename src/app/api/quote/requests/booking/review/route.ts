import { liveBookingReviewPost } from '@/modules/quotes/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function POST(request: Request) { return liveBookingReviewPost(request); }
