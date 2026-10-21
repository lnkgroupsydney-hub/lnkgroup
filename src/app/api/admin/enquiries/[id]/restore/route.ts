import { enquiryManagementApi } from '../../../../../../modules/enquiries/management-server'
export const runtime = 'nodejs'
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) { const params = await context.params; return enquiryManagementApi.restore(req, params.id) }
