import { customerRestorePost } from '@/modules/customers/server'
export const runtime = 'nodejs'
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) { return customerRestorePost(req,(await context.params).id) }
