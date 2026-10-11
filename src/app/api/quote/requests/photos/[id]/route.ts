import { livePhotoDelete } from '@/modules/quotes/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function DELETE(request: Request, context: {params: Promise<{id: string}>}) { return livePhotoDelete(request, (await context.params).id); }
