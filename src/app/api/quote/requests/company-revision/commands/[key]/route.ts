import { companyRevisionApi } from '@/modules/quotes/server'
export const runtime = 'nodejs'
export async function GET(req: Request, context: { params: Promise<{ key: string }> }) { const p = await context.params; return companyRevisionApi.customerReceipt(req, p.key) }
