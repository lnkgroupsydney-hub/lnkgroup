import { adminAnalysisGet } from '@/modules/quotes/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function GET(request: Request, context: {params: Promise<{id: string}>}) { return adminAnalysisGet(request, (await context.params).id); }
