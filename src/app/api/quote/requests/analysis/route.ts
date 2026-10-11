import { after } from 'next/server';
import { livePhotoWorkspaceGet, liveAnalysisPost, scheduleQueuedQuoteAnalysis, runQuoteAnalysis } from '@/modules/quotes/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export function GET(request: Request) { return livePhotoWorkspaceGet(request); }
export async function POST(request: Request) {
  const response = await liveAnalysisPost(request);
  await scheduleQueuedQuoteAnalysis(response, {
    schedule: after,
    run: runQuoteAnalysis,
    warn: message => console.warn(message),
  });
  return response;
}
