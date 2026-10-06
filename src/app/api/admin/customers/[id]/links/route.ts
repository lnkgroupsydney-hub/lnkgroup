import { customerLinksPost } from '@/modules/customers/server'
export const runtime = 'nodejs'
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) { return customerLinksPost(req, (await context.params).id) }
