import { enquiryManagementApi } from '../../../../../../../modules/enquiries/management-server'
export const runtime = 'nodejs'
export async function PATCH(req: Request, context: { params: Promise<{ id: string; noteId: string }> }) { const params = await context.params; return enquiryManagementApi.note(req, params.id, params.noteId) }
