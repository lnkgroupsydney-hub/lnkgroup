import { customersGet, customersPost } from '@/modules/customers/server'
export const runtime = 'nodejs'
export async function GET(req: Request) { return customersGet(req) }
export async function POST(req: Request) { return customersPost(req) }
