import { enquiryManagementApi } from '../../../../../modules/enquiries/management-server'
export const runtime = 'nodejs'
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) { const params = await context.params; return enquiryManagementApi.detail(req, params.id) }
export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) { const params = await context.params; return enquiryManagementApi.assign(req, params.id) }
