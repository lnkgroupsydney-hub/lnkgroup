import {bookingDocumentGet} from '@/modules/bookings';
export const runtime='nodejs';
export async function GET(req:Request,context:{params:Promise<{id:string;kind:string}>}){const {id,kind}=await context.params;return bookingDocumentGet(req,{admin:true,id,kind,proposalId:new URL(req.url).searchParams.get('proposalId')})}
