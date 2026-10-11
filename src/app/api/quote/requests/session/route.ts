import { liveQuoteSessionPost } from '@/modules/quotes/server'
export const runtime = 'nodejs'
export async function POST(req: Request) { return liveQuoteSessionPost(req) }
