import { customerArchivePost } from '@/modules/customers/server'
export const runtime = 'nodejs'
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) { return customerArchivePost(req,(await context.params).id) }
