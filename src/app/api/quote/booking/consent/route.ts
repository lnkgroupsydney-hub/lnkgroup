import {after} from 'next/server';
import {consentPost} from '@/modules/bookings';
export const runtime='nodejs';
export const POST=(req:Request)=>consentPost(req,after);
