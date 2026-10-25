import { companyRevisionApi } from '@/modules/quotes/server'
export const runtime = 'nodejs'
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) { const p = await context.params; return companyRevisionApi.detail(req, p.id) }
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) { const p = await context.params; return companyRevisionApi.save(req, p.id) }
