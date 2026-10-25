import { customerQuoteRelationGet } from '@/modules/customers/server'
export const runtime = 'nodejs'
export async function GET(req: Request, context: {params:Promise<{id:string}>}) {return customerQuoteRelationGet(req,(await context.params).id)}
