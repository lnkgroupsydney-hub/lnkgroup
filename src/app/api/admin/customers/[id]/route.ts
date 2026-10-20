import { customerGet, customerPatch } from '@/modules/customers/server'
export const runtime = 'nodejs'
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) { return customerGet(req, (await context.params).id) }

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) { return customerPatch(req,(await context.params).id) }
