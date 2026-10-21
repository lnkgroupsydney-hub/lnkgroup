import { enquiryManagementApi } from '../../../../modules/enquiries/management-server'
export const runtime = 'nodejs'
export async function GET(req: Request) { return enquiryManagementApi.list(req) }
