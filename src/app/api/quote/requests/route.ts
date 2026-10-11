import { liveQuoteGet, liveQuotePut } from '@/modules/quotes/server'
export const runtime = 'nodejs'
export async function GET(req: Request) { return liveQuoteGet(req) }
export async function PUT(req: Request) { return liveQuotePut(req) }
