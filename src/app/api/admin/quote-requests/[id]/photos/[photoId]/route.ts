import { adminLivePhotoGet } from '@/modules/quotes/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: {params: Promise<{id: string; photoId: string}>}) { const {id,photoId}=await context.params; return adminLivePhotoGet(request,id,photoId); }
