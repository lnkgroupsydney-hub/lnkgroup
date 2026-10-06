import { unlinkedCustomerRecordsGet } from '@/modules/customers/server'
export const runtime = 'nodejs'
export async function GET(req: Request) { return unlinkedCustomerRecordsGet(req) }
