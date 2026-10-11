import { adminQuoteRequestGet } from '@/modules/quotes/server'
export const runtime = 'nodejs'
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return adminQuoteRequestGet(req, id)
}
