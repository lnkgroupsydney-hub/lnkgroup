import { livePhotoFinalizePost } from '@/modules/quotes/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function POST(request: Request, context: {params: Promise<{id: string}>}) { return livePhotoFinalizePost(request, (await context.params).id); }
