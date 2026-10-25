import { customerResolvePost } from '@/modules/customers/server'
export const runtime = 'nodejs'
export async function POST(req: Request) { return customerResolvePost(req) }
