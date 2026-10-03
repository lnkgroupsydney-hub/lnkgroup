import {bookingDocumentGet} from '@/modules/bookings';
export const runtime='nodejs';
export async function GET(req:Request,context:{params:Promise<{kind:string}>}){return bookingDocumentGet(req,{admin:false,kind:(await context.params).kind,proposalId:new URL(req.url).searchParams.get('proposalId')})}
