import {adminBookingGet} from '@/modules/bookings';
export const runtime='nodejs';
export async function GET(req:Request,context:{params:Promise<{id:string}>}){return adminBookingGet(req,(await context.params).id)}
