import {after} from 'next/server';
import {confirmPost} from '@/modules/bookings';
export const runtime='nodejs';
export async function POST(req:Request,context:{params:Promise<{id:string}>}){return confirmPost(req,(await context.params).id,after)}
