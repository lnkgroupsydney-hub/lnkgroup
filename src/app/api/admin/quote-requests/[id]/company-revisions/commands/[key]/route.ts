import { companyRevisionApi } from '@/modules/quotes/server'
export const runtime = 'nodejs'
export async function GET(req: Request, context: { params: Promise<{ id: string; key: string }> }) { const p = await context.params; return companyRevisionApi.receipt(req, p.id, p.key) }
