import {bookingChangesGet} from '@/modules/bookings'
export const runtime='nodejs'
export async function GET(req:Request,context:{params:Promise<{id:string}>}){return bookingChangesGet(req,(await context.params).id)}
