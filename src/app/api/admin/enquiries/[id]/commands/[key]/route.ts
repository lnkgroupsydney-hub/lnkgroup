import { enquiryManagementApi } from '../../../../../../../modules/enquiries/management-server'
export const runtime = 'nodejs'
export async function GET(req: Request, context: { params: Promise<{ id: string; key: string }> }) { const params = await context.params; return enquiryManagementApi.receipt(req, params.id, params.key) }
