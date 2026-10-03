import {proposalPost} from '@/modules/bookings';
export const runtime='nodejs';
export async function POST(req:Request,context:{params:Promise<{id:string}>}){return proposalPost(req,(await context.params).id)}
