import { adminQuoteRequestsGet } from '@/modules/quotes/server'
export const runtime = 'nodejs'
export async function GET(req: Request) { return adminQuoteRequestsGet(req) }
