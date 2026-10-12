import { customerQuoteGet } from '@/modules/quotes/server'
export const runtime = 'nodejs'
export async function GET(req: Request) { return customerQuoteGet(req) }
