import { companyRevisionApi } from '@/modules/quotes/server'
export const runtime = 'nodejs'
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) { const p = await context.params; return companyRevisionApi.withdraw(req, p.id) }
