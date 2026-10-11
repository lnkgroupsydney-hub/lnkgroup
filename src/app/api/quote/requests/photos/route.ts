import { livePhotoWorkspaceGet, livePhotoBeginPost } from '@/modules/quotes/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return livePhotoWorkspaceGet(request); }
export function POST(request: Request) { return livePhotoBeginPost(request); }
